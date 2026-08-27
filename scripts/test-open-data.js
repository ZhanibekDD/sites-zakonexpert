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
const { fetchOpenDataRecords, fetchOpenDataRecordsCached, latestMappingVersion } = require('../modules/open-data-records');
const {
  appendMaterializedChunk,
  initializeMaterializedDataset,
  readMaterializedRecords,
} = require('../modules/open-data-record-cache');
const { getOpenDataCacheJobStatus, warmDataset, warmOpenDataRecordCache } = require('../modules/open-data-cache-warmer');
const {
  fetchHousingRecordsPage,
  normalizeFullName,
  searchHousingRecords,
  validateFullName,
} = require('../modules/open-data-housing-search');
const openDataPages = require('../modules/open-data-pages');
const { loadInventory } = require('../modules/open-data-inventory');
const { syncOpenDataInventory } = require('./sync-open-data-inventory');

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
  assert.strictEqual(normalizeFullName('  Касымова, Алия Ерлановна '), 'КАСЫМОВА АЛИЯ ЕРЛАНОВНА');
  assert.strictEqual(validateFullName('Касымова Алия Ерлановна'), 'КАСЫМОВА АЛИЯ ЕРЛАНОВНА');
  assert.strictEqual(validateFullName('Алия'), null);
  assert.strictEqual(latestMappingVersion({ sample: { mappings: { v2: {}, v11: {}, v3: {} } } }, 'sample'), 'v11');

  const housingApiDataset = {
    key: 'housing-api-test', index: 'housing-api-test', kind: 'housing_waitlist', title: 'Список граждан, нуждающихся в жилище',
    datasetUrl: 'https://data.egov.kz/datasets/view?index=housing-api-test',
    apiUrl: 'https://data.egov.kz/api/v4/housing-api-test/v1', updatedAt: '2026-08-25',
  };
  const apiCalls = [];
  const housingHttp = {
    async get(url, options) {
      apiCalls.push({ url, options });
      return { data: [
        { id: 1, fio: 'Касымова Алия Ерлановна', region: 'Астана', subcategory: 'Многодетная семья', note: '№ 42', apiKey: 'must-not-render' },
        { id: 2, fio: 'Другой Человек', region: 'Алматы', subcategory: 'Общая очередь' },
      ] };
    },
  };
  const recordsPage = await fetchHousingRecordsPage({
    dataset: housingApiDataset, apiKey: 'test-key', limit: 50, http: housingHttp,
  });
  assert.strictEqual(recordsPage.rows[0].fio, 'Касымова Алия Ерлановна');
  assert.strictEqual(recordsPage.rows[0].note, '№ 42', 'all official record fields must be returned');
  assert(!Object.prototype.hasOwnProperty.call(recordsPage.rows[0], 'apiKey'), 'technical credentials must never be rendered');
  assert(recordsPage.columns.some(column => column.label === 'ФИО'));
  const housingLookup = await searchHousingRecords({
    fullName: 'Касымова Алия Ерлановна', apiKey: 'test-key', datasets: [housingApiDataset], http: housingHttp,
  });
  assert.strictEqual(housingLookup.results.length, 1);
  assert(housingLookup.results[0].details.some(field => field.label === 'Примечание' && field.value === '№ 42'));
  assert(apiCalls.some(call => JSON.parse(call.options.params.source).query), 'exact FIO search must be sent to the official API');

  const genericRecords = await fetchOpenDataRecords({
    dataset: {
      key: 'generic-api-test', index: 'generic-api-test', title: 'Публичный реестр',
      datasetUrl: 'https://data.egov.kz/datasets/view?index=generic-api-test',
      apiUrl: 'https://data.egov.kz/api/v4/generic-api-test/v1',
    },
    apiKey: 'test-key', query: 'Касымова', limit: 50, http: housingHttp,
  });
  assert.strictEqual(genericRecords.rows[0].fio, 'Касымова Алия Ерлановна');
  assert(!Object.prototype.hasOwnProperty.call(genericRecords.rows[0], 'apiKey'));
  assert.strictEqual(genericRecords.columns.find(column => column.key === 'fio').label, 'ФИО');

  const dynamicCalls = [];
  const dynamicHttp = {
    async get(url) {
      dynamicCalls.push(url);
      if (url.includes('/mapping/')) return { data: { 'dynamic-test': { mappings: { v1: {}, v4: {} } } } };
      return { data: [{ id: 7, name: 'Актуальная запись' }] };
    },
  };
  const dynamicRecords = await fetchOpenDataRecords({
    dataset: {
      key: 'catalog-dynamic-test', index: 'dynamic-test', title: 'Динамический набор',
      datasetUrl: 'https://data.egov.kz/datasets/view?index=dynamic-test',
    },
    apiKey: 'test-key', http: dynamicHttp,
  });
  assert.strictEqual(dynamicRecords.dataset.version, 'v4');
  assert(dynamicCalls.some(url => url.endsWith('/api/v4/dynamic-test/v4')), 'latest mapping version must be used for records');

  const cacheDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'ze-open-data-cache-test-'));
  try {
    const cachedDataset = {
      key: 'cached-test', index: 'cached-test', version: 'v1', title: 'Локальный набор', updatedAt: '2026-08-26',
      datasetUrl: 'https://data.egov.kz/datasets/view?index=cached-test',
    };
    let manifest = await initializeMaterializedDataset({ dataset: cachedDataset, cacheDir: cacheDirectory, pagination: 'offset', pageSize: 500 });
    ({ manifest } = await appendMaterializedChunk({
      dataset: cachedDataset,
      cacheDir: cacheDirectory,
      manifest,
      rows: [{ id: 1, fio: 'Касымова Алия Ерлановна', city: 'Астана' }, { id: 2, fio: 'Другой Человек', city: 'Алматы' }],
      complete: true,
    }));
    assert.strictEqual(manifest.rowCount, 2);
    const localSearch = await readMaterializedRecords({ dataset: cachedDataset, cacheDir: cacheDirectory, query: 'Касымова Алия', limit: 50 });
    assert.strictEqual(localSearch.rows.length, 1, 'complete cache must support local search without API');
    const localPage = await fetchOpenDataRecordsCached({ dataset: cachedDataset, cacheDir: cacheDirectory, offset: 0, limit: 50 });
    assert.strictEqual(localPage.delivery, 'materialized-cache');
    assert.strictEqual(localPage.rows.length, 2);
    assert.strictEqual(localPage.columns.find(column => column.key === 'fio').label, 'ФИО');

    const warmDatasetDefinition = {
      key: 'warmer-test', index: 'warmer-test', version: 'v1', title: 'Прогреваемый набор', updatedAt: '2026-08-26',
      datasetUrl: 'https://data.egov.kz/datasets/view?index=warmer-test',
      apiUrl: 'https://data.egov.kz/api/v4/warmer-test/v1',
    };
    const warmed = await warmDataset({
      dataset: warmDatasetDefinition,
      apiKey: 'test-key',
      cacheDir: cacheDirectory,
      pageSize: 100,
      http: { async get() { return { data: [{ id: 1, name: 'Первая' }, { id: 2, name: 'Вторая' }] }; } },
    });
    assert.strictEqual(warmed.manifest.complete, true);
    const warmedPage = await readMaterializedRecords({ dataset: warmDatasetDefinition, cacheDir: cacheDirectory, limit: 50 });
    assert.strictEqual(warmedPage.rows.length, 2, 'warmer must persist complete API rows');

    const fallbackSizes = [];
    const fallbackDataset = {
      key: 'fallback-test', index: 'fallback-test', version: 'v1', title: 'Набор с ограничением размера', updatedAt: '2026-08-26',
      datasetUrl: 'https://data.egov.kz/datasets/view?index=fallback-test',
      apiUrl: 'https://data.egov.kz/api/v4/fallback-test/v1',
    };
    const fallback = await warmDataset({
      dataset: fallbackDataset,
      apiKey: 'test-key',
      cacheDir: cacheDirectory,
      pageSize: 500,
      http: { async get(_url, request) {
        const size = JSON.parse(request.params.source).size;
        fallbackSizes.push(size);
        if (size > 50) throw new Error('batch too large');
        return { data: [{ id: 1, name: 'Сохранено после уменьшения пакета' }] };
      } },
    });
    assert.strictEqual(fallback.manifest.complete, true);
    assert.strictEqual(fallback.manifest.pageSize, 50, 'warmer must reduce an unsupported API batch to 50 rows');
    assert.deepStrictEqual(fallbackSizes, [500, 500, 100, 50]);

    const observableDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'ze-open-data-status-test-'));
    try {
      await warmOpenDataRecordCache({
        datasets: [warmDatasetDefinition],
        apiKey: 'test-key',
        cacheDir: observableDirectory,
        pageSize: 100,
        delayMs: 0,
        http: { async get() { return { data: [{ id: 1, name: 'Статус виден' }] }; } },
      });
      const cacheStatus = getOpenDataCacheJobStatus(observableDirectory);
      assert.strictEqual(cacheStatus.status, 'complete');
      assert.strictEqual(cacheStatus.completed, 1);
      assert.strictEqual(cacheStatus.cachedRows, 1);
    } finally {
      fs.rmSync(observableDirectory, { recursive: true, force: true });
    }
  } finally {
    fs.rmSync(cacheDirectory, { recursive: true, force: true });
  }

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

    const compactOutput = path.join(temporary, 'inventory.json.br');
    const compact = await syncOpenDataInventory({
      outputPath: compactOutput,
      enrichHousing: false,
      http: {
        async get(url) {
          if (url.includes('getdatasetsrecount')) return { data: { totalCount: 2 } };
          return { data: { datasets: [
            { apiUri: 'compact-a', nameRu: 'Первый набор', status: 'PUBLISHED', categories: [{ id: 'cat', nameRu: 'Экономика' }], govAgency: { id: 'org', nameRu: 'Орган' } },
            { apiUri: 'compact-b', nameRu: 'Второй набор', status: 'PUBLISHED', categories: [{ id: 'cat', nameRu: 'Экономика' }], govAgency: { id: 'org', nameRu: 'Орган' } },
          ] } };
        },
      },
    });
    assert.strictEqual(compact.processedCount, 2);
    assert.strictEqual(loadInventory(compactOutput).datasets.length, 2, 'Brotli inventory must round-trip');
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }

  const snapshot = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'open-data-snapshots.json'), 'utf8'));
  assert.strictEqual(Object.keys(snapshot.datasets).length, 51);
  assert.strictEqual(snapshot.privacy, 'aggregate-only-no-personal-records');
  assert(!/"(?:fio|iin)"\s*:/i.test(JSON.stringify(snapshot)));

  const sitemap = openDataPages.sitemapEntries();
  const inventory = openDataPages.loadInventory();
  assert.strictEqual(inventory.processedCount, inventory.expectedCount, 'complete catalog must match the official count');
  assert(inventory.processedCount >= 3900, 'complete catalog must include every published portal dataset');
  assert.strictEqual(openDataPages.listDatasets().length, inventory.processedCount);
  assert.strictEqual(new Set(openDataPages.listDatasets().map(dataset => dataset.path)).size, inventory.processedCount, 'every dataset path must be unique');
  assert.strictEqual(openDataPages.categorySummaries().length, 18);
  assert(openDataPages.agencySummaries().length >= 490);
  assert.strictEqual(openDataPages.listDatasets('housing_waitlist').length, 20);
  assert.strictEqual(openDataPages.listDatasets('housing_received').length, 20);
  assert(openDataPages.officialDataSources().sources.some(source => source.id === 'data-egov' && source.status === 'connected'));
  assert(sitemap.some(entry => entry.path === '/otkrytye-dannye/gosudarstvennyy-sektor'));
  assert(sitemap.length >= inventory.processedCount, 'every live dataset must have an indexable page');
  assert(sitemap.some(entry => entry.path === '/zhilishchnye-spiski/poluchili-zhile/almaty'));
  assert(sitemap.some(entry => entry.path === '/zhilishchnye-spiski/ochered-na-zhile/astana'));

  const rehabilitation = openDataPages.getDataset('children-rehabilitation-alatau-2026-h1');
  assert.strictEqual(rehabilitation.liveAvailable, true, 'curated datasets must inherit live API availability from the complete inventory');
  assert.strictEqual(rehabilitation.path, '/otkrytye-dannye/reabilitaciya-detey-alatau-2026');
  const hubView = fs.readFileSync(path.join(ROOT, 'views', 'open-data', 'hub-body.ejs'), 'utf8');
  assert(hubView.includes("dataset.liveAvailable ? 'API подключён'"), 'live datasets without cached rows must not be marked as permanently waiting');
  const genericView = fs.readFileSync(path.join(ROOT, 'views', 'open-data', 'generic-body.ejs'), 'utf8');
  assert(genericView.indexOf("include('records'") < genericView.indexOf('od-detail-grid'), 'record table must be placed before passport and field summaries');

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
  assert(serverSource.includes("app.post('/api/open-data/housing-records'"));
  assert(serverSource.includes("app.post('/api/open-data/housing-search'"));
  assert(serverSource.includes("app.post('/api/open-data/records'"));
  assert(serverSource.includes("app.get('/otkrytye-dannye/kategorii'"));
  assert(serverSource.includes("app.get('/otkrytye-dannye/organizacii'"));
  assert(serverSource.includes("app.get('/otkrytye-dannye/istochniki'"));
  assert(serverSource.includes("'/js/open-data-records.js?v=20260826-3'"), 'live datasets must load the cache-first records browser');
  assert(serverSource.includes('warmOpenDataRecordCache'), 'server must materialise official records in the background');
  assert(serverSource.includes("app.get('/download-document/:filename'"));
  assert(serverSource.includes("OPEN_DATA_AUTO_REFRESH"));

  const housingView = fs.readFileSync(path.join(ROOT, 'views', 'open-data', 'housing-search.ejs'), 'utf8');
  assert(!/Кияшев|Жанибек/i.test(housingView), 'public search placeholder must not contain the owner name');
  const documentsPage = fs.readFileSync(path.join(ROOT, 'public', 'dokumenty.html'), 'utf8');
  assert(documentsPage.includes('/download-document/zayavlenie-v-bank-o-grafike.pdf'));
  assert(documentsPage.includes('/js/document-downloads.js'));

  console.log('Open-data tests passed');
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
