#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const Datastore = require('nedb-promises');
const { compactDatastore } = require('../modules/db-maintenance');

const ROOT = path.join(__dirname, '..');
const DATA_DIR = path.resolve(process.env.DB_DATA_DIR || path.join(ROOT, 'data'));
const DATABASES = [
  'news.db',
  'laws.db',
  'notaries.db',
  'bailiffs.db',
  'comments.db',
  'leads.db',
  'clicks.db',
];

function formatBytes(value) {
  if (value < 1024) return `${value} B`;
  const units = ['KB', 'MB', 'GB'];
  let amount = value;
  let unit = -1;
  do {
    amount /= 1024;
    unit += 1;
  } while (amount >= 1024 && unit < units.length - 1);
  return `${amount.toFixed(amount >= 10 ? 1 : 2)} ${units[unit]}`;
}

async function compactFile(filename) {
  const filePath = path.join(DATA_DIR, filename);
  if (!fs.existsSync(filePath)) return null;

  const before = fs.statSync(filePath).size;
  const db = Datastore.create({ filename: filePath, autoload: false });
  await db.load();
  const records = await db.count({});
  await compactDatastore(db);
  const after = fs.statSync(filePath).size;

  return { filename, before, after, records };
}

async function main() {
  if (!process.argv.includes('--confirm-offline')) {
    console.error('Stop the Node.js application in Plesk before compacting databases.');
    console.error('Then run: npm run storage:compact -- --confirm-offline');
    process.exitCode = 2;
    return;
  }

  if (!fs.existsSync(DATA_DIR)) {
    console.log('No data directory found. Nothing to compact.');
    return;
  }

  let totalBefore = 0;
  let totalAfter = 0;
  let found = 0;

  for (const filename of DATABASES) {
    const result = await compactFile(filename);
    if (!result) continue;
    found += 1;
    totalBefore += result.before;
    totalAfter += result.after;
    console.log(
      `${result.filename}: ${formatBytes(result.before)} -> ${formatBytes(result.after)} ` +
      `(${result.records} records)`,
    );
  }

  if (!found) {
    console.log('No NeDB database files found. Nothing to compact.');
    return;
  }

  console.log(`Total: ${formatBytes(totalBefore)} -> ${formatBytes(totalAfter)}`);
  console.log(`Reclaimed: ${formatBytes(Math.max(0, totalBefore - totalAfter))}`);
}

main().catch(error => {
  console.error('Database compaction failed:', error.message);
  process.exitCode = 1;
});
