'use strict';

// Regenerates registry/companies-directory-contacts.json.gz from a raw
// business-directory archive (the "Казахстан.zip"-style export: ~1500 xlsx
// files, one per category, no BIN). Dev-only tool — not run in production;
// scripts/import-directory-contacts.js only needs the resulting snapshot
// and Node's built-in zlib, not this script or adm-zip.
//
// Usage: node scripts/build-directory-snapshot.js [--archive=path] [--out=path]

const path = require('path');
const fs = require('fs');
const zlib = require('zlib');
const { openArchive } = require('../modules/directory-xlsx-parser');

const ROOT = path.join(__dirname, '..');

function parseArgs(argv) {
  const value = prefix => argv.find(a => a.startsWith(prefix))?.slice(prefix.length);
  return {
    archive: value('--archive=') || path.join(ROOT, 'Казахстан.zip'),
    out: value('--out=') || path.join(ROOT, 'registry', 'companies-directory-contacts.json.gz'),
  };
}

function run() {
  const options = parseArgs(process.argv.slice(2));
  if (!fs.existsSync(options.archive)) throw new Error(`Archive not found: ${options.archive}`);

  const archive = openArchive(options.archive);
  console.log(`[Snapshot] ${archive.entries.length} category files found.`);

  const out = [];
  let done = 0;
  for (const entry of archive.entries) {
    let rows;
    try {
      rows = archive.readEntry(entry);
    } catch (error) {
      console.warn(`[Snapshot] skip unreadable ${entry}: ${error.message}`);
      continue;
    }
    for (const row of rows) {
      if (!row.name) continue;
      const compact = {};
      for (const key in row) { if (row[key]) compact[key] = row[key]; }
      out.push(compact);
    }
    done++;
    if (done % 200 === 0) console.log(`[Snapshot] ${done}/${archive.entries.length} files, ${out.length} rows so far`);
  }

  console.log(`[Snapshot] ${out.length} total rows. Compressing...`);
  const gz = zlib.gzipSync(JSON.stringify(out), { level: 9 });
  fs.mkdirSync(path.dirname(options.out), { recursive: true });
  fs.writeFileSync(options.out, gz);
  console.log(`[Snapshot] Wrote ${options.out} (${(gz.length / 1024 / 1024).toFixed(1)} MB).`);
}

if (require.main === module) {
  try { run(); } catch (error) { console.error('[Snapshot] Failed:', error.message); process.exitCode = 1; }
}

module.exports = { run };
