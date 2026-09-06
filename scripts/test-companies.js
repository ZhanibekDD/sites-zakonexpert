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
database.prepare('UPDATE companies SET phone = ?, email = ? WHERE id = ?')
  .run('+7 (727) 123-45-67', 'info@alpha.kz', sample.id);
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

const malformedDetailsDb = new DatabaseSync(dbPath);
malformedDetailsDb.prepare(`
  INSERT INTO organization_details(
    company_id, source_key, details_json, search_text, created_run, last_seen_run, updated_at
  ) VALUES(?, ?, ?, '', 1, 1, ?)
`).run(
  sample.id,
  'malformed_test',
  JSON.stringify({ a: [null, ['Дополнительный адрес']], x: [false, ['work_hours', '09:00–18:00', '', 1]] }),
  '2026-08-23T00:00:00.000Z'
);
malformedDetailsDb.close();

const companies = require('../modules/companies-db');
assert.strictEqual(companies.stats().count, 2);
assert.strictEqual(companies.stats().indexableCount, 1);
assert.strictEqual(companies.stats().excludedCount, 1);
assert.strictEqual(companies.findById(7137221).bin, '970540001234');
assert.strictEqual(companies.findByBin('970540001234').leader, 'ИВАНОВ ИВАН ИВАНОВИЧ');
assert.strictEqual(companies.search('Альфа').items.length, 1);
assert.strictEqual(companies.search('Альфа').items[0].phone, '+7 (727) 123-45-67');
assert.strictEqual(companies.search('Альфа').items[0].email, 'info@alpha.kz');
  assert.strictEqual(companies.search('970540001234').items.length, 1);
  assert.deepStrictEqual(companies.browse().items.map(item => item.id), [7137221],
    'public catalog browsing must exclude thin noindex rows');
assert.strictEqual(companies.sitemapChunkCount(), 1);
assert.strictEqual(companies.sitemapChunk(1).length, 1);

const company = companies.findById(7137221);
const lowQualityCompany = companies.findById(7137497);
const companyWithPublisherPhone = {
  ...company,
  contacts: [
    ...(company.contacts || []),
    { type: 'phone', value: '+7 (705) 876-27-95', normalized: '+77058762795' },
  ],
};
assert.strictEqual(company.addresses.some(item => item.value === 'Дополнительный адрес'), true,
  'malformed supplemental detail tuples must be ignored without breaking the company card');
assert.strictEqual(companies.quality({ ...company, is_indexable: 0 }).indexable, false,
  'persisted indexability must keep card meta aligned with the sitemap');
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
  ejs.renderFile(path.join(__dirname, '..', 'views', 'companies', 'item.ejs'), {
    company: companyWithPublisherPhone,
    sourceUpdatedAt: '2026-07-16',
    regionName: null,
    companyQuality: companies.quality(companyWithPublisherPhone),
    localized: false,
    locale: getLocale('ru'),
    copy: getLocale('ru'),
    languages: catalogData.languages,
    companyCatalogPath: '/companies',
  }),
  ejs.renderFile(path.join(__dirname, '..', 'views', 'companies', 'regions.ejs'), {
    regions: [{ slug: 'almaty', label: 'Алматы', count: 1 }],
    stats: { available: true, count: 1 },
  }),
  ejs.renderFile(path.join(__dirname, '..', 'views', 'companies', 'region.ejs'), {
    slug: 'almaty',
    results: { label: 'Алматы', items: [company], page: 1, hasMore: false },
  }),
  ...localizedCatalogPromises,
]).then(([
  catalogHtml,
  itemHtml,
  lowQualityHtml,
  localizedItemHtml,
  publisherPhoneHtml,
  regionsHtml,
  regionHtml,
  ...localizedCatalogs
]) => {
  assert(catalogHtml.includes('Альфа Право'));
  assert(catalogHtml.includes('noindex'));
  assert(itemHtml.includes('БИН 970540001234'));
  assert(itemHtml.includes('application/ld+json'));
  assert(itemHtml.includes('alfa pravo'), 'Latin alias must be visible and present in schema');
  assert(!itemHtml.includes('aggregateRating'), 'unattributed directory ratings must not be published');
  assert(!itemHtml.includes('noindex,follow'), 'rich company must be indexable');
  for (const [page, html] of [
    ['catalog', catalogHtml],
    ['company card', itemHtml],
    ['company card with contaminated source data', publisherPhoneHtml],
    ['regions', regionsHtml],
    ['regional catalog', regionHtml],
  ]) {
    assert(html.includes('data-suppress-zakonexpert-contacts'),
      `${page} must disable site-wide ZakonExpert contact injection`);
    assert(!html.includes('77058762795'), `${page} must not expose the ZakonExpert phone`);
    assert(!html.includes('+7 (705) 876-27-95'), `${page} must not show the ZakonExpert phone label`);
    assert(!html.includes('wa.me/77058762795'), `${page} must not link to ZakonExpert WhatsApp`);
    assert(!html.includes('/js/chatbot.js'), `${page} must not inject a contact widget`);
  }
  assert(!itemHtml.includes('data-company-whatsapp'),
    'company cards must not expose ZakonExpert conversion links');
  assert(!itemHtml.includes('data-cta-position="mobile-sticky"'),
    'company cards must not expose a ZakonExpert mobile contact bar');
  assert(!itemHtml.includes('/js/company-conversion.js'),
    'company cards must not load the retired contact funnel controller');
  assert(itemHtml.includes('class="company-info-row"'),
    'company facts must use the responsive mobile row layout');
  assert(itemHtml.includes('/css/company-directory.css?v=20260904-1'),
    'company cards must load their directory layout independently of the retired contact funnel');
  assert(!itemHtml.includes('/css/company-conversion.css'),
    'company cards must not restore the retired contact funnel stylesheet');
  const directoryCss = fs.readFileSync(
    path.join(__dirname, '..', 'public', 'css', 'company-directory.css'),
    'utf8'
  );
  for (const selector of ['.company-item-grid', '.company-info-card', '.company-info-row']) {
    assert(directoryCss.includes(selector), `company directory stylesheet is missing ${selector}`);
  }
  assert(!itemHtml.includes('pagead2.googlesyndication.com'),
    'company pages must not load intrusive Google auto-placement ads');
  assert(!itemHtml.includes('yandex.ru/ads/system'),
    'company pages must not load intrusive Yandex auto-placement ads');
  for (const route of [
    '/snyatie-ogranichenii-chsi',
    '/otmena-ispolnitelnoi-nadpisi',
    '/grafik-oplaty-zadolzhennosti',
    '/marshrut-dolzhnika',
  ]) {
    assert(!itemHtml.includes(`href="${route}"`), `company card must not advertise ${route}`);
  }
  assert(!itemHtml.includes('href="/contact"'),
    'company pages must not link visitors into the ZakonExpert contact funnel');
  assert(itemHtml.includes('class="company-language-picker"'),
    'company language selection must use the repaired header control');
  assert(itemHtml.includes('class="company-language-picker__select"'),
    'company language selection must not depend on fragile inline styles');
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
    assert(html.includes(`https://zakonexpert.kz${catalogPath(code)}`));
    assert(html.includes('hreflang="x-default"'));
    for (const alternate of INDEXABLE_LOCALES) {
      assert(html.includes(`hreflang="${getLocale(alternate).hreflang}"`));
    }
  });
  const siteSource = fs.readFileSync(
    path.join(__dirname, '..', 'public', 'js', 'site.js'),
    'utf8'
  );
  assert(/hasAttribute\(\s*'data-suppress-zakonexpert-contacts'\s*\)/.test(siteSource),
    'site-wide contact injection must honor the company-page suppression marker');
  assert(siteSource.includes('!suppressZakonExpertContacts && !document.querySelector'),
    'company pages must not receive the global WhatsApp QR dock');
  assert(siteSource.includes("action=\"/poisk\""),
    'all shared pages must receive the global site search form');
  console.log('Company data OK: normalization, SQLite search, templates and sitemap chunks');
}).finally(() => {
  companies.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
}).catch(error => {
  console.error(error);
  process.exitCode = 1;
});
