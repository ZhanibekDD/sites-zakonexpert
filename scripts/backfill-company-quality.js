'use strict';

const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const { createSchema } = require('../modules/companies-schema');
const { minScore, QUALITY_SCORE_SQL, QUALITY_VERSION } = require('../modules/company-quality');

const DB_PATH = process.env.COMPANIES_DB_PATH || path.join(__dirname, '..', 'data', 'companies.sqlite');

function setMeta(db, key, value) {
  db.prepare(`
    INSERT INTO company_meta(key, value) VALUES(?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(key, String(value));
}

function numericMeta(db, key) {
  const row = db.prepare('SELECT value FROM company_meta WHERE key = ?').get(key);
  const value = Number.parseInt(row?.value, 10);
  return Number.isInteger(value) && value >= 0 ? value : null;
}

function qualityState(db) {
  const total = Number(db.prepare('SELECT COUNT(*) AS count FROM companies').get().count || 0);
  const version = db.prepare('SELECT value FROM company_meta WHERE key = ?').get('quality_version')?.value;
  const recordCount = numericMeta(db, 'record_count');
  const indexableCount = numericMeta(db, 'indexable_count');
  const excludedCount = numericMeta(db, 'excluded_count');
  const storedMinScore = numericMeta(db, 'quality_min_score');
  return {
    total,
    version,
    recordCount,
    indexableCount,
    excludedCount,
    storedMinScore,
  };
}

function qualityNeedsBackfill(db) {
  const state = qualityState(db);
  return state.version !== QUALITY_VERSION
    || state.storedMinScore !== minScore()
    || state.recordCount !== state.total
    || state.indexableCount === null
    || state.excludedCount === null
    || state.indexableCount + state.excludedCount !== state.total;
}

function reconcileQualityMetadata(db) {
  const total = Number(db.prepare('SELECT COUNT(*) AS count FROM companies').get().count || 0);
  const indexable = Number(db.prepare(
    'SELECT COUNT(*) AS count FROM companies WHERE is_indexable = 1'
  ).get().count || 0);
  const result = { total, indexable, excluded: Math.max(0, total - indexable) };

  db.exec('BEGIN IMMEDIATE');
  try {
    setMeta(db, 'quality_version', QUALITY_VERSION);
    setMeta(db, 'quality_min_score', minScore());
    setMeta(db, 'quality_backfilled_at', new Date().toISOString());
    setMeta(db, 'record_count', result.total);
    setMeta(db, 'indexable_count', result.indexable);
    setMeta(db, 'excluded_count', result.excluded);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }

  console.log(`[Companies] Quality metadata ready: ${result.indexable}/${result.total} indexable; ${result.excluded} excluded.`);
  return result;
}

function currentRowsCanBeReconciled(db) {
  const state = qualityState(db);
  return state.version === QUALITY_VERSION
    && (state.storedMinScore === null || state.storedMinScore === minScore());
}

function checkpointNumber(db, key) {
  return numericMeta(db, key) || 0;
}

function clearCheckpoint(db) {
  db.prepare(`
    DELETE FROM company_meta WHERE key IN (
      'quality_backfill_checkpoint_version',
      'quality_backfill_checkpoint_min_score',
      'quality_backfill_last_id',
      'quality_backfill_processed'
    )
  `).run();
}

function backfillDatabase(db, options = {}) {
  const threshold = minScore();
  const total = Number(db.prepare('SELECT COUNT(*) count FROM companies').get().count || 0);
  if (currentRowsCanBeReconciled(db)) {
    console.log(`[Companies] Quality rows already use version ${QUALITY_VERSION}; reconciling metadata only...`);
    return reconcileQualityMetadata(db);
  }

  const batchSize = Math.max(1000, Math.min(Number(options.batchSize) || 10000, 50000));
  const checkpointVersion = db.prepare(
    'SELECT value FROM company_meta WHERE key = ?'
  ).get('quality_backfill_checkpoint_version')?.value;
  const checkpointMinScore = numericMeta(db, 'quality_backfill_checkpoint_min_score');
  let lastId = checkpointVersion === QUALITY_VERSION && checkpointMinScore === threshold
    ? checkpointNumber(db, 'quality_backfill_last_id')
    : 0;
  let processed = lastId
    ? checkpointNumber(db, 'quality_backfill_processed')
    : 0;

  if (!lastId) {
    clearCheckpoint(db);
    setMeta(db, 'quality_backfill_checkpoint_version', QUALITY_VERSION);
    setMeta(db, 'quality_backfill_checkpoint_min_score', threshold);
  }

  console.log(`[Companies] Recalculating quality for ${total} records in resumable batches of ${batchSize}...`);
  if (processed) console.log(`[Companies] Resuming quality backfill after ${processed} committed records.`);

  const nextIds = db.prepare('SELECT id FROM companies WHERE id > ? ORDER BY id LIMIT ?');
  const updateBatch = db.prepare(`
    UPDATE companies SET
      quality_score = ${QUALITY_SCORE_SQL},
      is_indexable = CASE
        WHEN length(trim(COALESCE(bin, ''))) = 12
          AND trim(bin) NOT GLOB '*[^0-9]*'
          AND length(trim(COALESCE(name_ru, name_kk, ''))) >= 3
          AND (${QUALITY_SCORE_SQL}) >= ?
        THEN 1 ELSE 0 END
    WHERE id > ? AND id <= ?
  `);

  while (true) {
    const rows = nextIds.all(lastId, batchSize);
    if (!rows.length) break;
    const endId = Number(rows[rows.length - 1].id);
    db.exec('BEGIN IMMEDIATE');
    try {
      updateBatch.run(threshold, lastId, endId);
      processed += rows.length;
      lastId = endId;
      setMeta(db, 'quality_backfill_last_id', lastId);
      setMeta(db, 'quality_backfill_processed', processed);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    if (processed === rows.length || processed % 50000 < rows.length) {
      console.log(`[Companies] Quality checkpoint: ${processed}/${total}`);
    }
  }

  const result = reconcileQualityMetadata(db);
  clearCheckpoint(db);
  db.exec('PRAGMA optimize;');
  console.log(`[Companies] Quality ready: ${result.indexable}/${result.total} indexable; ${result.excluded} excluded.`);
  return result;
}

function backfill(options = {}) {
  const argv = options.argv || process.argv;
  if (!argv.includes('--confirm-offline')) {
    throw new Error('Stop Node.js and run with --confirm-offline');
  }
  if (!fs.existsSync(DB_PATH)) throw new Error(`Company database not found: ${DB_PATH}`);

  const db = new DatabaseSync(DB_PATH);
  createSchema(db);
  let result;
  try {
    result = backfillDatabase(db);
  } finally {
    db.close();
  }
  return result;
}

if (require.main === module) {
  try { backfill(); } catch (error) {
    console.error('[Companies] Quality backfill failed:', error.message);
    process.exitCode = 1;
  }
}

module.exports = {
  backfill,
  backfillDatabase,
  currentRowsCanBeReconciled,
  qualityNeedsBackfill,
  qualityState,
  reconcileQualityMetadata,
};
