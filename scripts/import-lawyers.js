'use strict';

const fs   = require('fs');
const path = require('path');
const Datastore = require('nedb-promises');
const slugify = require('slugify');
const { compactDatastore } = require('../modules/db-maintenance');
const { readRegistrySource } = require('../modules/registry-source');

const SOURCE_PATH = path.join(__dirname, '..', 'registry', 'lawyers.json.gz');
const DB_PATH  = path.join(__dirname, '..', 'data', 'lawyers.db');
const DB_VERSION = 4;

slugify.extend({
  'ə': 'a', 'Ə': 'A',
  'ğ': 'g', 'Ğ': 'G',
  'ŋ': 'n', 'Ŋ': 'N',
  'ä': 'a', 'Ä': 'A',
  'ö': 'o', 'Ö': 'O',
  'ü': 'u', 'Ü': 'U',
  // Cyrillic Kazakh extensions
  'ә': 'a', 'Ә': 'A',
  'ғ': 'g', 'Ғ': 'G',
  'қ': 'k', 'Қ': 'K',
  'ң': 'n', 'Ң': 'N',
  'ө': 'o', 'Ө': 'O',
  'ұ': 'u', 'Ұ': 'U',
  'ү': 'u', 'Ү': 'U',
  'һ': 'h', 'Һ': 'H',
  'і': 'i', 'І': 'I',
});

function makeSlug(str) {
  return slugify(str.toLowerCase(), {
    locale: 'ru',
    replacement: '-',
    strict: true,
    trim: true,
  });
}

function parsePhones(raw) {
  if (!raw) return [];
  const values = Array.isArray(raw) ? raw : String(raw).split(/[,;]+/);
  return values
    .map(p => p.trim())
    .filter(p => /[+\d]/.test(p) && p.replace(/\D/g, '').length >= 5);
}

function clean(value) {
  return String(value || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

function normalizeSourceRow(row, index) {
  if (!Array.isArray(row)) {
    return {
      num: clean(row.officialId || index + 1),
      region: clean(row.region) || 'Казахстан',
      fio: clean(row.name),
      licNo: clean(row.licenseNo),
      licDate: clean(row.licenseDate),
      since: clean(row.since),
      address: clean(row.address),
      phones: parsePhones(row.phones),
      email: clean(row.email).toLowerCase(),
      legalOrganization: clean(row.legalOrganization),
      specializations: Array.isArray(row.specializations) ? row.specializations.map(clean).filter(Boolean) : [],
      lawyerStatus: clean(row.lawyerStatus),
      officialId: clean(row.officialId),
      sourceUpdatedAt: clean(row.sourceUpdatedAt),
    };
  }

  // Legacy fallback format: num, region, FIO, licence, date, membership, address, phones.
  return {
    num: clean(row[0]),
    region: clean(row[1]),
    fio: clean(row[2]),
    licNo: clean(row[3]),
    licDate: clean(row[4]),
    since: clean(row[5]),
    address: clean(row[6]),
    phones: parsePhones(clean(row[7])),
    email: '',
    legalOrganization: '',
    specializations: [],
    lawyerStatus: '',
    officialId: '',
    sourceUpdatedAt: '',
  };
}

function buildLawyers(rows, sourceMtime, sourceFingerprint = '') {
  const lawyers  = [];
  const slugUsed = {};
  let skipped    = 0;

  for (let index = 0; index < rows.length; index++) {
    const row = normalizeSourceRow(rows[index], index);
    const { num, region, fio, licNo, licDate, since, address } = row;

    // Skip header and junk rows
    if (!num || !/^\d+$/.test(num)) { skipped++; continue; }
    if (!fio || fio.length < 3)    { skipped++; continue; }

    const cleanName = fio.toUpperCase().replace(/\s+/g, ' ');
    const phones = row.phones;

    let baseSlug = makeSlug(cleanName) || ('lawyer-' + num);
    let slug     = baseSlug;

    if (slugUsed[slug]) {
      const regionWord = makeSlug((region || '').split(/[\s,]+/).slice(-1)[0] || region);
      slug = baseSlug + (regionWord ? '-' + regionWord : '');
      if (slugUsed[slug]) slug = slug + '-' + (slugUsed[baseSlug] + 1);
    }
    slugUsed[baseSlug] = (slugUsed[baseSlug] || 0) + 1;
    slugUsed[slug]     = (slugUsed[slug]     || 0) + 1;

    lawyers.push({
      name: cleanName,
      region,
      licenseNo: licNo,
      licenseDate: licDate,
      since,
      address,
      phones,
      email: row.email,
      legalOrganization: row.legalOrganization,
      specializations: row.specializations,
      lawyerStatus: row.lawyerStatus,
      officialId: row.officialId,
      sourceUpdatedAt: row.sourceUpdatedAt,
      slug,
      sourceMtime,
      sourceFingerprint,
      dbVersion: DB_VERSION,
      updatedAt: new Date(),
    });
  }

  return { lawyers, skipped };
}

async function importLawyers() {
  if (!fs.existsSync(SOURCE_PATH)) {
    console.error('[Lawyers] Registry source not found:', SOURCE_PATH);
    return 0;
  }

  const source = readRegistrySource(SOURCE_PATH, 'lawyers');
  const sourceMtime = source.sourceMtime;
  const sourceFingerprint = source.sourceFingerprint;

  const db = Datastore.create({ filename: DB_PATH, autoload: true });
  await db.ensureIndex({ fieldName: 'slug'   }).catch(() => {});
  await db.ensureIndex({ fieldName: 'name'   }).catch(() => {});
  await db.ensureIndex({ fieldName: 'region' }).catch(() => {});

  const existing = await db.findOne({}, { sourceMtime: 1, sourceFingerprint: 1, sourceRecordCount: 1, dbVersion: 1 });
  const count = await db.count({});
  if (existing && existing.sourceFingerprint === sourceFingerprint
      && existing.dbVersion === DB_VERSION && existing.sourceRecordCount === count) {
    console.log(`[Lawyers] DB up to date (${count} records). Skipping.`);
    return count;
  }

  console.log('[Lawyers] Reading compressed registry source...');
  const rows = source.records;
  console.log(`[Lawyers] Parsed ${rows.length} rows`);
  const { lawyers, skipped } = buildLawyers(rows, sourceMtime, sourceFingerprint);
  lawyers.forEach(lawyer => { lawyer.sourceRecordCount = lawyers.length; });

  const usesOfficialRecords = rows.some(row => row && !Array.isArray(row));
  const minimum = usesOfficialRecords ? 3500 : 100;
  if (lawyers.length < minimum) {
    throw new Error(`[Lawyers] Completeness check failed: total=${lawyers.length}`);
  }

  await db.remove({}, { multi: true });
  await db.insert(lawyers);
  const importedCount = await db.count({});
  if (importedCount !== lawyers.length) {
    throw new Error(`[Lawyers] Import verification failed: expected=${lawyers.length}, stored=${importedCount}`);
  }
  await compactDatastore(db);
  console.log(`[Lawyers] Imported ${lawyers.length} lawyers (${skipped} rows skipped)`);
  return lawyers.length;
}

if (require.main === module) {
  importLawyers()
    .then(n => { console.log(`Done. ${n} lawyers in DB.`); process.exit(0); })
    .catch(e => { console.error('Import failed:', e.message); process.exit(1); });
}

module.exports = { DB_VERSION, importLawyers, buildLawyers, parsePhones, normalizeSourceRow };
