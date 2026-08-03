'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const ejs = require('ejs');
const { DatabaseSync } = require('node:sqlite');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zakonexpert-companies-'));
const dbPath = path.join(tempDir, 'companies.sqlite');
process.env.COMPANIES_DB_PATH = dbPath;

const { createSchema, rebuildSearch } = require('../modules/companies-schema');
const { insertRows, normalizeCompanyRow, parseArgs } = require('./import-companies-egov');
const {
  INDEXABLE_LOCALES,
  catalogAlternates,
  catalogPath,
  companyPath,
  getLocale,
} = require('../modules/company-i18n');

const sample = {
  id: 7137221,
  registerdate: '1997-05-26',
  nameru: 'Товарищество с ограниченной ответственностью "Альфа Право"',
  namekz: '"Альфа Құқық" жауапкершілігі шектеулі серіктестігі',
  bin: '970540001234',
  fio: 'ИВАНОВ ИВАН ИВАНОВИЧ',
  addressru: 'г. Алматы, ул. Абая, 10',
  okedru: 'Юридическая деятельность',
  statusru: 'Зарегистрирован',
};
const lowQualitySample = {
  id: 7137497,
  nameru: 'Акционерное общество закрытого типа "Туран"',
  namekz: 'Жабық акционерлік қоғам',
  datereg: '1997-04-20',
  director: 'АБИШЕВ ИСЛАМ АЛМАХАНОВИЧ',
  statusru: 'Зарегистрирован',
  bin: '',
};

const normalized = normalizeCompanyRow(sample);
assert(normalized, 'row must normalize');
assert.strictEqual(normalized.id, 7137221);
assert.strictEqual(normalized.bin, '970540001234');
assert(normalized.slug.startsWith('7137221-'));
assert.strictEqual(normalizeCompanyRow(lowQualitySample).registrationDate, '1997-04-20',
  'the live eGov datereg field must map to registration_date');
assert.strictEqual(parseArgs(['--id=7137497', '--confirm-offline']).targetId, 7137497);

const database = new DatabaseSync(dbPath);
createSchema(database);
assert.strictEqual(insertRows(database, [sample, lowQualitySample], '2026-07-16T00:00:00.000Z'), 2);
database.prepare('INSERT INTO company_meta(key, value) VALUES(?, ?)').run('source_updated_at', '2026-07-16');
database.prepare('INSERT INTO company_meta(key, value) VALUES(?, ?)').run('source_url', 'https://data.egov.kz/datasets/view?index=gbd_ul');
database.prepare('INSERT INTO company_meta(key, value) VALUES(?, ?)').run('completed_at', '2026-07-16');
rebuildSearch(database);
database.prepare('UPDATE companies SET quality_score = 0, is_indexable = 0').run();
database.close();

process.argv.push('--confirm-offline');
const { backfill, backfillDatabase } = require('./backfill-company-quality');
backfill();
process.argv.pop();

// Directory enrichment adds non-indexable rows after the official import.
// When the formula version is unchanged, repairing its aggregate counters
// must not rewrite every company row (the production database has 1.2M rows).
const metadataDb = new DatabaseSync(dbPath);
metadataDb.prepare('UPDATE companies SET quality_score = 99 WHERE id = ?').run(7137497);
metadataDb.prepare("UPDATE company_meta SET value = '1' WHERE key = 'record_count'").run();
backfillDatabase(metadataDb);
assert.strictEqual(
  Number(metadataDb.prepare('SELECT quality_score FROM companies WHERE id = ?').get(7137497).quality_score),
  99,
  'metadata-only reconciliation must not rewrite company rows'
);
assert.strictEqual(
  metadataDb.prepare("SELECT value FROM company_meta WHERE key = 'record_count'").get().value,
  '2',
  'metadata-only reconciliation must repair the aggregate record count'
);
metadataDb.close();

const companies = require('../modules/companies-db');
assert.strictEqual(companies.stats().count, 2);
assert.strictEqual(companies.stats().indexableCount, 1);
assert.strictEqual(companies.stats().excludedCount, 1);
assert.strictEqual(companies.findById(7137221).bin, '970540001234');
assert.strictEqual(companies.search('Альфа').items.length, 1);
assert.strictEqual(companies.search('970540001234').items.length, 1);
assert.strictEqual(companies.sitemapChunkCount(), 1);
assert.strictEqual(companies.sitemapChunk(1).length, 1);

const company = companies.findById(7137221);
const lowQualityCompany = companies.findById(7137497);
assert.strictEqual(lowQualityCompany.is_official_source, true,
  'an official registry row without BIN must not be mislabeled as a directory record');
assert.strictEqual(lowQualityCompany.has_verified_bin, false);
assert.strictEqual(lowQualityCompany.display_name_kk, null,
  'a generic legal form must not be shown as the organization name');
const catalogData = {
  query: 'Альфа',
  results: companies.search('Альфа'),
  stats: companies.stats(),
  locale: getLocale('ru'),
  copy: getLocale('ru'),
  alternates: catalogAlternates(),
  languages: INDEXABLE_LOCALES.map(code => ({
    code,
    nativeName: getLocale(code).nativeName,
    href: catalogPath(code),
    companyHref: companyPath(code, company.slug),
  })),
  companyCatalogPath: '/companies',
  companyItemPrefix: '/company/',
};
const localizedCatalogPromises = INDEXABLE_LOCALES.map(code => ejs.renderFile(
  path.join(__dirname, '..', 'views', 'companies', 'catalog.ejs'),
  {
    ...catalogData,
    query: '',
    results: companies.browse(),
    locale: getLocale(code),
    copy: getLocale(code),
    companyCatalogPath: catalogPath(code),
    companyItemPrefix: code === 'ru' ? '/company/' : `/${code}/company/`,
  }
));

Promise.all([
  ejs.renderFile(path.join(__dirname, '..', 'views', 'companies', 'catalog.ejs'), catalogData),
  ejs.renderFile(path.join(__dirname, '..', 'views', 'companies', 'item.ejs'), {
    company,
    sourceUpdatedAt: '2026-07-16',
    regionName: null,
    companyQuality: companies.quality(company),
    localized: false,
    locale: getLocale('ru'),
    copy: getLocale('ru'),
    languages: catalogData.languages,
    companyCatalogPath: '/companies',
  }),
  ejs.renderFile(path.join(__dirname, '..', 'views', 'companies', 'item.ejs'), {
    company: lowQualityCompany,
    sourceUpdatedAt: '2026-07-16',
    regionName: null,
    companyQuality: companies.quality(lowQualityCompany),
    localized: false,
    locale: getLocale('ru'),
    copy: getLocale('ru'),
    languages: catalogData.languages,
    companyCatalogPath: '/companies',
  }),
  ejs.renderFile(path.join(__dirname, '..', 'views', 'companies', 'item.ejs'), {
    company,
    sourceUpdatedAt: '2026-07-16',
    regionName: null,
    companyQuality: companies.quality(company),
    localized: true,
    locale: getLocale('en'),
    copy: getLocale('en'),
    languages: catalogData.languages,
    companyCatalogPath: '/en/companies',
  }),
  ...localizedCatalogPromises,
]).then(([catalogHtml, itemHtml, lowQualityHtml, localizedItemHtml, ...localizedCatalogs]) => {
  assert(catalogHtml.includes('Альфа Право'));
  assert(catalogHtml.includes('noindex'));
  assert(itemHtml.includes('БИН 970540001234'));
  assert(itemHtml.includes('application/ld+json'));
  assert(itemHtml.includes('alfa pravo'), 'Latin alias must be visible and present in schema');
  assert(!itemHtml.includes('aggregateRating'), 'unattributed directory ratings must not be published');
  assert(!itemHtml.includes('noindex,follow'), 'rich company must be indexable');
  assert(lowQualityHtml.includes('noindex,follow'), 'thin company must be noindex');
  assert(lowQualityHtml.includes('Официальные регистрационные сведения'));
  assert(lowQualityHtml.includes('Зарегистрирован'),
    'official status must remain visible even when BIN is absent');
  assert(lowQualityHtml.includes('В официальном источнике отсутствуют'));
  assert(!lowQualityHtml.includes('Жабық акционерлік қоғам'),
    'generic Kazakh legal form must not leak into aliases or JSON-LD');
  assert(!lowQualityHtml.includes('Бизнес-справочник'),
    'official source rows without BIN must not receive the directory badge');
  assert(localizedItemHtml.includes('noindex,follow'),
    'localized company UI must not multiply thin translated card URLs');
  INDEXABLE_LOCALES.forEach((code, index) => {
    const html = localizedCatalogs[index];
    assert(html.includes(`lang="${getLocale(code).hreflang}"`));
    assert(html.includes(`https://zakonexpertt.kz${catalogPath(code)}`));
    assert(html.includes('hreflang="x-default"'));
    for (const alternate of INDEXABLE_LOCALES) {
      assert(html.includes(`hreflang="${getLocale(alternate).hreflang}"`));
    }
  });
  console.log('Company data OK: normalization, SQLite search, templates and sitemap chunks');
}).finally(() => {
  companies.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
}).catch(error => {
  console.error(error);
  process.exitCode = 1;
});
