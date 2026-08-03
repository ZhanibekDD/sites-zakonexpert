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

function qualityNeedsBackfill(db) {
  const total = Number(db.prepare('SELECT COUNT(*) AS count FROM companies').get().count || 0);
  const version = db.prepare('SELECT value FROM company_meta WHERE key = ?').get('quality_version')?.value;
  const recordCount = numericMeta(db, 'record_count');
  const indexableCount = numericMeta(db, 'indexable_count');
  const excludedCount = numericMeta(db, 'excluded_count');
  return version !== QUALITY_VERSION
    || recordCount !== total
    || indexableCount === null
    || excludedCount === null
    || indexableCount + excludedCount !== total;
}

function backfillDatabase(db) {
  const threshold = minScore();
  console.log(`[Companies] Recalculating quality for ${db.prepare('SELECT COUNT(*) count FROM companies').get().count} records...`);
  let result;
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec('DROP INDEX IF EXISTS companies_indexable_idx;');
    db.exec(`UPDATE companies SET quality_score = ${QUALITY_SCORE_SQL};`);
    db.prepare(`
      UPDATE companies SET is_indexable = CASE
        WHEN length(trim(COALESCE(bin, ''))) = 12
          AND trim(bin) NOT GLOB '*[^0-9]*'
          AND length(trim(COALESCE(name_ru, name_kk, ''))) >= 3
          AND quality_score >= ?
        THEN 1 ELSE 0 END
    `).run(threshold);
    result = db.prepare(`
      SELECT COUNT(*) total,
        SUM(CASE WHEN is_indexable = 1 THEN 1 ELSE 0 END) indexable,
        SUM(CASE WHEN is_indexable = 0 THEN 1 ELSE 0 END) excluded
      FROM companies
    `).get();
    result.total = Number(result.total || 0);
    result.indexable = Number(result.indexable || 0);
    result.excluded = Number(result.excluded || 0);
    setMeta(db, 'quality_version', QUALITY_VERSION);
    setMeta(db, 'quality_min_score', threshold);
    setMeta(db, 'quality_backfilled_at', new Date().toISOString());
    setMeta(db, 'record_count', result.total);
    setMeta(db, 'indexable_count', result.indexable);
    setMeta(db, 'excluded_count', result.excluded);
    db.exec('CREATE INDEX companies_indexable_idx ON companies(is_indexable, id);');
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  db.exec('ANALYZE companies; PRAGMA optimize;');
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

module.exports = { backfill, backfillDatabase, qualityNeedsBackfill };
