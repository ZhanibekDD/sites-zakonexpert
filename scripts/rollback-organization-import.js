'use strict';

const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const { createSchema, rebuildSearch, setMeta } = require('../modules/companies-schema');

const ROOT = path.join(__dirname, '..');
const DB_PATH = process.env.COMPANIES_DB_PATH || path.join(ROOT, 'data', 'companies.sqlite');

function parseArgs(argv) {
  const args = new Set(argv);
  const value = prefix => argv.find(argument => argument.startsWith(prefix))?.slice(prefix.length);
  return {
    confirmOffline: args.has('--confirm-offline'),
    runId: value('--run-id=') || '',
  };
}

function run(options = parseArgs(process.argv.slice(2))) {
  if (!options.confirmOffline) {
    throw new Error('Rollback requires --confirm-offline. Stop Node.js/Passenger first.');
  }
  if (!options.runId) throw new Error('Provide --run-id=<organization import run id>.');
  if (!fs.existsSync(DB_PATH)) throw new Error(`Database not found: ${DB_PATH}`);

  const db = new DatabaseSync(DB_PATH);
  try {
    createSchema(db);
    const importRun = db.prepare(
      'SELECT rowid AS run_number, * FROM organization_import_runs WHERE run_id = ?'
    ).get(options.runId);
    if (!importRun) throw new Error(`Import run not found: ${options.runId}`);
    if (importRun.status === 'rolled_back') {
      return { runId: options.runId, alreadyRolledBack: true };
    }

    const seenLater = Number(db.prepare(`
      SELECT (
        SELECT COUNT(*) FROM organization_source_links
        WHERE created_run = ? AND last_seen_run != ?
      ) + (
        SELECT COUNT(*) FROM organization_details
        WHERE created_run = ? AND last_seen_run != ?
      ) AS count
    `).get(
      importRun.run_number,
      importRun.run_number,
      importRun.run_number,
      importRun.run_number
    ).count || 0);
    if (seenLater) {
      throw new Error(
        `${seenLater} source records were used by a later import; roll back later runs first.`
      );
    }

    const deleted = {};
    db.exec('BEGIN');
    try {
      for (const table of ['organization_merge_candidates', 'organization_conflicts']) {
        deleted[table] = Number(
          db.prepare(`DELETE FROM ${table} WHERE imported_run_id = ?`).run(options.runId).changes || 0
        );
      }
      deleted.organization_details = Number(db.prepare(`
        DELETE FROM organization_details WHERE created_run = ?
      `).run(importRun.run_number).changes || 0);
      deleted.organization_source_links = Number(db.prepare(`
        DELETE FROM organization_source_links WHERE created_run = ?
      `).run(importRun.run_number).changes || 0);
      deleted.companies = Number(db.prepare(`
        DELETE FROM companies
        WHERE created_by_run_id = ?
          AND (bin IS NULL OR bin = '')
          AND NOT EXISTS (
            SELECT 1 FROM organization_source_links sl WHERE sl.company_id = companies.id
          )
      `).run(options.runId).changes || 0);
      db.prepare(`
        UPDATE organization_import_runs
        SET status = 'rolled_back', updated_at = ?, completed_at = ?
        WHERE run_id = ?
      `).run(new Date().toISOString(), new Date().toISOString(), options.runId);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }

    rebuildSearch(db);
    const total = Number(db.prepare('SELECT COUNT(*) AS count FROM companies').get().count || 0);
    const official = Number(db.prepare(`
      SELECT COUNT(*) AS count FROM companies
      WHERE length(trim(COALESCE(bin, ''))) = 12 AND trim(bin) NOT GLOB '*[^0-9]*'
    `).get().count || 0);
    const withContacts = Number(db.prepare(`
      SELECT COUNT(*) AS count FROM companies c
      WHERE EXISTS (
        SELECT 1 FROM organization_details d
        WHERE d.company_id = c.id AND d.search_text != ''
      ) OR COALESCE(
        c.phone, c.mobile_phone, c.email, c.website,
        c.whatsapp, c.viber, c.telegram, ''
      ) != ''
    `).get().count || 0);
    setMeta(db, 'record_count', total);
    setMeta(db, 'official_count', official);
    setMeta(db, 'directory_only_count', Math.max(0, total - official));
    setMeta(db, 'with_contacts_count', withContacts);
    db.exec('PRAGMA optimize;');
    return { runId: options.runId, deleted, recordCount: total };
  } finally {
    db.close();
  }
}

if (require.main === module) {
  try {
    console.log('[Organization rollback] Done:', run());
  } catch (error) {
    console.error('[Organization rollback] Failed:', error.message);
    process.exitCode = 1;
  }
}

module.exports = { parseArgs, run };
