'use strict';

const fs = require('fs');
const path = require('path');
const Datastore = require('nedb-promises');
const slugify = require('slugify');
const { compactDatastore } = require('../modules/db-maintenance');

const CSV_PATH = path.join(__dirname, '..', 'bailiffs_all_regions.csv');
const DB_PATH  = path.join(__dirname, '..', 'data', 'bailiffs.db');
const DB_VERSION = 2;

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

// Minimal RFC-4180 CSV parser (handles quoted fields with embedded commas/newlines)
function parseCSV(content) {
  if (content.charCodeAt(0) === 0xFEFF) content = content.slice(1);
  const rows = [];
  let i = 0;
  const n = content.length;

  while (i < n) {
    const row = [];
    while (i < n) {
      let field;
      if (content[i] === '"') {
        i++;
        field = '';
        while (i < n) {
          if (content[i] === '"' && i + 1 < n && content[i + 1] === '"') {
            field += '"'; i += 2;
          } else if (content[i] === '"') {
            i++; break;
          } else {
            field += content[i++];
          }
        }
      } else {
        const start = i;
        while (i < n && content[i] !== ',' && content[i] !== '\r' && content[i] !== '\n') i++;
        field = content.slice(start, i).trim();
      }
      row.push(field);
      if (i < n && content[i] === ',') { i++; } else { break; }
    }
    if (i < n && content[i] === '\r') i++;
    if (i < n && content[i] === '\n') i++;
    if (row.some(f => f.trim())) rows.push(row);
  }
  return rows;
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

async function importBailiffs() {
  if (!fs.existsSync(CSV_PATH)) {
    console.error('[Bailiffs] CSV not found:', CSV_PATH);
    return 0;
  }

  const csvMtime = fs.statSync(CSV_PATH).mtimeMs;
  const db = Datastore.create({ filename: DB_PATH, autoload: true });

  await db.ensureIndex({ fieldName: 'slug'   }).catch(() => {});
  await db.ensureIndex({ fieldName: 'name'   }).catch(() => {});
  await db.ensureIndex({ fieldName: 'region' }).catch(() => {});

  // Skip import if DB already reflects this CSV version
  const existing = await db.findOne({}, { csvMtime: 1, dbVersion: 1 });
  if (existing && existing.csvMtime >= csvMtime && existing.dbVersion === DB_VERSION) {
    const count = await db.count({});
    console.log(`[Bailiffs] DB is up to date (${count} records). Skipping import.`);
    return count;
  }

  console.log('[Bailiffs] Reading CSV...');
  const content = fs.readFileSync(CSV_PATH, 'utf8');
  const rows    = parseCSV(content);
  console.log(`[Bailiffs] Parsed ${rows.length} rows`);

  await db.remove({}, { multi: true });

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
      csvMtime,
      dbVersion: DB_VERSION,
      updatedAt: new Date(),
    });
  }

  if (bailiffs.length === 0) {
    console.error('[Bailiffs] No valid rows found!');
    return 0;
  }

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

module.exports = { importBailiffs, parseCSV, parseCombinedField };
