'use strict';

const fs   = require('fs');
const path = require('path');
const Datastore = require('nedb-promises');
const slugify = require('slugify');
const { compactDatastore } = require('../modules/db-maintenance');

const CSV_PATH = path.join(__dirname, '..', 'lawyers_all_regions.csv');
const DB_PATH  = path.join(__dirname, '..', 'data', 'lawyers.db');
const DB_VERSION = 2;

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

// Minimal RFC-4180-compatible CSV parser that handles quoted fields
function parseCSV(content) {
  if (content.charCodeAt(0) === 0xFEFF) content = content.slice(1); // strip BOM
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

function parsePhones(raw) {
  if (!raw) return [];
  return raw
    .split(/[,;]+/)
    .map(p => p.trim())
    .filter(p => /[+\d]/.test(p) && p.replace(/\D/g, '').length >= 5);
}

async function importLawyers() {
  if (!fs.existsSync(CSV_PATH)) {
    console.error('[Lawyers] CSV not found:', CSV_PATH);
    return 0;
  }

  const csvMtime = fs.statSync(CSV_PATH).mtimeMs;

  const db = Datastore.create({ filename: DB_PATH, autoload: true });
  await db.ensureIndex({ fieldName: 'slug'   }).catch(() => {});
  await db.ensureIndex({ fieldName: 'name'   }).catch(() => {});
  await db.ensureIndex({ fieldName: 'region' }).catch(() => {});

  const existing = await db.findOne({}, { csvMtime: 1, dbVersion: 1 });
  if (existing && existing.csvMtime >= csvMtime && existing.dbVersion === DB_VERSION) {
    const count = await db.count({});
    console.log(`[Lawyers] DB up to date (${count} records). Skipping.`);
    return count;
  }

  console.log('[Lawyers] Reading CSV...');
  const content = fs.readFileSync(CSV_PATH, 'utf8');
  const rows    = parseCSV(content);
  console.log(`[Lawyers] Parsed ${rows.length} rows`);

  await db.remove({}, { multi: true });

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
      csvMtime,
      dbVersion: DB_VERSION,
      updatedAt: new Date(),
    });
  }

  if (lawyers.length === 0) {
    console.error('[Lawyers] No valid rows found! Check CSV format.');
    return 0;
  }

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

module.exports = { importLawyers };
