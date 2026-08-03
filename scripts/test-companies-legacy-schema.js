'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const ejs = require('ejs');
const { DatabaseSync } = require('node:sqlite');
const { QUALITY_VERSION } = require('../modules/company-quality');
const {
  INDEXABLE_LOCALES,
  catalogAlternates,
  catalogPath,
  getLocale,
} = require('../modules/company-i18n');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zakonexpert-companies-legacy-'));
const dbPath = path.join(tempDir, 'companies.sqlite');
process.env.COMPANIES_DB_PATH = dbPath;

const database = new DatabaseSync(dbPath);
database.exec(`
  CREATE TABLE companies (
    id INTEGER PRIMARY KEY,
    bin TEXT,
    name_ru TEXT NOT NULL,
    name_kk TEXT,
    registration_date TEXT,
    address_ru TEXT,
    activity_ru TEXT,
    leader TEXT,
    status_ru TEXT,
    imported_at TEXT NOT NULL,
    quality_score INTEGER NOT NULL DEFAULT 0,
    is_indexable INTEGER NOT NULL DEFAULT 0,
    region_slug TEXT,
    phone TEXT,
    mobile_phone TEXT,
    email TEXT,
    website TEXT,
    whatsapp TEXT,
    viber TEXT,
    telegram TEXT,
    work_hours TEXT,
    rating TEXT,
    review_count TEXT,
    lat TEXT,
    lon TEXT,
    contact_source TEXT,
    contact_updated_at TEXT
  );
  CREATE TABLE company_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE VIRTUAL TABLE companies_fts USING fts5(
    name_ru, name_kk, bin,
    content='companies', content_rowid='id',
    tokenize='unicode61 remove_diacritics 2'
  );
`);

const insert = database.prepare(`
  INSERT INTO companies(
    id, bin, name_ru, name_kk, registration_date, address_ru,
    activity_ru, leader, status_ru, imported_at, quality_score,
    is_indexable, region_slug, phone, email, contact_source
  ) VALUES(?, ?, ?, NULL, NULL, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?)
`);
insert.run(
  1001, '970540001234', 'ТОО Альфа Право', 'г. Алматы, ул. Абая, 10',
  'Юридическая деятельность', 'Зарегистрирован', '2026-07-16', 80, 1,
  'almaty-city', '+7 (727) 111-11-11', 'alpha@example.kz', null
);
insert.run(
  1002, null, 'Бета Сервис', 'г. Алматы, ул. Сатпаева, 5',
  'Деловые услуги', null, '2026-07-31', 0, 0,
  'almaty-city', '+7 (777) 555-44-33', 'beta@example.kz', 'directory'
);
database.exec(`
  INSERT INTO companies_fts(rowid, name_ru, name_kk, bin)
    SELECT id, name_ru, name_kk, bin FROM companies;
`);
const setMeta = database.prepare('INSERT INTO company_meta(key, value) VALUES(?, ?)');
for (const [key, value] of [
  ['completed_at', '2026-07-31T00:00:00.000Z'],
  ['record_count', '2'],
  ['quality_version', QUALITY_VERSION],
  ['indexable_count', '1'],
]) setMeta.run(key, value);
database.close();

const companies = require('../modules/companies-db');
try {
  const info = companies.stats();
  assert.strictEqual(info.available, true);
  assert.strictEqual(info.count, 2);
  assert.strictEqual(info.officialCount, null);
  assert.strictEqual(info.directoryOnlyCount, null);
  assert.strictEqual(info.withContactsCount, null);

  const browse = companies.browse();
  assert.strictEqual(browse.items.length, 1,
    'legacy catalog browsing must hide persisted noindex rows once quality metadata is ready');
  assert.strictEqual(browse.items[0].is_official_source, true);

  assert.strictEqual(companies.search('Альфа').items.length, 1);
  assert.strictEqual(
    companies.search('Бета').items[0].primary_source_key,
    'business_directory_kz_2026'
  );
  assert.strictEqual(companies.byRegion('almaty-city').items.length, 1);

  const locale = getLocale('ru');
  const templatePath = path.join(__dirname, '..', 'views', 'companies', 'catalog.ejs');
  const catalogHtml = ejs.render(fs.readFileSync(templatePath, 'utf8'), {
    query: '',
    results: browse,
    stats: info,
    locale,
    copy: locale,
    alternates: catalogAlternates(),
    languages: INDEXABLE_LOCALES.map(code => ({
      code,
      nativeName: getLocale(code).nativeName,
      href: catalogPath(code),
      companyHref: catalogPath(code),
    })),
    companyCatalogPath: '/companies',
    companyItemPrefix: '/company/',
  }, { filename: templatePath });
  assert(!catalogHtml.includes('Бета Сервис'),
    'thin legacy rows must remain searchable but stay out of crawlable listings');
  assert(!catalogHtml.includes('дополнительных организаций'),
    'unknown legacy counters must be hidden instead of displayed as zero');

  const directoryCompany = companies.findById(1002);
  assert.strictEqual(directoryCompany.contacts[0].sourceKey, 'business_directory_kz_2026');
  console.log('Legacy company schema OK: catalog reads remain available before offline migration');
} finally {
  companies.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
}
