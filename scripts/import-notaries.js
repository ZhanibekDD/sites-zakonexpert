'use strict';

const fs = require('fs');
const path = require('path');
const Datastore = require('nedb-promises');
const slugify = require('slugify');
const { compactDatastore } = require('../modules/db-maintenance');
const { readRegistrySource } = require('../modules/registry-source');

const SOURCE_PATH = path.join(__dirname, '..', 'registry', 'notaries.json.gz');
const DB_PATH  = path.join(__dirname, '..', 'data', 'notaries.db');
const DB_VERSION = 4; // increment to force re-import on schema changes

// Extend slugify with Kazakh Cyrillic characters not covered by 'ru' locale
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

function validEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

function buildNotaries(rows, sourceMtime) {
  const notaries = [];
  const slugUsed = {};
  let skipped = 0;

  for (const row of rows) {
    // Columns: Область(0), №(1), ФИО(2), Лицензия(3), Дата(4), Адрес(5), Телефон(6), Email(7), Режим(8)
    const region   = (row[0] || '').trim();
    const num      = (row[1] || '').trim();
    const name     = (row[2] || '').trim();
    const license  = (row[3] || '').trim();
    const licDate  = (row[4] || '').trim();
    const address  = (row[5] || '').trim();
    const phone    = (row[6] || '').replace(/[,;\s]+$/, '').trim();
    const email    = validEmail(row[7]);
    const schedule = (row[8] || '').trim().replace(/\s+/g, ' ');

    if (!num || !/^\d+$/.test(num)) { skipped++; continue; }
    const cleanName = name.toUpperCase().replace(/\s+/g, ' ');
    if (cleanName.length < 3 || !region) { skipped++; continue; }

    const isActive = !license.toLowerCase().includes('прекращена');
    let baseSlug = makeSlug(cleanName) || ('notary-' + num);
    let slug = baseSlug;
    if (slugUsed[slug]) {
      const regionWord = makeSlug((region || '').split(/[\s,]+/).slice(-1)[0] || region);
      slug = baseSlug + (regionWord ? '-' + regionWord : '');
      if (slugUsed[slug]) slug = slug + '-' + (slugUsed[baseSlug] + 1);
    }
    slugUsed[baseSlug] = (slugUsed[baseSlug] || 0) + 1;
    slugUsed[slug] = (slugUsed[slug] || 0) + 1;

    notaries.push({
      name: cleanName,
      region,
      license: isActive ? license : null,
      licenseDate: licDate,
      active: isActive,
      address,
      phone,
      email,
      schedule,
      slug,
      sourceMtime,
      dbVersion: DB_VERSION,
      source: 'ЕНІС',
      sourceUrl: 'https://enis.kz/NotarySearch',
      updatedAt: new Date(),
    });
  }
  return { notaries, skipped };
}

async function importNotaries() {
  if (!fs.existsSync(SOURCE_PATH)) {
    console.error('[Notaries] Registry source not found:', SOURCE_PATH);
    return 0;
  }

  const source = readRegistrySource(SOURCE_PATH, 'notaries');
  const sourceMtime = source.sourceMtime;

  // Check if DB is already up to date
  const db = Datastore.create({ filename: DB_PATH, autoload: true });
  await db.ensureIndex({ fieldName: 'slug' }).catch(() => {});
  await db.ensureIndex({ fieldName: 'name'  }).catch(() => {});
  await db.ensureIndex({ fieldName: 'active' }).catch(() => {});

  const existing = await db.findOne({}, { updatedAt: 1, sourceMtime: 1, dbVersion: 1 });
  if (existing && existing.sourceMtime >= sourceMtime && existing.dbVersion === DB_VERSION) {
    const count = await db.count({});
    console.log(`[Notaries] DB is up to date (${count} records). Skipping import.`);
    return count;
  }

  console.log('[Notaries] Reading compressed registry source...');
  const rows = source.records;
  console.log(`[Notaries] Parsed ${rows.length} rows`);

  const { notaries, skipped } = buildNotaries(rows, sourceMtime);

  const regionCount = new Set(notaries.map(notary => notary.region)).size;
  const phoneCount = notaries.filter(notary => notary.phone).length;
  const emailCount = notaries.filter(notary => notary.email).length;
  if (notaries.length < 5000 || regionCount !== 20 || phoneCount < 4500 || emailCount < 4500) {
    throw new Error(`[Notaries] Completeness check failed: total=${notaries.length}, regions=${regionCount}, phones=${phoneCount}, emails=${emailCount}`);
  }

  // Replace only after parsing and completeness checks pass. A broken source can
  // no longer wipe the live database.
  await db.remove({}, { multi: true });
  await db.insert(notaries);
  await compactDatastore(db);
  console.log(`[Notaries] Imported ${notaries.length} notaries (${skipped} rows skipped, phones=${phoneCount}, emails=${emailCount})`);
  return notaries.length;
}

if (require.main === module) {
  importNotaries()
    .then(n => { console.log(`Done. ${n} notaries in DB.`); process.exit(0); })
    .catch(e => { console.error('Import failed:', e.message); process.exit(1); });
}

module.exports = { DB_VERSION, validEmail, buildNotaries, importNotaries };
