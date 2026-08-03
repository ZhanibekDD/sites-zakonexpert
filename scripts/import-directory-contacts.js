'use strict';

// Streaming, resumable enrichment of the canonical organization database from
// the user-supplied Kazakhstan business-directory snapshot.
//
// The source is NDJSON+gzip, so the process keeps only one batch in memory.
// Existing official values are never overwritten. Repeated source records add
// missing contacts/categories instead of discarding all but the first row.
//
// Safe preview:
//   node scripts/import-directory-contacts.js --dry-run
//
// Production write (stop Passenger first):
//   node scripts/import-directory-contacts.js --confirm-offline

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const zlib = require('zlib');
const slugify = require('slugify');
const { DatabaseSync } = require('node:sqlite');
const {
  backfillDerivedCompanyFields,
  createSchema,
  getMeta,
  rebuildSearch,
  setMeta,
} = require('../modules/companies-schema');
const { normalizeCompanyName } = require('../modules/company-name-normalize');
const { buildSearchAliases } = require('../modules/company-transliterate');
const { cleanText, contactValues, normalizeDirectoryRow } = require('../modules/company-details-normalize');
const {
  addAddress,
  addAttribute,
  addCategory,
  addContact,
  addName,
  buildContactSearch,
  decodeDetails,
  detailSearchText,
  encodeDetails,
  isEmpty,
  looseKey,
} = require('../modules/company-details-store');
const { detectRegionFromParts } = require('../modules/company-region');
const {
  assertStoragePlan,
  buildStoragePlan,
  bytesLabel,
  DEFAULT_MAX_DB_BYTES,
} = require('../modules/organization-storage-plan');
const { backfillDatabase, qualityNeedsBackfill } = require('./backfill-company-quality');

const ROOT = path.join(__dirname, '..');
const DB_PATH = process.env.COMPANIES_DB_PATH || path.join(ROOT, 'data', 'companies.sqlite');
const DEFAULT_SNAPSHOT = path.join(ROOT, 'registry', 'companies-directory-contacts.ndjson.gz');
const DEFAULT_MANIFEST = path.join(ROOT, 'registry', 'companies-directory-contacts.manifest.json');
const SOURCE_KEY = 'business_directory_kz_2026';
const DEFAULT_BATCH_SIZE = 1000;
const DIRECTORY_ID_BASE = 8_000_000_000_000_000;

function ensureCompanyQuality(db) {
  if (!qualityNeedsBackfill(db)) return false;
  console.log('[Directory] Company quality metadata is missing or stale; repairing sitemap eligibility...');
  backfillDatabase(db);
  return true;
}

function parseArgs(argv) {
  const args = new Set(argv);
  const value = prefix => argv.find(argument => argument.startsWith(prefix))?.slice(prefix.length);
  const limit = Number.parseInt(value('--limit-rows=') || '', 10);
  const batchSize = Number.parseInt(value('--batch-size=') || '', 10);
  return {
    confirmOffline: args.has('--confirm-offline'),
    dryRun: args.has('--dry-run'),
    force: args.has('--force'),
    resetCheckpoint: args.has('--reset-checkpoint'),
    skipBackfill: args.has('--skip-derived-backfill'),
    ignoreSpaceCheck: args.has('--ignore-space-check'),
    maxDbBytes: Number.parseInt(value('--max-db-bytes=') || '', 10)
      || Number.parseInt(process.env.COMPANIES_MAX_DB_BYTES || '', 10)
      || DEFAULT_MAX_DB_BYTES,
    snapshot: value('--snapshot=') || DEFAULT_SNAPSHOT,
    manifest: value('--manifest=') || DEFAULT_MANIFEST,
    limitRows: Number.isInteger(limit) && limit > 0 ? limit : Infinity,
    batchSize: Number.isInteger(batchSize)
      ? Math.max(100, Math.min(batchSize, 5000))
      : DEFAULT_BATCH_SIZE,
  };
}

async function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(filePath)) hash.update(chunk);
  return hash.digest('hex');
}

function payloadHash(line) {
  return crypto.createHash('sha256').update(line).digest('hex');
}

function externalHash(externalId) {
  return crypto.createHash('sha256')
    .update(`${SOURCE_KEY}:${externalId}`)
    .digest()
    .subarray(0, 16);
}

function loadManifest(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

async function verifySnapshot(snapshotPath, manifestPath) {
  if (!fs.existsSync(snapshotPath)) throw new Error(`Snapshot not found: ${snapshotPath}`);
  const checksum = await sha256File(snapshotPath);
  const manifest = loadManifest(manifestPath);
  const expected = manifest?.snapshot?.sha256;
  if (expected && expected !== checksum) {
    throw new Error(`Snapshot checksum mismatch: expected ${expected}, received ${checksum}`);
  }
  return { checksum, manifest };
}

async function* readSnapshotRows(snapshotPath) {
  const source = fs.createReadStream(snapshotPath);
  const gunzip = zlib.createGunzip();
  source.on('error', error => gunzip.destroy(error));
  const lines = readline.createInterface({
    input: source.pipe(gunzip),
    crlfDelay: Infinity,
  });
  let lineNumber = 0;
  for await (const line of lines) {
    lineNumber += 1;
    if (!line.trim()) continue;
    try {
      yield { lineNumber, line, row: JSON.parse(line), error: null };
    } catch (error) {
      yield { lineNumber, line, row: null, error };
    }
  }
}

function normalizeLooseKey(value) {
  return looseKey(value);
}

function categorySlug(category) {
  return slugify(cleanText(category, 300), {
    lower: true,
    strict: true,
    locale: 'ru',
    trim: true,
  }).slice(0, 160) || 'other';
}

function stableDirectoryCompanyId(externalId, exists) {
  const digest = crypto.createHash('sha256').update(`${SOURCE_KEY}:${externalId}`).digest();
  const suffix = Number(digest.readBigUInt64BE(0) & 0x0000ffffffffffffn);
  let id = DIRECTORY_ID_BASE + suffix;
  while (exists(id)) {
    id += 1;
    if (id >= Number.MAX_SAFE_INTEGER) id = DIRECTORY_ID_BASE;
  }
  return id;
}

function candidateScore(candidate, row, regionSlug) {
  if (candidate.normalized_name !== normalizeCompanyName(row.name)) return -1;
  if (regionSlug && candidate.region_slug && candidate.region_slug !== regionSlug) return -1;
  let score = 55;
  if (regionSlug && candidate.region_slug === regionSlug) score += 25;
  const incomingAddress = normalizeLooseKey([row.city, row.address].filter(Boolean).join(' '));
  const candidateAddress = normalizeLooseKey(candidate.address_ru);
  const candidateIsDirectoryOnly = candidate.primary_source_key === SOURCE_KEY && !candidate.bin;
  if (candidateIsDirectoryOnly && incomingAddress && candidateAddress
      && incomingAddress !== candidateAddress
      && !incomingAddress.includes(candidateAddress)
      && !candidateAddress.includes(incomingAddress)) {
    return -1;
  }
  if (incomingAddress && candidateAddress) {
    if (incomingAddress === candidateAddress) score += 20;
    else if (incomingAddress.includes(candidateAddress) || candidateAddress.includes(incomingAddress)) score += 12;
  }
  if (candidate.bin) score += 5;
  return score;
}

function chooseCandidate(candidates, row, regionSlug) {
  const scored = candidates
    .map(candidate => ({ candidate, score: candidateScore(candidate, row, regionSlug) }))
    .filter(result => result.score >= 0)
    .sort((left, right) => right.score - left.score || Number(left.candidate.id) - Number(right.candidate.id));
  if (!scored.length) return { target: null, ambiguous: [] };
  if (scored.length === 1 && scored[0].score >= 75) return { target: scored[0], ambiguous: [] };
  if (scored.length === 1) return { target: null, ambiguous: scored };
  if (scored[0].score >= 90 && scored[0].score - scored[1].score >= 15) {
    return { target: scored[0], ambiguous: [] };
  }
  return { target: null, ambiguous: scored.slice(0, 15) };
}

function createStatements(db) {
  return {
    sourceRecord: db.prepare(`
      SELECT company_id FROM organization_source_links
      WHERE source_key = ? AND external_hash = ?
    `),
    candidates: db.prepare(`
      SELECT id, bin, name_ru, name_kk, normalized_name, region_slug, address_ru,
             search_aliases, primary_source_key
      FROM companies WHERE normalized_name = ? LIMIT 30
    `),
    companyExists: db.prepare('SELECT 1 FROM companies WHERE id = ?'),
    companyById: db.prepare('SELECT * FROM companies WHERE id = ?'),
    insertCompany: db.prepare(`
      INSERT INTO companies(
        id, bin, name_ru, name_kk, registration_date, address_ru,
        activity_ru, leader, status_ru, imported_at, quality_score,
        is_indexable, region_slug, normalized_name, search_aliases,
        contact_search, primary_source_key, created_by_run_id,
        phone, mobile_phone, email, website, whatsapp, viber, telegram,
        work_hours, rating, review_count, lat, lon,
        contact_source, contact_updated_at
      ) VALUES(
        ?, NULL, ?, NULL, NULL, ?, ?, NULL, NULL, ?, 0,
        0, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?
      )
    `),
    upsertSourceLink: db.prepare(`
      INSERT INTO organization_source_links(
        source_key, external_hash, company_id, created_run, last_seen_run
      ) VALUES(?, ?, ?, ?, ?)
      ON CONFLICT(source_key, external_hash) DO UPDATE SET
        company_id = excluded.company_id,
        last_seen_run = excluded.last_seen_run
    `),
    detail: db.prepare(`
      SELECT details_json FROM organization_details
      WHERE company_id = ? AND source_key = ?
    `),
    upsertDetail: db.prepare(`
      INSERT INTO organization_details(
        company_id, source_key, details_json, search_text,
        created_run, last_seen_run, updated_at
      ) VALUES(?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(company_id, source_key) DO UPDATE SET
        details_json = excluded.details_json,
        search_text = excluded.search_text,
        last_seen_run = excluded.last_seen_run,
        updated_at = excluded.updated_at
    `),
    insertMergeCandidate: db.prepare(`
      INSERT OR IGNORE INTO organization_merge_candidates(
        source_key, external_id, candidate_company_id, confidence, reason,
        status, imported_run_id, created_at
      ) VALUES(?, ?, ?, ?, ?, 'pending', ?, ?)
    `),
    updateRun: db.prepare(`
      UPDATE organization_import_runs SET
        status = ?, next_row = ?, processed_count = ?, matched_count = ?,
        inserted_count = ?, conflict_count = ?, invalid_count = ?,
        updated_at = ?, completed_at = ?, error_message = ?
      WHERE run_id = ?
    `),
  };
}

function findOrCreateRun(db, options, checksum, now) {
  if (options.resetCheckpoint) {
    db.prepare(`
      UPDATE organization_import_runs
      SET status = 'abandoned', updated_at = ?
      WHERE source_key = ? AND source_checksum = ? AND status IN ('running', 'failed')
    `).run(now, SOURCE_KEY, checksum);
  }
  if (!options.force) {
    const completed = db.prepare(`
      SELECT rowid AS run_number, * FROM organization_import_runs
      WHERE source_key = ? AND source_checksum = ? AND status = 'completed'
      ORDER BY completed_at DESC LIMIT 1
    `).get(SOURCE_KEY, checksum);
    if (completed) return { ...completed, alreadyCompleted: true };
    const resumable = db.prepare(`
      SELECT rowid AS run_number, * FROM organization_import_runs
      WHERE source_key = ? AND source_checksum = ? AND status IN ('running', 'failed')
      ORDER BY updated_at DESC LIMIT 1
    `).get(SOURCE_KEY, checksum);
    if (resumable) {
      db.prepare(`
        UPDATE organization_import_runs
        SET status = 'running', error_message = NULL, updated_at = ?
        WHERE run_id = ?
      `).run(now, resumable.run_id);
      return { ...resumable, status: 'running', error_message: null };
    }
  }

  const runId = `dir-${now.replace(/\D/g, '').slice(0, 14)}-${checksum.slice(0, 8)}`;
  db.prepare(`
    INSERT INTO organization_import_runs(
      run_id, source_key, source_checksum, source_path, status,
      started_at, updated_at
    ) VALUES(?, ?, ?, ?, 'running', ?, ?)
  `).run(runId, SOURCE_KEY, checksum, path.relative(ROOT, options.snapshot), now, now);
  return db.prepare(
    'SELECT rowid AS run_number, * FROM organization_import_runs WHERE run_id = ?'
  ).get(runId);
}

function primaryContactMap(row) {
  const primary = {};
  for (const contact of row.contacts) {
    if (!primary[contact.type] && contact.type !== 'fax') primary[contact.type] = contact.value;
  }
  return primary;
}

function companyPrimaryContacts(company) {
  const contacts = [];
  for (const type of [
    'phone', 'mobile_phone', 'email', 'website', 'whatsapp', 'viber', 'telegram',
  ]) {
    for (const contact of contactValues(type, company[type])) contacts.push({ type, ...contact });
  }
  return contacts;
}

function writeDetails(statements, companyId, row, run, now, regionSlug) {
  const company = statements.companyById.get(companyId);
  const current = statements.detail.get(companyId, SOURCE_KEY);
  const details = decodeDetails(current?.details_json);
  addName(details, row.name, [company.name_ru, company.name_kk]);
  const combinedAddress = [row.region, row.city, row.address].filter(Boolean).join(', ');
  if (combinedAddress) {
    addAddress(details, {
      value: combinedAddress,
      regionSlug,
      city: row.city || null,
      postalCode: row.postalCode || null,
      latitude: row.latitude,
      longitude: row.longitude,
    }, company.address_ru);
  }

  const primaryContacts = companyPrimaryContacts(company);
  for (const contact of row.contacts) {
    addContact(details, contact, primaryContacts);
  }

  if (row.category) {
    addCategory(details, {
      category: row.category,
      subcategory: row.subcategory || '',
      slug: categorySlug(row.category),
    }, company.activity_ru);
  }

  if (row.workHours) {
    addAttribute(details, {
      type: 'work_hours',
      value: row.workHours,
      normalized: normalizeLooseKey(row.workHours),
      public: true,
    }, company.work_hours);
  }
  if (row.paymentMethods) {
    addAttribute(details, {
      type: 'payment_methods',
      value: row.paymentMethods,
      normalized: normalizeLooseKey(row.paymentMethods),
      public: true,
    });
  }

  if (!isEmpty(details)) {
    statements.upsertDetail.run(
      companyId,
      SOURCE_KEY,
      encodeDetails(details),
      detailSearchText(details),
      run.run_number,
      run.run_number,
      now
    );
  }
}

function processRecord(db, statements, record, run, counters, now) {
  counters.processed += 1;
  if (record.error || !record.row || typeof record.row !== 'object') {
    counters.invalid += 1;
    return;
  }
  const row = normalizeDirectoryRow(record.row);
  if (!row.name) {
    counters.invalid += 1;
    return;
  }

  const hash = payloadHash(record.line);
  const externalId = row.externalId || `sha256:${hash}`;
  const sourceHash = externalHash(externalId);
  const existingSource = statements.sourceRecord.get(SOURCE_KEY, sourceHash);
  const normalizedName = normalizeCompanyName(row.name);
  const regionSlug = detectRegionFromParts({
    region: row.region,
    city: row.city,
    address: row.address,
  });
  let companyId = existingSource ? Number(existingSource.company_id) : null;
  let ambiguous = [];

  if (!companyId) {
    const candidates = normalizedName ? statements.candidates.all(normalizedName) : [];
    const decision = chooseCandidate(candidates, row, regionSlug);
    if (decision.target) {
      companyId = Number(decision.target.candidate.id);
      counters.matched += 1;
    } else {
      ambiguous = decision.ambiguous;
      companyId = stableDirectoryCompanyId(
        externalId,
        id => Boolean(statements.companyExists.get(id))
      );
      const address = [row.region, row.city, row.address].filter(Boolean).join(', ') || null;
      const activity = [row.category, row.subcategory].filter(Boolean).join(' — ') || null;
      const aliases = buildSearchAliases(row.name);
      const primary = primaryContactMap(row);
      const primaryCompany = {
        phone: primary.phone,
        mobile_phone: primary.mobile_phone,
        email: primary.email,
        website: primary.website,
        whatsapp: primary.whatsapp,
        viber: primary.viber,
        telegram: primary.telegram,
      };
      statements.insertCompany.run(
        companyId,
        row.name,
        address,
        activity,
        now,
        regionSlug,
        normalizedName,
        aliases,
        buildContactSearch(primaryCompany),
        SOURCE_KEY,
        run.run_id,
        primary.phone || null,
        primary.mobile_phone || null,
        primary.email || null,
        primary.website || null,
        primary.whatsapp || null,
        primary.viber || null,
        primary.telegram || null,
        row.workHours || null,
        null,
        null,
        row.latitude,
        row.longitude,
        SOURCE_KEY,
        now
      );
      counters.inserted += 1;
      if (ambiguous.length) counters.conflicts += 1;
    }
  } else {
    counters.matched += 1;
  }

  statements.upsertSourceLink.run(
    SOURCE_KEY,
    sourceHash,
    companyId,
    run.run_number,
    run.run_number
  );
  writeDetails(statements, companyId, row, run, now, regionSlug);

  for (const candidate of ambiguous) {
    statements.insertMergeCandidate.run(
      SOURCE_KEY,
      externalId,
      candidate.candidate.id,
      candidate.score,
      'Same normalized name; automatic merge withheld because several organizations are plausible',
      run.run_id,
      now
    );
  }
}

function updateRun(statements, runId, status, nextRow, counters, now, error = null) {
  statements.updateRun.run(
    status,
    nextRow,
    counters.processed,
    counters.matched,
    counters.inserted,
    counters.conflicts,
    counters.invalid,
    now,
    status === 'completed' ? now : null,
    error ? String(error.message || error).slice(0, 2000) : null,
    runId
  );
}

async function dryRun(options, snapshotInfo) {
  const sourceIds = new Set();
  const counters = {
    processed: 0,
    valid: 0,
    invalid: 0,
    missingName: 0,
    duplicateSourceIds: 0,
    contacts: 0,
    addresses: 0,
    categories: 0,
  };
  for await (const record of readSnapshotRows(options.snapshot)) {
    if (counters.processed >= options.limitRows) break;
    counters.processed += 1;
    if (record.error || !record.row) {
      counters.invalid += 1;
      continue;
    }
    const row = normalizeDirectoryRow(record.row);
    if (!row.name) {
      counters.missingName += 1;
      continue;
    }
    counters.valid += 1;
    counters.contacts += row.contacts.length;
    if (row.address) counters.addresses += 1;
    if (row.category) counters.categories += 1;
    const externalId = row.externalId || `sha256:${payloadHash(record.line)}`;
    if (sourceIds.has(externalId)) counters.duplicateSourceIds += 1;
    else sourceIds.add(externalId);
  }
  const result = {
    mode: 'dry-run',
    checksum: snapshotInfo.checksum,
    uniqueSourceIds: sourceIds.size,
    ...counters,
  };
  console.log(JSON.stringify(result, null, 2));
  return result;
}

async function run(options = parseArgs(process.argv.slice(2))) {
  const snapshotInfo = await verifySnapshot(options.snapshot, options.manifest);
  if (options.dryRun) return dryRun(options, snapshotInfo);
  if (!options.confirmOffline) {
    throw new Error('Write import requires --confirm-offline. Stop Node.js/Passenger before running.');
  }
  if (!fs.existsSync(DB_PATH)) {
    throw new Error(`companies.sqlite not found at ${DB_PATH}; run the official eGov import first.`);
  }

  const db = new DatabaseSync(DB_PATH);
  let runRow = null;
  try {
    createSchema(db);
    if (!options.force) {
      const completed = db.prepare(`
        SELECT rowid AS run_number, * FROM organization_import_runs
        WHERE source_key = ? AND source_checksum = ? AND status = 'completed'
        ORDER BY completed_at DESC LIMIT 1
      `).get(SOURCE_KEY, snapshotInfo.checksum);
      if (completed) {
        ensureCompanyQuality(db);
        console.log(`[Directory] Snapshot already imported by ${completed.run_id}; nothing to change.`);
        return {
          runId: completed.run_id,
          alreadyCompleted: true,
          processed: Number(completed.processed_count),
          matched: Number(completed.matched_count),
          inserted: Number(completed.inserted_count),
          conflicts: Number(completed.conflict_count),
          invalid: Number(completed.invalid_count),
        };
      }
    }
    const previousSnapshot = db.prepare(`
      SELECT run_id, source_checksum FROM organization_import_runs
      WHERE source_key = ? AND status = 'completed' AND source_checksum != ?
      ORDER BY completed_at DESC LIMIT 1
    `).get(SOURCE_KEY, snapshotInfo.checksum);
    if (previousSnapshot) {
      throw new Error(
        `A different directory snapshot was already completed by ${previousSnapshot.run_id}. `
        + 'Replacement requires a reviewed source-refresh migration and an external database backup.'
      );
    }
    const storagePlan = buildStoragePlan({
      db,
      dbPath: DB_PATH,
      manifest: snapshotInfo.manifest,
      maxDbBytes: options.maxDbBytes,
    });
    console.log(
      `[Directory] Storage estimate: current ${bytesLabel(storagePlan.currentDbBytes)}, `
      + `growth ${bytesLabel(storagePlan.estimatedGrowthBytes)}, `
      + `projected ${bytesLabel(storagePlan.projectedDbBytes)}`
    );
    if (!options.ignoreSpaceCheck) assertStoragePlan(storagePlan);

    const now = new Date().toISOString();
    runRow = findOrCreateRun(db, options, snapshotInfo.checksum, now);
    if (runRow.alreadyCompleted) {
      ensureCompanyQuality(db);
      console.log(`[Directory] Snapshot already imported by ${runRow.run_id}; nothing to change.`);
      return {
        runId: runRow.run_id,
        alreadyCompleted: true,
        processed: Number(runRow.processed_count),
        matched: Number(runRow.matched_count),
        inserted: Number(runRow.inserted_count),
        conflicts: Number(runRow.conflict_count),
        invalid: Number(runRow.invalid_count),
      };
    }

    if (!options.skipBackfill) {
      console.log('[Directory] Backfilling compact matching/search keys where needed...');
      const updated = backfillDerivedCompanyFields(db, {
        batchSize: 5000,
        onProgress: progress => {
          if (progress.updated % 50000 === 0) {
            console.log(`[Directory] Derived fields: ${progress.updated} rows updated`);
          }
        },
      });
      if (updated) console.log(`[Directory] Derived fields ready: ${updated} rows updated`);
    }
    db.exec(`
      CREATE INDEX IF NOT EXISTS companies_match_idx
      ON companies(normalized_name, region_slug, id);
    `);

    const statements = createStatements(db);
    const counters = {
      processed: Number(runRow.processed_count) || 0,
      matched: Number(runRow.matched_count) || 0,
      inserted: Number(runRow.inserted_count) || 0,
      conflicts: Number(runRow.conflict_count) || 0,
      invalid: Number(runRow.invalid_count) || 0,
    };
    const startRow = Number(runRow.next_row) || 0;
    let batch = [];
    let lastRow = startRow;
    let processedThisInvocation = 0;
    let reachedEnd = true;

    const flush = () => {
      if (!batch.length) return;
      const batchNow = new Date().toISOString();
      db.exec('BEGIN');
      try {
        for (const record of batch) processRecord(db, statements, record, runRow, counters, batchNow);
        lastRow = batch[batch.length - 1].lineNumber;
        updateRun(statements, runRow.run_id, 'running', lastRow, counters, batchNow);
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
      batch = [];
      console.log(
        `[Directory] row ${lastRow}; processed=${counters.processed} `
        + `matched=${counters.matched} inserted=${counters.inserted} `
        + `conflicts=${counters.conflicts} invalid=${counters.invalid}`
      );
    };

    for await (const record of readSnapshotRows(options.snapshot)) {
      if (record.lineNumber <= startRow) continue;
      if (processedThisInvocation >= options.limitRows) {
        reachedEnd = false;
        break;
      }
      batch.push(record);
      processedThisInvocation += 1;
      if (batch.length >= options.batchSize) flush();
    }
    flush();

    if (reachedEnd) {
      console.log('[Directory] Rebuilding the company search index...');
      rebuildSearch(db);
      const completedAt = new Date().toISOString();
      const total = Number(db.prepare('SELECT COUNT(*) AS count FROM companies').get().count || 0);
      const officialCount = Number(db.prepare(`
        SELECT COUNT(*) AS count FROM companies
        WHERE length(trim(COALESCE(bin, ''))) = 12 AND trim(bin) NOT GLOB '*[^0-9]*'
      `).get().count || 0);
      const directoryOnlyCount = Number(db.prepare(`
        SELECT COUNT(*) AS count FROM companies
        WHERE primary_source_key = ? AND (bin IS NULL OR bin = '')
      `).get(SOURCE_KEY).count || 0);
      const withContactsCount = Number(db.prepare(`
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
      setMeta(db, 'official_count', officialCount);
      setMeta(db, 'directory_only_count', directoryOnlyCount);
      setMeta(db, 'with_contacts_count', withContactsCount);
      setMeta(db, 'directory_import_completed_at', completedAt);
      setMeta(db, 'directory_import_checksum', snapshotInfo.checksum);
      ensureCompanyQuality(db);
      updateRun(statements, runRow.run_id, 'completed', lastRow, counters, completedAt);
      // Matching is an offline import concern. Dropping this large index after
      // completion saves space; createSchema recreates it before a future run.
      db.exec('DROP INDEX IF EXISTS companies_match_idx;');
      db.exec('PRAGMA optimize;');
    } else {
      console.log(`[Directory] Checkpoint saved at row ${lastRow}. Re-run to continue.`);
    }

    return {
      runId: runRow.run_id,
      completed: reachedEnd,
      nextRow: lastRow,
      processed: counters.processed,
      matched: counters.matched,
      inserted: counters.inserted,
      conflicts: counters.conflicts,
      invalid: counters.invalid,
      checksum: snapshotInfo.checksum,
    };
  } catch (error) {
    if (runRow?.run_id) {
      try {
        const statements = createStatements(db);
        const current = db.prepare('SELECT * FROM organization_import_runs WHERE run_id = ?').get(runRow.run_id);
        const counters = {
          processed: Number(current?.processed_count) || 0,
          matched: Number(current?.matched_count) || 0,
          inserted: Number(current?.inserted_count) || 0,
          conflicts: Number(current?.conflict_count) || 0,
          invalid: Number(current?.invalid_count) || 0,
        };
        updateRun(
          statements,
          runRow.run_id,
          'failed',
          Number(current?.next_row) || 0,
          counters,
          new Date().toISOString(),
          error
        );
      } catch (_) {
        // Preserve the original error; the last committed checkpoint is safe.
      }
    }
    throw error;
  } finally {
    db.close();
  }
}

if (require.main === module) {
  run()
    .then(result => console.log('[Directory] Done:', result))
    .catch(error => {
      console.error('[Directory] Failed:', error.message);
      process.exitCode = 1;
    });
}

module.exports = {
  SOURCE_KEY,
  chooseCandidate,
  dryRun,
  ensureCompanyQuality,
  parseArgs,
  readSnapshotRows,
  run,
  stableDirectoryCompanyId,
  verifySnapshot,
};
