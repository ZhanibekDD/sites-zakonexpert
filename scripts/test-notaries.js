'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ejs = require('ejs');
const { buildNotaries, validEmail } = require('./import-notaries');
const { CHAMBERS, parseNotaryPage, toRegistryRows } = require('./refresh-notaries-csv');
const { readRegistrySource } = require('../modules/registry-source');
const { REGION_EMBLEMS, getRegionEmblem } = require('../modules/region-emblems');
const {
  NOTARY_REGIONS,
  getNotaryRegionBySlug,
  getNotaryRegionByName,
  withNotaryRegionPaths,
} = require('../modules/notary-regions');
const {
  extractArchiveTransfer,
  findArchiveDirectory,
  nameLikelyMatches,
  officialChamberUrl,
} = require('../modules/notary-archive');

const sample = `
<table border="1">
  <tr><td>№</td><td>ФИО</td><td>Лицензия</td><td>Дата</td><td>Адрес</td><td>Контакты</td><td>Режим</td></tr>
  <tr><td>1</td><td>ИВАНОВ ИВАН ИВАНОВИЧ</td><td>25000001</td><td>01.01.2025</td><td>Астана, Кабанбай батыра, 1</td><td>87010000000,<br><a class="cryptedmail" data-name="ivanov" data-domain="mail" data-tld="kz"></a></td><td>09:00–18:00</td></tr>
</table>`;

const parsedPage = parseNotaryPage(sample, 'город Астана');
assert.strictEqual(parsedPage.length, 1);
assert.strictEqual(parsedPage[0].phone, '87010000000');
assert.strictEqual(parsedPage[0].email, 'ivanov@mail.kz');
assert.strictEqual(CHAMBERS.length, 20, 'all 20 ENIS chambers must be covered');
assert.strictEqual(NOTARY_REGIONS.length, 20, 'all 20 ENIS chambers must have a stable regional URL');
assert.strictEqual(new Set(NOTARY_REGIONS.map(item => item.slug)).size, 20, 'regional notary slugs must be unique');
assert.strictEqual(new Set(NOTARY_REGIONS.map(item => item.sourceName)).size, 20, 'regional notary source names must be unique');
for (const [, region] of CHAMBERS) {
  const regionPage = getNotaryRegionByName(region);
  assert.ok(regionPage, `${region}: stable regional notary URL is missing`);
  assert.strictEqual(getNotaryRegionBySlug(regionPage.slug), regionPage, `${region}: slug lookup is inconsistent`);
}
assert.strictEqual(getNotaryRegionByName('г. Астана').path, '/notaries/astana');
assert.strictEqual(getNotaryRegionByName('область Жетысу').path, '/notaries/zhetisu');
assert.strictEqual(getNotaryRegionByName('область Улытау').path, '/notaries/ulytau');
assert.strictEqual(Object.keys(REGION_EMBLEMS).length, 20, 'all 20 regions must have an emblem');
for (const [, region] of CHAMBERS) {
  const emblem = getRegionEmblem(region);
  assert.ok(emblem, `${region}: region emblem mapping is missing`);
  assert.ok(
    require('fs').existsSync(path.join(__dirname, '..', 'public', 'img', 'regions', `${emblem}.webp`)),
    `${region}: optimized emblem asset is missing`,
  );
}
assert.strictEqual(getRegionEmblem('область Жетысу'), 'jetisu', 'bailiff region alias must resolve');
assert.strictEqual(getRegionEmblem('область Улытау'), 'ulytau', 'bailiff region alias must resolve');
assert.strictEqual(validEmail('Test@Mail.KZ'), 'test@mail.kz');
assert.strictEqual(validEmail('10.00-18.00'), null);
assert.deepStrictEqual(
  extractArchiveTransfer('09:00–18:00 / Передан архивный материал нотариуса ИВАНОВОЙ ИРИНЫ ИВАНОВНЫ, нотариуса ПЕТРОВА ПЕТРА ПЕТРОВИЧА').names,
  ['ИВАНОВОЙ ИРИНЫ ИВАНОВНЫ', 'ПЕТРОВА ПЕТРА ПЕТРОВИЧА'],
);
assert.deepStrictEqual(extractArchiveTransfer('четверг — архивный день').names, [], 'archive workday must not become a transfer');
assert.ok(nameLikelyMatches('Акбурушова Гульнара', 'Акбурушовой Гульнары Жалгасовны'), 'declined Russian names must match');
assert.strictEqual(officialChamberUrl('Актюбинская область'), 'https://enis.kz/Notary/NotaryByChamber/2');

const publicDir = path.join(__dirname, '..', 'public');
const registryNavFiles = fs.readdirSync(publicDir)
  .filter(file => file.endsWith('.html'))
  .map(file => path.join(publicDir, file))
  .concat([
    path.join(__dirname, '..', 'views', 'news', 'layout.ejs'),
    path.join(__dirname, '..', 'views', 'laws', 'layout.ejs'),
  ])
  .filter(file => {
    const html = fs.readFileSync(file, 'utf8');
    return html.includes('nav-dropdown-menu') && html.includes('href="/notary-search"');
  });
assert.ok(registryNavFiles.length >= 30, 'all registry navigation variants must be covered');
for (const file of registryNavFiles) {
  const html = fs.readFileSync(file, 'utf8');
  const searchLink = html.indexOf('href="/notary-search"');
  const archiveLink = html.indexOf('href="/zamena-notariusa"', searchLink);
  const nextDivider = html.indexOf('nav-dropdown-divider', searchLink);
  assert.ok(archiveLink > searchLink, `${path.relative(path.join(__dirname, '..'), file)}: archive search link is missing after notary search`);
  assert.ok(nextDivider === -1 || archiveLink < nextDivider,
    `${path.relative(path.join(__dirname, '..'), file)}: archive search must stay in the notary section`);
}

const source = readRegistrySource(path.join(__dirname, '..', 'registry', 'notaries.json.gz'), 'notaries');
const { notaries } = buildNotaries(source.records, source.sourceMtime);
assert.match(source.sourceFingerprint, /^[a-f0-9]{64}$/, 'registry source must expose a stable SHA-256 fingerprint');
const regions = new Set(notaries.map(item => item.region));
const slugs = new Set(notaries.map(item => item.slug));
assert.ok(notaries.length >= 6000, 'fallback snapshot is unexpectedly incomplete');
assert.strictEqual(regions.size, 20, 'snapshot must contain all 20 chambers');
assert.strictEqual(slugs.size, notaries.length, 'notary slugs must be unique');
assert.ok(notaries.filter(item => item.phone).length >= 5700, 'phone coverage unexpectedly dropped');
assert.ok(notaries.filter(item => item.email).length >= 5700, 'email coverage unexpectedly dropped');
assert.ok(notaries.every(item => !item.email || validEmail(item.email)), 'all stored emails must be valid');
const balabaev = notaries.find(item => item.slug === 'balabaev-bekzat-bolysbekuly');
assert.ok(balabaev, 'complete registry must include Balabaev Bekzat and preserve his public slug');
const aman = notaries.find(item => item.license === '22020237' && item.name === 'АМАН ЖАНЕРКЕ');
assert.ok(aman, 'verified notary override target must exist');
assert.strictEqual(aman.email, 'amanzhanerke87@gmail.com');
const archiveDirectory = findArchiveDirectory(notaries);
assert.ok(archiveDirectory.transfers.length >= 2, 'official ENIS archive-transfer annotations must be extracted');
assert.ok(archiveDirectory.transfers.some(item => item.current), 'at least one archive holder in the snapshot must still be active');
assert.ok(archiveDirectory.transfers.some(item => !item.current), 'inactive archive holder must be flagged as stale');
assert.strictEqual(
  toRegistryRows([{
    region: 'Жамбылская область',
    num: '30',
    name: 'АМАН ЖАНЕРКЕ',
    license: '22020237',
    licenseDate: '01.11.2022',
    address: 'г.Тараз',
    phone: '87071408084',
    email: 'aman_jan87@mail.ru',
    schedule: 'с 9:00 до 18:00',
  }])[0][7],
  'amanzhanerke87@gmail.com',
  'registry refresh must preserve the verified email',
);

(async () => {
  const catalogHtml = await ejs.renderFile(
    path.join(__dirname, '..', 'views', 'notary', 'catalog.ejs'),
    {
      selectedRegion: '',
      regionPage: null,
      allRegions: withNotaryRegionPaths(CHAMBERS.map(([, region]) => ({ region, count: 1 }))),
      regionItems: [],
      lastUpdated: null,
      getRegionEmblem,
    },
  );
  const renderedEmblems = catalogHtml.match(/\/img\/regions\/[a-z-]+\.webp/g) || [];
  assert.strictEqual(renderedEmblems.length, 20, 'catalog template must render all 20 regional emblems');
  assert.ok(catalogHtml.includes('/img/regions/astana.webp'));
  assert.ok(catalogHtml.includes('/img/regions/ulytau.webp'));
  assert.ok(catalogHtml.includes('href="/notaries/astana"'), 'catalog must link to stable regional URLs');
  assert.ok(!catalogHtml.includes('/notaries?region='), 'known ENIS regions must not use query-parameter URLs');

  const astanaRegion = getNotaryRegionBySlug('astana');
  const astanaNotaries = notaries.filter(item => item.region === astanaRegion.sourceName);
  const regionalCounts = withNotaryRegionPaths(CHAMBERS.map(([, chamber]) => ({
    region: chamber,
    count: notaries.filter(item => item.region === chamber).length,
  })));
  const pageSize = 60;
  const totalPages = Math.ceil(astanaNotaries.length / pageSize);
  const regionalCatalogHtml = await ejs.renderFile(
    path.join(__dirname, '..', 'views', 'notary', 'catalog.ejs'),
    {
      selectedRegion: astanaRegion.sourceName,
      regionPage: astanaRegion,
      allRegions: regionalCounts,
      regionItems: astanaNotaries.slice(0, pageSize),
      lastUpdated: new Date('2026-08-24T00:00:00+05:00'),
      getRegionEmblem,
      pagination: { page: 1, pageSize, total: astanaNotaries.length, totalPages },
    },
  );
  assert.ok(astanaNotaries.length > 0, 'Astana regional fixture is empty');
  assert.match(regionalCatalogHtml, /<link rel="canonical" href="https:\/\/zakonexpertt\.kz\/notaries\/astana">/);
  assert.match(regionalCatalogHtml, /<h1>Нотариусы Астаны: список и контакты<\/h1>/);
  assert.ok(regionalCatalogHtml.includes('source=notary&amp;entry=notary_region'), 'regional notary diagnostic bridge is missing');
  assert.ok(regionalCatalogHtml.includes('/zamena-notariusa'), 'archive-holder search must be linked from regional notary pages');
  assert.ok(regionalCatalogHtml.includes('BreadcrumbList') && regionalCatalogHtml.includes('ItemList'), 'regional structured data is incomplete');
  assert.strictEqual((regionalCatalogHtml.match(/<article class="professional-card(?:\s|")/g) || []).length, pageSize,
    'regional response must render one bounded page of notary cards');
  assert.ok(regionalCatalogHtml.length < 250000, 'regional HTML response is unexpectedly large after pagination');
  assert.ok(regionalCatalogHtml.includes('1–60 из ' + astanaNotaries.length), 'visible result range is missing');
  assert.ok(regionalCatalogHtml.includes('href="/notaries/astana?page=2"'), 'next page link is missing');

  const secondPageHtml = await ejs.renderFile(
    path.join(__dirname, '..', 'views', 'notary', 'catalog.ejs'),
    {
      selectedRegion: astanaRegion.sourceName,
      regionPage: astanaRegion,
      allRegions: regionalCounts,
      regionItems: astanaNotaries.slice(pageSize, pageSize * 2),
      lastUpdated: new Date('2026-08-24T00:00:00+05:00'),
      getRegionEmblem,
      pagination: { page: 2, pageSize, total: astanaNotaries.length, totalPages },
    },
  );
  assert.match(secondPageHtml, /<link rel="canonical" href="https:\/\/zakonexpertt\.kz\/notaries\/astana\?page=2">/);
  assert.match(secondPageHtml, /<title>Нотариусы Астаны — страница 2 \| ZakonExpert<\/title>/);
  assert.match(secondPageHtml, /<h1>Нотариусы Астаны: список и контакты — страница 2<\/h1>/);
  assert.ok(secondPageHtml.includes('href="/notaries/astana" rel="prev"'), 'page two must link back to the clean first page');
  assert.ok(secondPageHtml.includes('aria-current="page">2</a>'), 'current pagination page is not exposed accessibly');
  assert.ok(secondPageHtml.includes('"position":61'), 'ItemList positions must continue across pages');

  const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const notariesDbSource = fs.readFileSync(path.join(__dirname, '..', 'modules', 'notaries-db.js'), 'utf8');
  const regionalLanding = fs.readFileSync(path.join(__dirname, '..', 'views', 'regional', 'page.ejs'), 'utf8');
  assert.ok(server.includes("app.get('/notaries/:regionSlug'"), 'clean regional notary route is missing');
  assert.ok(server.includes("return res.redirect(301, regionPage ? regionPage.path : '/notaries')"), 'legacy query URLs must redirect permanently');
  assert.ok(server.includes('const NOTARY_PAGE_SIZE = 60'), 'regional notary response must have a bounded page size');
  assert.ok(server.includes('notariesDb.countByRegion(regionPage.sourceName)'), 'regional pagination must use a real total');
  assert.ok(server.includes('if (requestedPage > totalPages) return sendNotFound(res)'),
    'out-of-range regional pagination must return a real 404 instead of looking like the last page');
  assert.ok(server.includes('return res.redirect(301, normalizedPath)'), 'non-canonical page parameters must redirect');
  assert.ok(notariesDbSource.includes('.sort({ name: 1 }).skip(skip).limit(limit)'), 'database pagination must happen before rendering');
  assert.ok(server.includes('<loc>https://zakonexpertt.kz${r.path}</loc>'), 'notary sitemap must publish clean regional URLs');
  assert.ok(regionalLanding.includes('href="${city.notaryPath}"'), 'regional arrest pages must link to clean notary URLs');

  const profile = notaries.find(item => item.address && item.phone && item.email && item.schedule);
  assert.ok(profile, 'notary profile fixture with public contacts is missing');
  const profileHtml = await ejs.renderFile(
    path.join(__dirname, '..', 'views', 'notary', 'page.ejs'),
    { notary: profile, comments: [], commentStats: null, commentSent: false },
  );
  assert.match(profileHtml, /Официальный реестр ЕНИС/);
  assert.ok(
    profileHtml.includes(encodeURIComponent(`${profile.address}, ${profile.region}, Казахстан`)),
    'notary map lookup must include the region so district-only addresses resolve correctly',
  );
  assert.doesNotMatch(profileHtml, /pagead2\.googlesyndication\.com/,
    'AdSense autoplacement must stay disabled on notary profiles');
  assert.doesNotMatch(profileHtml, /yandex\.ru\/ads\/system\/ap-loader\.js/,
    'Yandex autoplacement must stay disabled on notary profiles');

  const archiveHtml = await ejs.renderFile(
    path.join(__dirname, '..', 'views', 'notary', 'archive-search.ejs'),
    {
      query: '',
      directory: archiveDirectory,
      lastUpdated: new Date('2026-08-23T00:00:00+05:00'),
      chambers: [],
    },
  );
  assert.match(archiveHtml, /Кому передан архив нотариуса/);
  assert.match(archiveHtml, /Обновление каждый день/);
  assert.match(archiveHtml, /Актуально/);
  assert.match(archiveHtml, /Перепроверить/);

  console.log(`Notary data OK: ${notaries.length} records, ${regions.size} chambers`);
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
