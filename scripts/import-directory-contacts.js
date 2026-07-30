'use strict';

// One-time enrichment: matches rows from the "Казахстан.zip" business
// directory export (2GIS-style scrape — name/region/city/address/contacts,
// no BIN) against the official companies.sqlite (data.egov.kz, has BIN but
// no contacts). Matched companies get their missing contact fields filled
// in (never overwrites data already present). Unmatched directory rows are
// inserted as new, BIN-less company records — company-quality.js already
// requires a valid 12-digit BIN to be indexable, so these are automatically
// excluded from the public sitemap; they're only reachable through the
// site's own search/catalog.
//
// Usage:
//   1. Put Казахстан.zip in the project root (or pass --archive=path).
//   2. Stop Node.js in Plesk.
//   3. node scripts/import-directory-contacts.js --confirm-offline
//   Resumable: progress (next file index) is saved in company_meta after
//   every file, so a re-run continues instead of restarting.

const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');
const { createSchema, rebuildSearch } = require('../modules/companies-schema');
const { openArchive } = require('../modules/directory-xlsx-parser');
const { normalizeCompanyName } = require('../modules/company-name-normalize');
const { companySlug } = require('../modules/company-slug');
const { detectRegion } = require('../modules/company-region');

const ROOT = path.join(__dirname, '..');
const DB_PATH = process.env.COMPANIES_DB_PATH || path.join(ROOT, 'data', 'companies.sqlite');

const CONTACT_FIELDS = [
  ['phone', row => row.phone],
  ['mobile_phone', row => row.mobile_phone],
  ['email', row => row.email],
  ['website', row => row.website],
  ['whatsapp', row => row.whatsapp],
  ['viber', row => row.viber],
  ['telegram', row => row.telegram],
  ['work_hours', row => row.work_hours],
  ['rating', row => row.rating],
  ['review_count', row => row.review_count],
  ['lat', row => row.lat],
  ['lon', row => row.lon],
];

function hasAnyContact(row) {
  return CONTACT_FIELDS.some(([, get]) => get(row));
}

function ftsQuery(name) {
  return name
    .split(/\s+/)
    .map(p => p.replace(/["'():*+\-^~{}[\]\\]/g, '').trim())
    .filter(p => p.length >= 2)
    .slice(0, 5)
    .map(p => `"${p}"*`)
    .join(' OR ');
}

function parseArgs(argv) {
  const args = new Set(argv);
  const value = prefix => argv.find(a => a.startsWith(prefix))?.slice(prefix.length);
  return {
    confirmOffline: args.has('--confirm-offline'),
    archive: value('--archive=') || path.join(ROOT, 'Казахстан.zip'),
    limitFiles: Number.parseInt(value('--limit-files=') || '', 10) || Infinity,
  };
}

function setMeta(db, key, value) {
  db.prepare(`
    INSERT INTO company_meta(key, value) VALUES(?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(key, String(value));
}

function getMeta(db, key, fallback = null) {
  const row = db.prepare('SELECT value FROM company_meta WHERE key = ?').get(key);
  return row ? row.value : fallback;
}

async function run() {
  const options = parseArgs(process.argv.slice(2));
  if (!options.confirmOffline) {
    throw new Error('Requires --confirm-offline (stop Node.js before running — this writes to the live database file)');
  }
  if (!fs.existsSync(DB_PATH)) throw new Error(`companies.sqlite not found at ${DB_PATH} — run the main import first.`);
  if (!fs.existsSync(options.archive)) throw new Error(`Archive not found: ${options.archive}`);

  const db = new DatabaseSync(DB_PATH);
  createSchema(db);

  const archive = openArchive(options.archive);
  const startIndex = Number.parseInt(getMeta(db, 'directory_import_next_file', '0'), 10) || 0;
  const endIndex = Math.min(archive.entries.length, startIndex + options.limitFiles);

  const findCandidates = db.prepare(`
    SELECT c.id, c.name_ru, c.name_kk, c.address_ru, c.region_slug,
           c.phone, c.mobile_phone, c.email, c.website, c.whatsapp, c.viber, c.telegram,
           c.work_hours, c.rating, c.review_count, c.lat, c.lon
    FROM companies_fts f JOIN companies c ON c.id = f.rowid
    WHERE companies_fts MATCH ? LIMIT 15
  `);
  const updateContact = db.prepare(`
    UPDATE companies SET
      phone = COALESCE(NULLIF(phone, ''), ?), mobile_phone = COALESCE(NULLIF(mobile_phone, ''), ?),
      email = COALESCE(NULLIF(email, ''), ?), website = COALESCE(NULLIF(website, ''), ?),
      whatsapp = COALESCE(NULLIF(whatsapp, ''), ?), viber = COALESCE(NULLIF(viber, ''), ?),
      telegram = COALESCE(NULLIF(telegram, ''), ?), work_hours = COALESCE(NULLIF(work_hours, ''), ?),
      rating = COALESCE(NULLIF(rating, ''), ?), review_count = COALESCE(NULLIF(review_count, ''), ?),
      lat = COALESCE(NULLIF(lat, ''), ?), lon = COALESCE(NULLIF(lon, ''), ?),
      contact_source = COALESCE(contact_source, 'directory'), contact_updated_at = ?
    WHERE id = ?
  `);
  const insertNew = db.prepare(`
    INSERT INTO companies (
      id, bin, name_ru, name_kk, registration_date, address_ru, activity_ru, leader, status_ru,
      imported_at, quality_score, is_indexable, region_slug,
      phone, mobile_phone, email, website, whatsapp, viber, telegram, work_hours, rating, review_count,
      lat, lon, contact_source, contact_updated_at
    ) VALUES (?, NULL, ?, NULL, NULL, ?, ?, NULL, NULL, ?, 0, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'directory', ?)
  `);

  let maxId = Number(db.prepare('SELECT MAX(id) AS m FROM companies').get().m || 0);
  const importedAt = String(Math.floor(Date.now() / 1000));
  const nowIso = new Date().toISOString();

  // In-run dedup for new inserts: same directory entity often appears in
  // several category files (e.g. a firm listed under both "Юристы" and
  // "Деловые услуги"). Keyed by normalized name + region.
  const seenNew = new Map(); // key -> new company id

  let matched = 0, inserted = 0, skippedNoName = 0, filesDone = 0;

  for (let i = startIndex; i < endIndex; i++) {
    const entryName = archive.entries[i];
    let rows;
    try {
      rows = archive.readEntry(entryName);
    } catch (error) {
      console.warn(`[Directory] skip unreadable ${entryName}: ${error.message}`);
      continue;
    }

    db.exec('BEGIN');
    try {
      for (const row of rows) {
        const rawName = row.name;
        if (!rawName) { skippedNoName++; continue; }
        const normalized = normalizeCompanyName(rawName);
        if (!normalized) { skippedNoName++; continue; }
        const regionSlug = detectRegion(`${row.region} ${row.city}`);

        const match = ftsQuery(normalized);
        let target = null;
        if (match) {
          const candidates = findCandidates.all(match);
          for (const c of candidates) {
            const candName = normalizeCompanyName(c.name_ru || c.name_kk);
            if (candName !== normalized) continue;
            if (regionSlug && c.region_slug && c.region_slug !== regionSlug) continue; // same name, different region — not the same entity
            target = c;
            break;
          }
        }

        if (target) {
          if (hasAnyContact(row)) {
            updateContact.run(
              row.phone || null, row.mobile_phone || null, row.email || null, row.website || null,
              row.whatsapp || null, row.viber || null, row.telegram || null, row.work_hours || null,
              row.rating || null, row.review_count || null, row.lat || null, row.lon || null,
              nowIso, target.id
            );
            matched++;
          }
          continue;
        }

        // No match in the official registry — insert as a new, unofficial entry.
        const dedupKey = normalized + '|' + (regionSlug || '');
        if (seenNew.has(dedupKey)) continue; // already inserted this run; contact fields are best-effort, first listing wins
        maxId += 1;
        const activity = [row.category, row.subcategory].filter(Boolean).join(' — ') || null;
        // row.address often already repeats the city name — don't add it twice.
        const streetPart = row.city && row.address && row.address.includes(row.city)
          ? row.address.replace(row.city, '').replace(/^[,\s]+|[,\s]+$/g, '').replace(/,\s*,/g, ',')
          : row.address;
        const address = [row.region, row.city, streetPart].filter(Boolean).join(', ') || null;
        insertNew.run(
          maxId, rawName.slice(0, 500), address, activity, importedAt, regionSlug,
          row.phone || null, row.mobile_phone || null, row.email || null, row.website || null,
          row.whatsapp || null, row.viber || null, row.telegram || null, row.work_hours || null,
          row.rating || null, row.review_count || null, row.lat || null, row.lon || null, nowIso
        );
        seenNew.set(dedupKey, maxId);
        inserted++;
      }
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }

    setMeta(db, 'directory_import_next_file', i + 1);
    filesDone++;
    if (filesDone % 25 === 0 || i === endIndex - 1) {
      console.log(`[Directory] ${i + 1}/${archive.entries.length} files — matched ${matched}, inserted ${inserted}, no-name skipped ${skippedNoName}`);
    }
  }

  if (endIndex >= archive.entries.length) {
    console.log('[Directory] All files processed. Rebuilding search index...');
    rebuildSearch(db);
    setMeta(db, 'record_count', db.prepare('SELECT COUNT(*) AS c FROM companies').get().c);
    setMeta(db, 'directory_import_completed_at', nowIso);
  } else {
    console.log(`[Directory] Checkpoint at file ${endIndex}/${archive.entries.length}. Run again to continue.`);
  }

  db.exec('PRAGMA optimize;');
  db.close();
  console.log(`[Directory] Done this run. matched=${matched} inserted=${inserted} noName=${skippedNoName}`);
}

if (require.main === module) {
  run().catch(error => {
    console.error('[Directory] Failed:', error.message);
    process.exitCode = 1;
  });
}

module.exports = { run };
