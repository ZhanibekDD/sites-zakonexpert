'use strict';

const fs = require('fs');
const path = require('path');

const MIB = 1024 * 1024;
const DEFAULT_MAX_DB_BYTES = 850 * MIB;

function bytesLabel(bytes) {
  return `${(Number(bytes || 0) / MIB).toFixed(1)} MiB`;
}

function directoryCount(db) {
  try {
    const columns = new Set(
      db.prepare("SELECT name FROM pragma_table_info('companies')").all().map(row => row.name)
    );
    const clauses = [];
    if (columns.has('primary_source_key')) {
      clauses.push("primary_source_key = 'business_directory_kz_2026'");
    }
    if (columns.has('contact_source')) {
      clauses.push("contact_source IN ('directory', 'business_directory_kz_2026')");
    }
    if (!clauses.length) return 0;
    return Number(db.prepare(`
      SELECT COUNT(*) AS count FROM companies
      WHERE ${clauses.join(' OR ')}
    `).get().count || 0);
  } catch (_) {
    return 0;
  }
}

function availableBytes(dbPath) {
  try {
    const stats = fs.statfsSync(path.dirname(dbPath));
    return Number(stats.bavail) * Number(stats.bsize);
  } catch (_) {
    return null;
  }
}

function buildStoragePlan({ db, dbPath, manifest, maxDbBytes = DEFAULT_MAX_DB_BYTES }) {
  const currentDbBytes = fs.existsSync(dbPath) ? fs.statSync(dbPath).size : 0;
  const records = Number(manifest?.snapshot?.record_count || 0);
  const legacyRows = directoryCount(db);
  const coveredRows = records ? Math.min(records, legacyRows) : 0;
  const estimatedNewCompanies = records ? Math.max(0, records - coveredRows) : 0;

  // Calibrated against a full 457,324-row import:
  // - compact source links/details/search overhead: about 260 bytes/source row;
  // - a new company core row and runtime indexes: about 760 bytes/new company.
  // Add 20% fragmentation margin and 64 MiB for transaction/checkpoint headroom.
  const rawGrowth = records
    ? (records * 260) + (estimatedNewCompanies * 760)
    : 0;
  const estimatedGrowthBytes = records
    ? Math.ceil(rawGrowth * 1.2) + (64 * MIB)
    : 64 * MIB;
  const projectedDbBytes = currentDbBytes + estimatedGrowthBytes;
  const freeBytes = availableBytes(dbPath);
  const enoughFilesystemSpace = freeBytes === null || freeBytes >= estimatedGrowthBytes;
  const belowDbBudget = projectedDbBytes <= maxDbBytes;

  return {
    currentDbBytes,
    recordCount: records,
    existingDirectoryRows: legacyRows,
    estimatedNewCompanies,
    estimatedGrowthBytes,
    projectedDbBytes,
    maxDbBytes,
    freeBytes,
    enoughFilesystemSpace,
    belowDbBudget,
    safe: enoughFilesystemSpace && belowDbBudget,
  };
}

function assertStoragePlan(plan) {
  if (plan.safe) return;
  const reasons = [];
  if (!plan.enoughFilesystemSpace) {
    reasons.push(
      `free filesystem space ${bytesLabel(plan.freeBytes)} is below the `
      + `${bytesLabel(plan.estimatedGrowthBytes)} import estimate`
    );
  }
  if (!plan.belowDbBudget) {
    reasons.push(
      `projected database ${bytesLabel(plan.projectedDbBytes)} exceeds the `
      + `${bytesLabel(plan.maxDbBytes)} safety budget`
    );
  }
  throw new Error(
    `Storage preflight blocked the import: ${reasons.join('; ')}. `
    + 'Remove old archives/backups or raise --max-db-bytes only after checking the Plesk quota.'
  );
}

module.exports = {
  assertStoragePlan,
  buildStoragePlan,
  bytesLabel,
  DEFAULT_MAX_DB_BYTES,
};
