'use strict';

// Dev-only converter for the user-supplied Kazakhstan business-directory
// archive. It writes NDJSON directly into gzip and never collects all rows in
// one JavaScript array. Production only needs the generated .ndjson.gz file.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { once } = require('events');
const zlib = require('zlib');
const { openArchive } = require('../modules/directory-xlsx-parser');
const { compactDirectoryRow } = require('../modules/directory-snapshot');

const ROOT = path.join(__dirname, '..');

function parseArgs(argv) {
  const value = prefix => argv.find(argument => argument.startsWith(prefix))?.slice(prefix.length);
  const out = value('--out=') || path.join(ROOT, 'registry', 'companies-directory-contacts.ndjson.gz');
  return {
    archive: value('--archive=') || path.join(ROOT, 'Казахстан.zip'),
    manifest: value('--manifest=') || path.join(path.dirname(out), 'companies-directory-contacts.manifest.json'),
    out,
  };
}

async function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(filePath)) hash.update(chunk);
  return hash.digest('hex');
}

async function run(options = parseArgs(process.argv.slice(2))) {
  if (!fs.existsSync(options.archive)) throw new Error(`Archive not found: ${options.archive}`);
  fs.mkdirSync(path.dirname(options.out), { recursive: true });

  const archive = openArchive(options.archive);
  console.log(`[Snapshot] ${archive.entries.length} category files found.`);
  const temporary = `${options.out}.tmp-${process.pid}`;
  const file = fs.createWriteStream(temporary, { flags: 'wx' });
  const gzip = zlib.createGzip({ level: 9, mtime: 0 });
  gzip.pipe(file);

  let rowsWritten = 0;
  let invalidRows = 0;
  let filesRead = 0;
  const fields = {};
  const sourceIds = new Map();
  let duplicateSourceIds = 0;
  let inconsistentSourceIds = 0;

  try {
    for (const entry of archive.entries) {
      let rows;
      try {
        rows = archive.readEntry(entry);
      } catch (error) {
        console.warn(`[Snapshot] skip unreadable ${entry}: ${error.message}`);
        invalidRows += 1;
        continue;
      }
      for (const row of rows) {
        if (!row?.name) {
          invalidRows += 1;
          continue;
        }
        const compact = compactDirectoryRow(row);
        for (const key of Object.keys(compact)) {
          fields[key] = (fields[key] || 0) + 1;
        }
        const serialized = JSON.stringify(compact);
        const sourceId = String(compact.id || '');
        if (sourceId) {
          const rowHash = crypto.createHash('sha256').update(serialized).digest('hex');
          const previousHash = sourceIds.get(sourceId);
          if (previousHash === rowHash) {
            duplicateSourceIds += 1;
            continue;
          }
          if (previousHash) inconsistentSourceIds += 1;
          else sourceIds.set(sourceId, rowHash);
        }
        if (!gzip.write(`${serialized}\n`)) await once(gzip, 'drain');
        rowsWritten += 1;
      }
      filesRead += 1;
      if (filesRead % 200 === 0) {
        console.log(`[Snapshot] ${filesRead}/${archive.entries.length} files, ${rowsWritten} rows`);
      }
    }
    gzip.end();
    await once(file, 'close');
    fs.renameSync(temporary, options.out);
  } catch (error) {
    gzip.destroy();
    file.destroy();
    if (fs.existsSync(temporary)) fs.rmSync(temporary, { force: true });
    throw error;
  }

  const [snapshotChecksum, archiveChecksum] = await Promise.all([
    sha256File(options.out),
    sha256File(options.archive),
  ]);
  const manifest = {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    source: {
      source_key: 'business_directory_kz_2026',
      type: 'user_supplied_business_directory_export',
      rights_status: 'user_supplied_underlying_provider_license_not_recorded',
      archive_name: path.basename(options.archive),
      archive_size_bytes: fs.statSync(options.archive).size,
      archive_sha256: archiveChecksum,
      category_files_read: filesRead,
    },
    snapshot: {
      path: path.relative(ROOT, options.out),
      format: 'ndjson+gzip',
      sha256: snapshotChecksum,
      compressed_size_bytes: fs.statSync(options.out).size,
      record_count: rowsWritten,
      invalid_record_count: invalidRows,
      unique_source_id_count: sourceIds.size,
      duplicate_source_id_count: duplicateSourceIds,
      inconsistent_source_id_count: inconsistentSourceIds,
      non_empty_field_counts: fields,
    },
    publication: {
      directory_only_records_indexable: false,
      note: 'Directory-only records remain noindex until an official BIN and sufficient verified fields are available.',
    },
  };
  fs.writeFileSync(options.manifest, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  console.log(
    `[Snapshot] ${rowsWritten} rows written to ${options.out} `
    + `(${(fs.statSync(options.out).size / 1024 / 1024).toFixed(1)} MB)`
  );
  return manifest;
}

if (require.main === module) {
  run()
    .then(() => console.log('[Snapshot] Done.'))
    .catch(error => {
      console.error('[Snapshot] Failed:', error.message);
      process.exitCode = 1;
    });
}

module.exports = { parseArgs, run, sha256File };
