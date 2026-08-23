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
      allRegions: CHAMBERS.map(([, region]) => ({ region, count: 1 })),
      regionItems: [],
      lastUpdated: null,
      getRegionEmblem,
    },
  );
  const renderedEmblems = catalogHtml.match(/\/img\/regions\/[a-z-]+\.webp/g) || [];
  assert.strictEqual(renderedEmblems.length, 20, 'catalog template must render all 20 regional emblems');
  assert.ok(catalogHtml.includes('/img/regions/astana.webp'));
  assert.ok(catalogHtml.includes('/img/regions/ulytau.webp'));

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
