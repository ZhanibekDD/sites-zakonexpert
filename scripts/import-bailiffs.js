'use strict';

const fs = require('fs');
const path = require('path');
const Datastore = require('nedb-promises');
const slugify = require('slugify');
const { compactDatastore } = require('../modules/db-maintenance');
const { readRegistrySource } = require('../modules/registry-source');

const SOURCE_PATH = path.join(__dirname, '..', 'registry', 'bailiffs.json.gz');
const DB_PATH  = path.join(__dirname, '..', 'data', 'bailiffs.db');
const DB_VERSION = 3;

// Kazakh Cyrillic extras not covered by slugify 'ru' locale
slugify.extend({
  'ә': 'a', 'Ә': 'A', 'ғ': 'g', 'Ғ': 'G',
  'қ': 'k', 'Қ': 'K', 'ң': 'n', 'Ң': 'N',
  'ө': 'o', 'Ө': 'O', 'ұ': 'u', 'Ұ': 'U',
  'ү': 'u', 'Ү': 'U', 'һ': 'h', 'Һ': 'H',
  'і': 'i', 'І': 'I',
});

function makeSlug(str) {
  return slugify(str.toLowerCase(), {
    locale: 'ru', replacement: '-', strict: true, trim: true,
  });
}

// Parse the combined info blob in column[3]:
// "г. Астана, ул. Жанкент д. 155, оф. 4, тел: +77756900986, , лицензия №: 1903, с 05.06.2015"
function parseCombinedField(raw) {
  if (!raw) return { address: '', phones: [], license: '', licenseDate: '' };

  // License number and date
  const licMatch  = raw.match(/лицензия\s+[№#]?\s*:?\s*(\d+)/i);
  const dateMatch = raw.match(/,\s*с\s+(\d{2}\.\d{2}\.\d{4})/i);
  const license     = licMatch  ? licMatch[1].trim()  : '';
  const licenseDate = dateMatch ? dateMatch[1].trim() : '';

  // Split on "тел:" to get address vs phone section
  const telIdx = raw.search(/тел\s*:/i);
  const licIdx = raw.search(/лицензия\s+[№#]/i);

  let address = '';
  let phones  = [];

  if (telIdx !== -1) {
    address = raw.slice(0, telIdx).trim().replace(/[,\s]+$/, '');
    const phoneEnd = licIdx !== -1 ? licIdx : raw.length;
    const phoneSection = raw.slice(telIdx + 4, phoneEnd);
    phones = phoneSection.split(/[,;]+/)
      .map(p => p.trim())
      .filter(p => /[+\d]/.test(p) && p.replace(/\D/g, '').length >= 5);
  } else {
    // No "тел:" marker — everything before license is address
    address = licIdx !== -1 ? raw.slice(0, licIdx).trim().replace(/[,\s]+$/, '') : raw.trim();
  }

  return { address, phones, license, licenseDate };
}

function buildBailiffs(rows, sourceMtime) {
  const bailiffs  = [];
  const slugUsed  = {};
  let skipped     = 0;

  for (const row of rows) {
    // Columns: Область(0), №(1), ФИО(2), Номер лицензии/combined(3), Адрес(4-empty), Контакты(5-empty)
    const region   = (row[0] || '').trim();
    const num      = (row[1] || '').trim();
    const name     = (row[2] || '').trim();
    const combined = (row[3] || '').trim();

    if (!num || !/^\d+$/.test(num)) { skipped++; continue; }
    const cleanName = name.toUpperCase().replace(/\s+/g, ' ');
    if (cleanName.length < 3) { skipped++; continue; }

    const { address, phones, license, licenseDate } = parseCombinedField(combined);

    let baseSlug = makeSlug(cleanName) || ('bailiff-' + num);
    let slug = baseSlug;
    if (slugUsed[slug]) {
      const regionWord = makeSlug((region.split(/[\s,]+/).slice(-1)[0] || region));
      slug = baseSlug + (regionWord ? '-' + regionWord : '');
      if (slugUsed[slug]) slug = slug + '-' + (slugUsed[baseSlug] + 1);
    }
    slugUsed[baseSlug] = (slugUsed[baseSlug] || 0) + 1;
    slugUsed[slug]     = (slugUsed[slug]     || 0) + 1;

    bailiffs.push({
      name: cleanName,
      region,
      license,
      licenseDate,
      address,
      phones,
      slug,
      sourceMtime,
      dbVersion: DB_VERSION,
      updatedAt: new Date(),
    });
  }

  return { bailiffs, skipped };
}

async function importBailiffs() {
  if (!fs.existsSync(SOURCE_PATH)) {
    console.error('[Bailiffs] Registry source not found:', SOURCE_PATH);
    return 0;
  }

  const source = readRegistrySource(SOURCE_PATH, 'bailiffs');
  const sourceMtime = source.sourceMtime;
  const db = Datastore.create({ filename: DB_PATH, autoload: true });

  await db.ensureIndex({ fieldName: 'slug'   }).catch(() => {});
  await db.ensureIndex({ fieldName: 'name'   }).catch(() => {});
  await db.ensureIndex({ fieldName: 'region' }).catch(() => {});

  const existing = await db.findOne({}, { sourceMtime: 1, dbVersion: 1 });
  if (existing && existing.sourceMtime >= sourceMtime && existing.dbVersion === DB_VERSION) {
    const count = await db.count({});
    console.log(`[Bailiffs] DB is up to date (${count} records). Skipping import.`);
    return count;
  }

  console.log('[Bailiffs] Reading compressed registry source...');
  const rows = source.records;
  console.log(`[Bailiffs] Parsed ${rows.length} rows`);
  const { bailiffs, skipped } = buildBailiffs(rows, sourceMtime);

  if (bailiffs.length < 2000 || bailiffs.some(item => !item.license || !item.licenseDate)) {
    throw new Error(`[Bailiffs] Completeness check failed: total=${bailiffs.length}`);
  }

  await db.remove({}, { multi: true });
  await db.insert(bailiffs);
  await compactDatastore(db);
  console.log(`[Bailiffs] Imported ${bailiffs.length} bailiffs (${skipped} skipped)`);
  return bailiffs.length;
}

if (require.main === module) {
  importBailiffs()
    .then(n => { console.log(`Done. ${n} bailiffs in DB.`); process.exit(0); })
    .catch(e => { console.error('Import failed:', e.message); process.exit(1); });
}

module.exports = { DB_VERSION, importBailiffs, buildBailiffs, parseCombinedField };
