'use strict';

// Removes only byte-identical repeated source records from an NDJSON+gzip
// snapshot. Same-ID records with different payloads are preserved for review.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { once } = require('events');
const zlib = require('zlib');
const { readSnapshotRows } = require('./import-directory-contacts');
const { compactDirectoryRow } = require('../modules/directory-snapshot');

const ROOT = path.join(__dirname, '..');

function parseArgs(argv) {
  const value = prefix => argv.find(argument => argument.startsWith(prefix))?.slice(prefix.length);
  const input = value('--input=') || path.join(ROOT, 'registry', 'companies-directory-contacts.ndjson.gz');
  return {
    input,
    output: value('--output=') || input,
  };
}

async function run(options = parseArgs(process.argv.slice(2))) {
  if (!fs.existsSync(options.input)) throw new Error(`Snapshot not found: ${options.input}`);
  const temporary = `${options.output}.tmp-${process.pid}`;
  const output = fs.createWriteStream(temporary, { flags: 'wx' });
  const gzip = zlib.createGzip({ level: 9, mtime: 0 });
  gzip.pipe(output);

  const sourceRows = new Map();
  let read = 0;
  let written = 0;
  let duplicatesRemoved = 0;
  let inconsistentSourceIds = 0;

  try {
    for await (const record of readSnapshotRows(options.input)) {
      read += 1;
      if (record.error || !record.row) throw record.error || new Error(`Invalid row ${record.lineNumber}`);
      const compact = compactDirectoryRow(record.row);
      const line = JSON.stringify(compact);
      const externalId = String(compact.id || '');
      const rowHash = crypto.createHash('sha256').update(line).digest('hex');
      if (externalId) {
        const previous = sourceRows.get(externalId);
        if (previous === rowHash) {
          duplicatesRemoved += 1;
          continue;
        }
        if (previous) inconsistentSourceIds += 1;
        else sourceRows.set(externalId, rowHash);
      }
      if (!gzip.write(`${line}\n`)) await once(gzip, 'drain');
      written += 1;
    }
    gzip.end();
    await once(output, 'close');
    fs.renameSync(temporary, options.output);
  } catch (error) {
    gzip.destroy();
    output.destroy();
    if (fs.existsSync(temporary)) fs.rmSync(temporary, { force: true });
    throw error;
  }

  const result = { read, written, duplicatesRemoved, inconsistentSourceIds };
  console.log(JSON.stringify(result, null, 2));
  return result;
}

if (require.main === module) {
  run().catch(error => {
    console.error('[Compact snapshot] Failed:', error.message);
    process.exitCode = 1;
  });
}

module.exports = { parseArgs, run };
