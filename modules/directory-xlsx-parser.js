'use strict';

// Minimal, fast reader for the specific xlsx export format used by the
// "Казахстан.zip" business-directory archive: single sheet, no shared
// strings table, every cell is an inline string (t="inlineStr"). Avoids a
// full xlsx library — these files are simple enough that a targeted regex
// pass over the raw worksheet XML is both correct and much faster than a
// generic parser across ~1500 files.

const AdmZip = require('adm-zip');

const COLUMNS = [
  'id', 'name', 'region', 'city', 'address', 'postal_index',
  'phone', 'mobile_phone', 'email', 'website', 'category', 'subcategory',
  'work_hours', 'payment_methods', 'whatsapp', 'viber', 'telegram',
  'vkontakte', 'odnoklassniki', 'youtube', 'fax', 'rutube', 'yandex_zen',
  'rating_count', 'rating', 'review_count', 'lat', 'lon',
];

const ENTITY_MAP = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decodeXmlEntities(text) {
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-z]+);/g, (match, code) => {
    if (code[0] === '#') {
      const codePoint = code[1] === 'x' || code[1] === 'X'
        ? Number.parseInt(code.slice(2), 16)
        : Number.parseInt(code.slice(1), 10);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match;
    }
    return ENTITY_MAP[code] || match;
  });
}

function colLetterToIndex(letter) {
  let index = 0;
  for (let i = 0; i < letter.length; i++) {
    index = index * 26 + (letter.charCodeAt(i) - 64);
  }
  return index - 1;
}

const CELL_RE = /<c r="([A-Z]+)\d+"[^>]*>(?:<is><t[^>]*>([\s\S]*?)<\/t><\/is>|<is\/>)?<\/c>/g;
const ROW_RE = /<row[^>]*>([\s\S]*?)<\/row>/g;

function parseRow(rowXml) {
  const cells = new Array(COLUMNS.length).fill('');
  let match;
  CELL_RE.lastIndex = 0;
  while ((match = CELL_RE.exec(rowXml))) {
    const idx = colLetterToIndex(match[1]);
    if (idx >= 0 && idx < COLUMNS.length && match[2]) {
      cells[idx] = decodeXmlEntities(match[2]).trim();
    }
  }
  return cells;
}

// Reads one inner .xlsx buffer, returns an array of row objects (header row skipped).
function parseXlsxBuffer(buffer) {
  const zip = new AdmZip(buffer);
  const sheetEntry = zip.getEntry('xl/worksheets/sheet1.xml');
  if (!sheetEntry) return [];
  const xml = sheetEntry.getData().toString('utf8');

  const rows = [];
  let match;
  let isFirst = true;
  ROW_RE.lastIndex = 0;
  while ((match = ROW_RE.exec(xml))) {
    if (isFirst) { isFirst = false; continue; } // header row
    const cells = parseRow(match[1]);
    if (!cells[1]) continue; // no name — skip
    const row = {};
    COLUMNS.forEach((key, i) => { row[key] = cells[i]; });
    rows.push(row);
  }
  return rows;
}

// Lists every .xlsx path inside the outer archive, and a reader for one entry.
function openArchive(zipPath) {
  const zip = new AdmZip(zipPath);
  const entries = zip.getEntries().filter(e => !e.isDirectory && e.entryName.toLowerCase().endsWith('.xlsx'));
  return {
    entries: entries.map(e => e.entryName),
    readEntry(entryName) {
      const entry = zip.getEntry(entryName);
      if (!entry) return [];
      return parseXlsxBuffer(entry.getData());
    },
  };
}

module.exports = { COLUMNS, openArchive, parseXlsxBuffer };
