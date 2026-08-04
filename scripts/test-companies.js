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
const {
  backfill,
  backfillDatabase,
  currentRowsCanBeReconciled,
  qualityRowsNeedBackfill,
} = require('./backfill-company-quality');
backfill();
process.argv.pop();

// Directory enrichment adds non-indexable rows after the official import.
// When the formula version is unchanged, repairing its aggregate counters
// must not rewrite every company row (the production database has 1.2M rows).
const metadataDb = new DatabaseSync(dbPath);
metadataDb.prepare("UPDATE company_meta SET value = '1' WHERE key = 'record_count'").run();
metadataDb.prepare("DELETE FROM company_meta WHERE key = 'completed_at'").run();
assert.strictEqual(currentRowsCanBeReconciled(metadataDb), true,
  'healthy quality rows must allow metadata-only reconciliation');
backfillDatabase(metadataDb);
assert.strictEqual(
  metadataDb.prepare("SELECT value FROM company_meta WHERE key = 'record_count'").get().value,
  '2',
  'metadata-only reconciliation must repair the aggregate record count'
);
assert(
  metadataDb.prepare("SELECT value FROM company_meta WHERE key = 'completed_at'").get()?.value,
  'metadata reconciliation must restore catalog activation from completed import evidence'
);
metadataDb.close();

// A previous monolithic backfill could be killed after metadata was marked as
// current but before persisted quality rows were repaired. Detect row drift
// even when quality_version and aggregate counters look valid, then resume in
// bounded batches instead of trusting the stale marker.
const driftDb = new DatabaseSync(dbPath);
driftDb.prepare(
  'UPDATE companies SET quality_score = 0, is_indexable = 0 WHERE id = ?'
).run(7137221);
driftDb.prepare("UPDATE company_meta SET value = '0' WHERE key = 'indexable_count'").run();
driftDb.prepare("UPDATE company_meta SET value = '2' WHERE key = 'excluded_count'").run();
assert.strictEqual(qualityRowsNeedBackfill(driftDb), true,
  'persisted row drift must be detected independently of metadata version');
assert.strictEqual(currentRowsCanBeReconciled(driftDb), false,
  'corrupt quality rows must never take the metadata-only shortcut');
backfillDatabase(driftDb, { batchSize: 1000 });
assert.strictEqual(qualityRowsNeedBackfill(driftDb), false,
  'resumable backfill must repair persisted quality rows');
  assert.strictEqual(
    Number(driftDb.prepare('SELECT is_indexable FROM companies WHERE id = ?').get(7137221).is_indexable),
  1,
    'a rich official company must return to the sitemap after row repair'
  );
  const browsePlan = driftDb.prepare(`
    EXPLAIN QUERY PLAN
    SELECT id FROM companies WHERE is_indexable = 1 ORDER BY id LIMIT 31 OFFSET 0
  `).all().map(row => String(row.detail || '')).join(' | ');
  assert(browsePlan.includes('companies_indexable_idx'),
    `public browsing must use companies_indexable_idx; received: ${browsePlan}`);
  assert(!/TEMP B-TREE/i.test(browsePlan),
    `public browsing must not sort the full registry; received: ${browsePlan}`);
  driftDb.close();

const companies = require('../modules/companies-db');
assert.strictEqual(companies.stats().count, 2);
assert.strictEqual(companies.stats().indexableCount, 1);
assert.strictEqual(companies.stats().excludedCount, 1);
assert.strictEqual(companies.findById(7137221).bin, '970540001234');
assert.strictEqual(companies.search('Альфа').items.length, 1);
  assert.strictEqual(companies.search('970540001234').items.length, 1);
  assert.deepStrictEqual(companies.browse().items.map(item => item.id), [7137221],
    'public catalog browsing must exclude thin noindex rows');
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
  assert(itemHtml.includes('data-company-whatsapp'), 'company card must expose tracked WhatsApp CTAs');
  assert(itemHtml.includes('data-company-page-type="company_card"'),
    'company card must identify its funnel page type');
  assert(itemHtml.includes('data-cta-position="mobile-sticky"'),
    'company card must expose the mobile conversion bar');
  assert(itemHtml.includes('data-offer-b='), 'company card must render both A/B offer variants');
  assert(itemHtml.includes('/js/company-conversion.js'),
    'company card must load the conversion funnel controller');
  assert(itemHtml.includes('class="company-info-row"'),
    'company facts must use the responsive mobile row layout');
  assert(!itemHtml.includes('pagead2.googlesyndication.com'),
    'company pages must not load intrusive Google auto-placement ads');
  assert(!itemHtml.includes('yandex.ru/ads/system'),
    'company pages must not load intrusive Yandex auto-placement ads');
  assert(itemHtml.includes('%2Fcompany%2F7137221-'),
    'company WhatsApp message must carry the exact card URL');
  assert(itemHtml.includes('%D0%91%D0%98%D0%9D%3A%20970540001234'),
    'company WhatsApp message must carry the BIN');
  for (const route of [
    '/snyatie-ogranichenii-chsi',
    '/otmena-ispolnitelnoi-nadpisi',
    '/grafik-oplaty-zadolzhennosti',
    '/marshrut-dolzhnika',
  ]) {
    assert(itemHtml.includes(`href="${route}"`), `company card must link to ${route}`);
  }
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
  const analyticsSource = fs.readFileSync(
    path.join(__dirname, '..', 'public', 'js', 'analytics-events.js'),
    'utf8'
  );
  assert(analyticsSource.includes("send('click_cta_company'"),
    'company WhatsApp clicks must be recorded as a dedicated conversion event');
  const conversionSource = fs.readFileSync(
    path.join(__dirname, '..', 'public', 'js', 'company-conversion.js'),
    'utf8'
  );
  assert(conversionSource.includes("track('view_company_page'"),
    'company page views must provide the conversion denominator');
  assert(conversionSource.includes("track('view_company_cta'"),
    'visible CTA impressions must be tracked by position');
  console.log('Company data OK: normalization, SQLite search, templates and sitemap chunks');
}).finally(() => {
  companies.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
}).catch(error => {
  console.error(error);
  process.exitCode = 1;
});
