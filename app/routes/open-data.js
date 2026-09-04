'use strict';

const axios = require('axios');
const openDataPages = require('../../modules/open-data-pages');
const { fetchHousingRecordsPageCached, isHousingDataset, searchHousingRecords } = require('../../modules/open-data-housing-search');
const { fetchOpenDataRecordsCached } = require('../../modules/open-data-records');

function registerOpenDataRoutes(app, dependencies) {
  const {
    EGOV_API_KEY,
    asyncHandler,
    sendNotFound,
    housingSearchLimiter,
    housingRecordsLimiter,
    logger,
  } = dependencies;

  function renderOpenDataPage(req, res, next, bodyView, bodyData, meta) {
    const shared = {
      formatDate: openDataPages.formatDate,
      formatNumber: openDataPages.formatNumber,
      recordCountLabel: openDataPages.recordCountLabel,
    };
    app.render(bodyView, { ...shared, ...bodyData }, (error, body) => {
      if (error) return next(error);
      res.render('news/layout', {
        title: meta.title,
        description: meta.description,
        canonical: openDataPages.canonical(req.path),
        schema: meta.schema,
        noindex: Boolean(meta.noindex),
        ogType: 'website',
        enableAutoAds: false,
        activeNav: 'open-data',
        extraStyles: ['/css/open-data.css?v=20260826-2'],
        extraScripts: ['/js/open-data-housing.js?v=20260826-2', ...(Array.isArray(meta.extraScripts) ? meta.extraScripts : [])],
        body,
      });
    });
  }

  app.post('/api/open-data/housing-search', housingSearchLimiter, asyncHandler(async (req, res) => {
    try {
      const result = await searchHousingRecords({
        fullName: req.body?.fullName,
        apiKey: EGOV_API_KEY,
        datasets: openDataPages.listDatasets(),
        http: axios,
      });
      res.set('Cache-Control', 'no-store');
      return res.json(result);
    } catch (error) {
      const status = /Введите|Подтвердите/.test(error.message) ? 400 : 503;
      logger.warn(`[Open data] Housing name lookup failed: ${error.code || error.message}`);
      return res.status(status).json({ error: status === 400 ? error.message : 'Официальный источник временно не ответил. Повторите позже.' });
    }
  }));

  app.post('/api/open-data/housing-records', housingRecordsLimiter, asyncHandler(async (req, res) => {
    const dataset = openDataPages.getDataset(String(req.body?.dataset || '').slice(0, 180));
    if (!dataset || !isHousingDataset(dataset)) return res.status(404).json({ error: 'Жилищный набор не найден' });
    try {
      const result = await fetchHousingRecordsPageCached({
        dataset,
        apiKey: EGOV_API_KEY,
        cursor: req.body?.cursor,
        fullName: req.body?.fullName,
        limit: 50,
        http: axios,
      });
      res.set('Cache-Control', 'private, no-store');
      return res.json(result);
    } catch (error) {
      const status = /Введите|не найден/.test(error.message) ? 400 : 503;
      logger.warn(`[Open data] Housing records request failed for ${dataset.key}: ${error.code || error.message}`);
      return res.status(status).json({ error: status === 400 ? error.message : 'Не удалось получить записи из официального источника. Повторите позже.' });
    }
  }));

  app.post('/api/open-data/records', housingRecordsLimiter, asyncHandler(async (req, res) => {
    const dataset = openDataPages.getDataset(String(req.body?.dataset || '').slice(0, 220));
    if (!dataset || !dataset.liveAvailable) return res.status(404).json({ error: 'Набор данных не найден' });
    try {
      const result = await fetchOpenDataRecordsCached({
        dataset,
        apiKey: EGOV_API_KEY,
        offset: req.body?.offset,
        limit: req.body?.limit,
        query: req.body?.query,
        http: axios,
      });
      res.set('Cache-Control', 'private, no-store');
      return res.json(result);
    } catch (error) {
      const status = /должен|не найден/.test(error.message) ? 400 : 503;
      logger.warn(`[Open data] Records request failed for ${dataset.index}: ${error.code || error.message}`);
      return res.status(status).json({
        error: status === 400 ? error.message : 'Официальный API временно не ответил. Повторите позже.',
      });
    }
  }));

  app.get('/otkrytye-dannye', (req, res, next) => {
    const snapshot = openDataPages.loadSnapshot();
    const inventory = openDataPages.loadInventory();
    const categories = openDataPages.categorySummaries();
    const agencies = openDataPages.agencySummaries();
    const housingReceived = openDataPages.housingGroup('housing_received');
    const housingWaitlist = openDataPages.housingGroup('housing_waitlist');
    const audit = openDataPages.getDataset('audit-commissions-2026-q2');
    const rehab = openDataPages.getDataset('children-rehabilitation-alatau-2026-h1');
    const governmentSector = openDataPages.listDatasets().filter(dataset => dataset.category === 'Государственный сектор');
    const title = 'Открытые данные Казахстана — жильё, аудит и социальные показатели | ZakonExpert';
    const description = 'Понятные срезы официальных данных Казахстана: жилищные списки по регионам, очередь на жильё и государственный аудит. Источники и даты обновления.';
    renderOpenDataPage(req, res, next, 'open-data/hub-body', {
      snapshot, inventory, categories, agencies, housingReceived, housingWaitlist, audit, rehab, governmentSector,
      datasets: [audit, rehab],
    }, {
      title,
      description,
      schema: openDataPages.pageSchema(title, description, req.path, [
        { name: 'Главная', path: '/' }, { name: 'Открытые данные', path: req.path },
      ]),
    });
  });

  app.get('/zhilishchnye-spiski', (req, res, next) => {
    const waitlist = openDataPages.housingGroup('housing_waitlist');
    const received = openDataPages.housingGroup('housing_received');
    const title = 'Жилищные списки Казахстана по регионам — очередь и получившие жильё';
    const description = 'Официальные жилищные списки Казахстана: поиск по ФИО, очередь на жильё, получившие коммунальное жильё, категории и регионы.';
    renderOpenDataPage(req, res, next, 'open-data/housing-hub-body', { waitlist, received }, {
      title,
      description,
      schema: openDataPages.pageSchema(title, description, req.path, [
        { name: 'Главная', path: '/' }, { name: 'Открытые данные', path: '/otkrytye-dannye' }, { name: 'Жилищные списки', path: req.path },
      ]),
    });
  });

  function renderHousingGroup(kind) {
    return (req, res, next) => {
      const group = openDataPages.housingGroup(kind);
      const waitlist = kind === 'housing_waitlist';
      const title = waitlist
        ? 'Очередь на жильё по регионам Казахстана — официальные списки 2026'
        : 'Списки получивших жильё по регионам Казахстана — данные 2026';
      const description = waitlist
        ? 'Списки очереди на жильё в Казахстане по ФИО, регионам, категориям и датам постановки на учёт.'
        : 'Региональные списки получивших коммунальное жильё по ФИО, категориям, программам и датам предоставления.';
      renderOpenDataPage(req, res, next, 'open-data/housing-group-body', { group }, {
        title,
        description,
        schema: openDataPages.pageSchema(title, description, req.path, [
          { name: 'Главная', path: '/' }, { name: 'Открытые данные', path: '/otkrytye-dannye' },
          { name: 'Жилищные списки', path: '/zhilishchnye-spiski' },
          { name: waitlist ? 'Очередь на жильё' : 'Получили жильё', path: req.path },
        ]),
      });
    };
  }

  app.get('/zhilishchnye-spiski/ochered-na-zhile', renderHousingGroup('housing_waitlist'));
  app.get('/zhilishchnye-spiski/poluchili-zhile', renderHousingGroup('housing_received'));

  function renderHousingDataset(kind) {
    return (req, res, next) => {
      const dataset = openDataPages.getHousingDataset(kind, req.params.regionSlug);
      if (!dataset) return sendNotFound(res);
      const isWaitlist = kind === 'housing_waitlist';
      const title = isWaitlist
        ? `Очередь на жильё в ${dataset.regionPrepositional} — список и статистика 2026`
        : `Список получивших жильё в ${dataset.regionPrepositional} — данные 2026`;
      const description = `${dataset.description} Поиск по ФИО, полный список записей, категории, даты, официальный источник и актуальность.`;
      const related = openDataPages.listDatasets(kind).filter(item => item.key !== dataset.key);
      renderOpenDataPage(req, res, next, 'open-data/housing-detail-body', { dataset, related }, {
        title,
        description,
        noindex: !(dataset.liveAvailable || dataset.hasData),
        schema: openDataPages.datasetSchema(dataset, [
          { name: 'Главная', path: '/' }, { name: 'Открытые данные', path: '/otkrytye-dannye' },
          { name: 'Жилищные списки', path: '/zhilishchnye-spiski' },
          { name: isWaitlist ? 'Очередь на жильё' : 'Получили жильё', path: isWaitlist ? '/zhilishchnye-spiski/ochered-na-zhile' : '/zhilishchnye-spiski/poluchili-zhile' },
          { name: dataset.regionName, path: dataset.path },
        ]),
      });
    };
  }

  app.get('/zhilishchnye-spiski/ochered-na-zhile/:regionSlug', renderHousingDataset('housing_waitlist'));
  app.get('/zhilishchnye-spiski/poluchili-zhile/:regionSlug', renderHousingDataset('housing_received'));

  app.get('/otkrytye-dannye/revizionnye-komissii-2-kvartal-2026', (req, res, next) => {
    const dataset = openDataPages.getDataset('audit-commissions-2026-q2');
    const title = 'Показатели ревизионных комиссий за 2 квартал 2026 года';
    const description = 'Аудиторские мероприятия ревизионных комиссий Казахстана за 2 квартал 2026 года: объём аудита, нарушения, восстановленные средства.';
    renderOpenDataPage(req, res, next, 'open-data/audit-body', { dataset }, {
      title,
      description,
      noindex: !dataset.hasData,
      schema: openDataPages.datasetSchema(dataset, [
        { name: 'Главная', path: '/' }, { name: 'Открытые данные', path: '/otkrytye-dannye' }, { name: 'Ревизионные комиссии', path: dataset.path },
      ]),
    });
  });

  app.get('/otkrytye-dannye/reabilitaciya-detey-alatau-2026', (req, res, next) => {
    const dataset = openDataPages.getDataset('children-rehabilitation-alatau-2026-h1');
    const title = 'Реабилитация детей в санатории «Алатау» — данные за 2026 год';
    renderOpenDataPage(req, res, next, 'open-data/generic-body', { dataset, housingDataset: false }, {
      title,
      description: `${dataset.description} Актуальные записи загружаются напрямую из официального API data.egov.kz.`,
      noindex: !(dataset.liveAvailable || dataset.hasData),
      extraScripts: ['/js/open-data-records.js?v=20260826-3'],
      schema: openDataPages.datasetSchema(dataset, [
        { name: 'Главная', path: '/' }, { name: 'Открытые данные', path: '/otkrytye-dannye' }, { name: dataset.shortTitle, path: dataset.path },
      ]),
    });
  });

  app.get('/otkrytye-dannye/gosudarstvennyy-sektor', (req, res, next) => {
    const datasets = openDataPages.listDatasets().filter(dataset => dataset.category === 'Государственный сектор');
    const totalRows = datasets.reduce((sum, dataset) => sum + dataset.rowCount, 0);
    const readyCount = datasets.filter(dataset => dataset.liveAvailable || dataset.hasData).length;
    const partial = datasets.some(dataset => dataset.rowLimitReached || dataset.completeness !== 'complete');
    const title = 'Открытые данные государственного сектора Казахстана — каталог наборов';
    const description = 'Все опубликованные наборы категории «Государственный сектор» на data.egov.kz: актуальные версии, число записей, структура и официальный источник.';
    renderOpenDataPage(req, res, next, 'open-data/government-sector-body', { datasets, totalRows, readyCount, partial }, {
      title,
      description,
      extraScripts: ['/js/open-data.js?v=20260826-1'],
      schema: openDataPages.pageSchema(title, description, req.path, [
        { name: 'Главная', path: '/' }, { name: 'Открытые данные', path: '/otkrytye-dannye' }, { name: 'Государственный сектор', path: req.path },
      ]),
    });
  });

  app.get('/otkrytye-dannye/kategorii', (req, res, next) => {
    const categories = openDataPages.categorySummaries();
    const totalDatasets = openDataPages.loadInventory().processedCount || openDataPages.listDatasets().length;
    const title = 'Категории открытых данных Казахстана | ZakonExpert';
    const description = `Все ${totalDatasets} опубликованных набора data.egov.kz по ${categories.length} категориям: поиск, записи, источники и даты обновления.`;
    renderOpenDataPage(req, res, next, 'open-data/categories-body', { categories, totalDatasets }, {
      title, description,
      schema: openDataPages.pageSchema(title, description, req.path, [
        { name: 'Главная', path: '/' }, { name: 'Открытые данные', path: '/otkrytye-dannye' }, { name: 'Категории', path: req.path },
      ]),
    });
  });

  app.get('/otkrytye-dannye/organizacii', (req, res, next) => {
    const agencies = openDataPages.agencySummaries();
    const totalDatasets = openDataPages.loadInventory().processedCount || openDataPages.listDatasets().length;
    const title = 'Госорганы, акиматы и квазисектор — открытые данные';
    const description = `Официальные наборы ${agencies.length} министерств, агентств, акиматов и квазигосударственных организаций.`;
    renderOpenDataPage(req, res, next, 'open-data/agencies-body', { agencies, totalDatasets }, {
      title, description, extraScripts: ['/js/open-data.js?v=20260826-2'],
      schema: openDataPages.pageSchema(title, description, req.path, [
        { name: 'Главная', path: '/' }, { name: 'Открытые данные', path: '/otkrytye-dannye' }, { name: 'Организации', path: req.path },
      ]),
    });
  });

  app.get('/otkrytye-dannye/istochniki', (req, res, next) => {
    const { reviewedAt, sources } = openDataPages.officialDataSources();
    const title = 'Официальные источники данных Казахстана | ZakonExpert';
    const description = 'Открытые данные, государственные реестры и официальные API, подключённые к справочникам ZakonExpert.';
    renderOpenDataPage(req, res, next, 'open-data/sources-body', { reviewedAt, sources }, {
      title, description,
      schema: openDataPages.pageSchema(title, description, req.path, [
        { name: 'Главная', path: '/' }, { name: 'Открытые данные', path: '/otkrytye-dannye' }, { name: 'Источники', path: req.path },
      ]),
    });
  });

  function renderOpenDataGroup(groupType) {
    return (req, res, next) => {
      const group = groupType === 'category' ? openDataPages.findCategory(req.params.slug) : openDataPages.findAgency(req.params.slug);
      if (!group) return sendNotFound(res);
      const result = openDataPages.paginatedDatasets({
        [groupType === 'category' ? 'categoryId' : 'agencyId']: group.id,
        query: req.query.q,
        page: req.query.page,
        pageSize: 48,
      });
      const title = `${group.name} — ${result.total} наборов открытых данных`;
      const description = `Поиск и просмотр всех официальных записей: ${group.name}. Источник data.egov.kz.`;
      renderOpenDataPage(req, res, next, 'open-data/catalog-group-body', { groupType, group, result }, {
        title, description,
        noindex: Boolean(result.query || result.page > 1),
        schema: openDataPages.pageSchema(title, description, req.path, [
          { name: 'Главная', path: '/' }, { name: 'Открытые данные', path: '/otkrytye-dannye' },
          { name: groupType === 'category' ? 'Категории' : 'Организации', path: groupType === 'category' ? '/otkrytye-dannye/kategorii' : '/otkrytye-dannye/organizacii' },
          { name: group.name, path: req.path },
        ]),
      });
    };
  }

  app.get('/otkrytye-dannye/kategoriya/:slug', renderOpenDataGroup('category'));
  app.get('/otkrytye-dannye/organizaciya/:slug', renderOpenDataGroup('agency'));

  function renderGenericOpenDataDataset(req, res, next, dataset) {
    if (!dataset || !['government_sector', 'catalog_dataset'].includes(dataset.kind)) return sendNotFound(res);
    const title = `${dataset.title} — официальный набор данных | ZakonExpert`;
    const description = `${dataset.description} Полные записи, поиск, дата обновления и ссылка на источник.`;
    const housingDataset = isHousingDataset(dataset);
    renderOpenDataPage(req, res, next, 'open-data/generic-body', { dataset, housingDataset }, {
      title,
      description,
      noindex: !(dataset.liveAvailable || dataset.hasData),
      extraScripts: housingDataset ? [] : ['/js/open-data-records.js?v=20260826-3'],
      schema: openDataPages.datasetSchema(dataset, [
        { name: 'Главная', path: '/' }, { name: 'Открытые данные', path: '/otkrytye-dannye' },
        { name: dataset.category, path: dataset.category === 'Государственный сектор' ? '/otkrytye-dannye/gosudarstvennyy-sektor' : '/otkrytye-dannye/kategorii' },
        { name: dataset.title, path: dataset.path },
      ]),
    });
  }

  app.get('/otkrytye-dannye/gosudarstvennyy-sektor/:slug', (req, res, next) => {
    const requestPath = `/otkrytye-dannye/gosudarstvennyy-sektor/${req.params.slug}`;
    const dataset = openDataPages.getDatasetByPath(requestPath);
    return renderGenericOpenDataDataset(req, res, next, dataset);
  });

  app.get('/otkrytye-dannye/nabor/:slug', (req, res, next) => {
    const dataset = openDataPages.getDatasetByPath(`/otkrytye-dannye/nabor/${req.params.slug}`);
    return renderGenericOpenDataDataset(req, res, next, dataset);
  });

}

module.exports = { registerOpenDataRoutes };
