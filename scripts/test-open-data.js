'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const ejs = require('ejs');
const { OPEN_DATA_DATASETS } = require('../modules/open-data-config');
const {
  aggregateDataset,
  containsPersonalField,
  excelSerialToIso,
  genericSummary,
  officialDataUrl,
  refreshOpenDataSnapshot,
} = require('../modules/open-data-refresh');
const { parseDatasetPassport } = require('../modules/open-data-catalog');
const openDataPages = require('../modules/open-data-pages');

const ROOT = path.join(__dirname, '..');

async function run() {
  const governmentSector = OPEN_DATA_DATASETS.filter(dataset => dataset.category === 'Государственный сектор');
  assert.strictEqual(governmentSector.length, 50, 'government-sector seed must contain all 50 discovered datasets');
  assert.strictEqual(new Set(governmentSector.map(dataset => dataset.index)).size, 50, 'dataset indexes must be unique');
  assert.strictEqual(new Set(governmentSector.map(dataset => dataset.path)).size, 50, 'public paths must be unique');

  assert.strictEqual(excelSerialToIso(46181), '2026-06-08');
  assert.strictEqual(officialDataUrl('https://data.egov.kz/api/v4/test/v1?apiKey=secret'), 'https://data.egov.kz/api/v4/test/v1');
  assert.strictEqual(officialDataUrl('https://example.com/api/v4/test/v1'), '');
  assert.strictEqual(containsPersonalField([{ fio: 'Пример А.А.' }]), true);

  const housing = OPEN_DATA_DATASETS.find(dataset => dataset.key === 'housing-received-akmola');
  const housingSummary = aggregateDataset(housing, [
    { id: '1', fio: 'Иванова А.А.', categor: 'Многодетная семья', mgp: 'Арендное жильё', give_date: 46181 },
    { id: '2', fio: 'Петров Б.Б.', categor: 'Многодетная семья', mgp: 'Арендное жильё', give_date: 46182 },
  ], { complete: true });
  assert.strictEqual(housingSummary.rowCount, 2);
  assert.strictEqual(housingSummary.categories[0].count, 2);
  assert(!JSON.stringify(housingSummary).includes('Иванова'), 'housing aggregates must not retain names');

  const generic = genericSummary([
    { fio: 'Иванова А.А.', amount: '12.5', region: 'Алматы' },
    { fio: 'Петров Б.Б.', amount: '18.5', region: 'Астана' },
  ]);
  assert(generic.sensitiveColumns.includes('fio'));
  assert(!JSON.stringify(generic.sampleRows).includes('Иванова'));
  assert.strictEqual(generic.columns.find(column => column.key === 'amount').type, 'number');

  const passport = parseDatasetPassport(`
    <table><tr><td>Название</td><td>Тестовый набор</td></tr><tr><td>Государственный орган</td><td>Тестовый орган</td></tr><tr><td>Дата обновления</td><td>25.08.2026 16:27</td></tr></table>
    <a href="https://data.egov.kz/api/v4/test-index/v7?apiKey=yourApiKey">API</a>
  `, 'fallback');
  assert.strictEqual(passport.index, 'test-index');
  assert.strictEqual(passport.version, 'v7');
  assert.strictEqual(passport.agency, 'Тестовый орган');

  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'ze-open-data-test-'));
  try {
    fs.mkdirSync(path.join(temporary, 'records'));
    fs.writeFileSync(path.join(temporary, 'catalog.json'), JSON.stringify([{
      index: 'new-public-dataset', version: 'v1', title: 'Новый публичный набор',
      description: 'Описание', agency: 'Государственный орган', category: 'Государственный сектор',
      recordsFile: 'records/new-public-dataset-v1.json', complete: true,
      datasetUrl: 'https://data.egov.kz/datasets/view?index=new-public-dataset',
      apiUrl: 'https://data.egov.kz/api/v4/new-public-dataset/v1',
      metaUrl: 'https://data.egov.kz/meta/new-public-dataset/v1',
    }]));
    fs.writeFileSync(path.join(temporary, 'records', 'new-public-dataset-v1.json'), JSON.stringify([
      { fio: 'Секретное Имя', region: 'Алматы', value: 1 },
    ]));
    const output = path.join(temporary, 'snapshot.json');
    const snapshot = await refreshOpenDataSnapshot({ inputDir: temporary, outputPath: output, minimumCatalogSize: 1 });
    const serialized = JSON.stringify(snapshot);
    assert(serialized.includes('new-public-dataset'));
    assert(!serialized.includes('Секретное Имя'), 'bundle import must not persist personal values');
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }

  const snapshot = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'open-data-snapshots.json'), 'utf8'));
  assert.strictEqual(Object.keys(snapshot.datasets).length, 51);
  assert.strictEqual(snapshot.privacy, 'aggregate-only-no-personal-records');
  assert(!/"(?:fio|iin)"\s*:/i.test(JSON.stringify(snapshot)));

  const sitemap = openDataPages.sitemapEntries();
  assert(sitemap.some(entry => entry.path === '/otkrytye-dannye/gosudarstvennyy-sektor'));
  assert(!sitemap.some(entry => entry.path.includes('reabilitaciya-detey')), 'empty dataset must stay out of sitemap');

  const audit = openDataPages.getDataset('audit-commissions-2026-q2');
  const body = await ejs.renderFile(path.join(ROOT, 'views', 'open-data', 'audit-body.ejs'), {
    dataset: audit,
    formatDate: openDataPages.formatDate,
    formatNumber: openDataPages.formatNumber,
  });
  assert(body.includes('Показатели за квартал'));
  assert(body.includes('data.egov.kz'));

  const serverSource = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  assert(serverSource.includes("app.get('/sitemap-open-data.xml'"));
  assert(serverSource.includes("app.get('/otkrytye-dannye/gosudarstvennyy-sektor'"));
  assert(serverSource.includes("OPEN_DATA_AUTO_REFRESH"));

  console.log('Open-data tests passed');
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
