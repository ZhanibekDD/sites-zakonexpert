'use strict';

const fs   = require('fs');
const path = require('path');
const Datastore = require('nedb-promises');
const slugify = require('slugify');
const { compactDatastore } = require('../modules/db-maintenance');
const { readRegistrySource } = require('../modules/registry-source');

const SOURCE_PATH = path.join(__dirname, '..', 'registry', 'lawyers.json.gz');
const DB_PATH  = path.join(__dirname, '..', 'data', 'lawyers.db');
const DB_VERSION = 3;

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
  return raw
    .split(/[,;]+/)
    .map(p => p.trim())
    .filter(p => /[+\d]/.test(p) && p.replace(/\D/g, '').length >= 5);
}

function buildLawyers(rows, sourceMtime) {
  const lawyers  = [];
  const slugUsed = {};
  let skipped    = 0;

  for (const row of rows) {
    // Columns: num(0), region(1), fio(2), license_no(3), license_date(4), since(5), address(6), phones(7)
    const num     = (row[0] || '').trim();
    const region  = (row[1] || '').trim();
    const fio     = (row[2] || '').trim();
    const licNo   = (row[3] || '').trim();
    const licDate = (row[4] || '').trim();
    const since   = (row[5] || '').trim();
    const address = (row[6] || '').trim();
    const phonesRaw = (row[7] || '').trim();

    // Skip header and junk rows
    if (!num || !/^\d+$/.test(num)) { skipped++; continue; }
    if (!fio || fio.length < 3)    { skipped++; continue; }

    const cleanName = fio.toUpperCase().replace(/\s+/g, ' ');
    const phones    = parsePhones(phonesRaw);

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
      slug,
      sourceMtime,
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

  const db = Datastore.create({ filename: DB_PATH, autoload: true });
  await db.ensureIndex({ fieldName: 'slug'   }).catch(() => {});
  await db.ensureIndex({ fieldName: 'name'   }).catch(() => {});
  await db.ensureIndex({ fieldName: 'region' }).catch(() => {});

  const existing = await db.findOne({}, { sourceMtime: 1, dbVersion: 1 });
  if (existing && existing.sourceMtime >= sourceMtime && existing.dbVersion === DB_VERSION) {
    const count = await db.count({});
    console.log(`[Lawyers] DB up to date (${count} records). Skipping.`);
    return count;
  }

  console.log('[Lawyers] Reading compressed registry source...');
  const rows = source.records;
  console.log(`[Lawyers] Parsed ${rows.length} rows`);
  const { lawyers, skipped } = buildLawyers(rows, sourceMtime);

  if (lawyers.length < 100) {
    throw new Error(`[Lawyers] Completeness check failed: total=${lawyers.length}`);
  }

  await db.remove({}, { multi: true });
  await db.insert(lawyers);
  await compactDatastore(db);
  console.log(`[Lawyers] Imported ${lawyers.length} lawyers (${skipped} rows skipped)`);
  return lawyers.length;
}

if (require.main === module) {
  importLawyers()
    .then(n => { console.log(`Done. ${n} lawyers in DB.`); process.exit(0); })
    .catch(e => { console.error('Import failed:', e.message); process.exit(1); });
}

module.exports = { DB_VERSION, importLawyers, buildLawyers, parsePhones };
