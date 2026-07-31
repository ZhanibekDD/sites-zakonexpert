'use strict';

const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const {
  buildStoragePlan,
  bytesLabel,
  DEFAULT_MAX_DB_BYTES,
} = require('../modules/organization-storage-plan');

const ROOT = path.join(__dirname, '..');
const DB_PATH = process.env.COMPANIES_DB_PATH || path.join(ROOT, 'data', 'companies.sqlite');
const MANIFEST_PATH = path.join(ROOT, 'registry', 'companies-directory-contacts.manifest.json');

function main() {
  if (!fs.existsSync(DB_PATH)) throw new Error(`Database not found: ${DB_PATH}`);
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  const db = new DatabaseSync(DB_PATH, { readOnly: true });
  try {
    const maxDbBytes = Number.parseInt(process.env.COMPANIES_MAX_DB_BYTES, 10)
      || DEFAULT_MAX_DB_BYTES;
    const plan = buildStoragePlan({ db, dbPath: DB_PATH, manifest, maxDbBytes });
    console.log(JSON.stringify({
      safe: plan.safe,
      currentDatabase: bytesLabel(plan.currentDbBytes),
      existingDirectoryRows: plan.existingDirectoryRows,
      estimatedNewCompanies: plan.estimatedNewCompanies,
      estimatedGrowth: bytesLabel(plan.estimatedGrowthBytes),
      projectedDatabase: bytesLabel(plan.projectedDbBytes),
      databaseBudget: bytesLabel(plan.maxDbBytes),
      filesystemFree: plan.freeBytes === null ? 'unknown' : bytesLabel(plan.freeBytes),
    }, null, 2));
    if (!plan.safe) process.exitCode = 2;
  } finally {
    db.close();
  }
}

try {
  main();
} catch (error) {
  console.error('[Organization storage plan] Failed:', error.message);
  process.exitCode = 1;
}
