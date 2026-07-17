'use strict';

const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');
const { createSchema } = require('../modules/companies-schema');
const { detectRegion } = require('../modules/company-region');

const DB_PATH = process.env.COMPANIES_DB_PATH || path.join(__dirname, '..', 'data', 'companies.sqlite');
const BATCH_SIZE = 5000;

function run() {
  if (!fs.existsSync(DB_PATH)) {
    console.error(`[Regions] Database not found at ${DB_PATH}`);
    process.exitCode = 1;
    return;
  }

  const db = new DatabaseSync(DB_PATH);
  createSchema(db);

  const update = db.prepare('UPDATE companies SET region_slug = ? WHERE id = ?');
  const selectBatch = db.prepare(`
    SELECT id, address_ru FROM companies
    WHERE region_slug IS NULL AND id > ? ORDER BY id LIMIT ?
  `);

  let lastId = 0;
  let scanned = 0;
  let matched = 0;

  for (;;) {
    const rows = selectBatch.all(lastId, BATCH_SIZE);
    if (rows.length === 0) break;

    db.exec('BEGIN');
    for (const row of rows) {
      const regionSlug = detectRegion(row.address_ru);
      if (regionSlug) {
        update.run(regionSlug, row.id);
        matched += 1;
      }
      lastId = row.id;
    }
    db.exec('COMMIT');

    scanned += rows.length;
    if (scanned % 50000 < BATCH_SIZE) {
      console.log(`[Regions] scanned ${scanned}, matched ${matched}`);
    }
  }

  db.exec('PRAGMA optimize;');
  db.close();
  console.log(`[Regions] Done. Scanned ${scanned} rows without a region, matched ${matched}.`);
}

if (require.main === module) run();

module.exports = { run };
