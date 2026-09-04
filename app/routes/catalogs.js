'use strict';

const path = require('path');
const { lowContentBoost } = require('../../modules/seo-blocks');
const { resolveLegacyCatalogItem } = require('../../modules/seo-url-policy');
const { getBankArrestPathForBank } = require('../../modules/bank-arrest-pages');
const { ROOT_DIR } = require('../paths');

function registerCatalogRoutes(app, dependencies) {
  const {
    companiesDb,
    clicksDb,
    sendNotFound,
    parseSemicolonCSV,
    getBanksData,
    getCourtsData,
    getChambersData,
    getGsiData,
    getInsuranceData,
    getCollectors,
    getMfoData,
  } = dependencies;

  // ===== NEW CATALOGS: BANKS / MFO / COURTS / CHAMBERS =====
  app.get('/banks',     (req, res) => res.render('banks/catalog', { banks: getBanksData(), lowContentBoost }));

  const CATALOG_PAGE_SIZE = 60;
  function paginateCatalog(items, req, searchText) {
    const query = String(req.query.q || '').trim().slice(0, 100);
    const needle = query.toLocaleLowerCase('ru-RU');
    const filtered = needle
      ? items.filter(item => String(searchText(item) || '').toLocaleLowerCase('ru-RU').includes(needle))
      : items;
    const totalPages = Math.max(1, Math.ceil(filtered.length / CATALOG_PAGE_SIZE));
    const requestedPage = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const page = Math.min(requestedPage, totalPages);
    const offset = (page - 1) * CATALOG_PAGE_SIZE;
    return {
      items: filtered.slice(offset, offset + CATALOG_PAGE_SIZE),
      query,
      page,
      pageSize: CATALOG_PAGE_SIZE,
      total: items.length,
      filteredTotal: filtered.length,
      totalPages,
    };
  }

  app.get('/courts', (req, res) => {
    const catalog = paginateCatalog(getCourtsData(), req, court => [
      court.name, court.region, court.level, court.address, court.chairman, court.email,
    ].join(' '));
    res.render('courts/catalog', { courts: catalog.items, catalog });
  });
  app.get('/chambers',  (req, res) => res.render('chambers/catalog', { chambers: getChambersData() }));

  app.get('/gsi',           (req, res) => res.render('gsi/catalog', { items: getGsiData() }));
  app.get('/gsi/:slug',     (req, res) => {
    const item = getGsiData().find(g => g.slug === req.params.slug);
    if (!item) return sendNotFound(res);
    res.render('gsi/item', { item, lowContentBoost });
  });
  app.get('/insurance',     (req, res) => res.render('insurance/catalog', { items: getInsuranceData() }));
  app.get('/insurance/:slug', (req, res) => {
    const items = getInsuranceData();
    const item = items.find(c => c.slug === req.params.slug);
    if (!item) {
      const alias = resolveLegacyCatalogItem(items, req.params.slug);
      if (alias) return res.redirect(301, `/insurance/${alias.slug}`);
    }
    if (!item) return sendNotFound(res);
    res.render('insurance/item', { item, lowContentBoost });
  });
  app.get('/credit-bureaus',(req, res) => res.render('credit-bureaus/catalog', { items: parseSemicolonCSV(path.join(ROOT_DIR, 'Кредитные_бюро_Казахстана.csv')) }));
  app.get('/regulators',    (req, res) => res.render('regulators/catalog', { items: parseSemicolonCSV(path.join(ROOT_DIR, 'Финансовые_регуляторы_Казахстана.csv')) }));
  app.get('/emergency',     (req, res) => res.render('emergency/catalog', { items: parseSemicolonCSV(path.join(ROOT_DIR, 'Экстренные_и_справочные_номера_Казахстана.csv')) }));

  // ITEM PAGES: BANKS
  app.get('/banks/:slug', (req, res) => {
    const bank = getBanksData().find(b => b.slug === req.params.slug);
    if (!bank) return sendNotFound(res);
    res.render('banks/item', {
      bank,
      lowContentBoost,
      bankArrestPath: getBankArrestPathForBank(bank),
    });
  });

  // ITEM PAGES: COURTS
  app.get('/courts/:slug', (req, res) => {
    const court = getCourtsData().find(c => c.slug === req.params.slug);
    if (!court) return sendNotFound(res);
    res.render('courts/item', { court });
  });

  // ITEM PAGES: CHAMBERS
  app.get('/chambers/:slug', (req, res) => {
    const chamber = getChambersData().find(c => c.slug === req.params.slug);
    if (!chamber) return sendNotFound(res);
    res.render('chambers/item', { chamber });
  });

  app.get('/collectors', (req, res) => {
    const catalog = paginateCatalog(getCollectors(), req, item => [
      item.name, item.nameFull, item.bin, item.regNum, item.leader, item.address,
      ...(item.phones || []), ...(item.emails || []), ...(item.sites || []),
    ].join(' '));
    res.render('collectors/catalog', { items: catalog.items, catalog, lowContentBoost });
  });

  app.get('/collectors/:slug', (req, res) => {
    const item = getCollectors().find(c => c.slug === req.params.slug);
    if (!item) return sendNotFound(res);
    res.render('collectors/item', { item, lowContentBoost });
  });

  app.get('/mfo', (req, res) => {
    const { mfo } = getMfoData();
    const catalog = paginateCatalog(mfo, req, item => [
      item.name, item.nameFull, item.bin, item.address, item.leader,
    ].join(' '));
    res.render('mfo/catalog', { mfo: catalog.items, catalog, lowContentBoost });
  });

  app.get('/mfo/:slug', (req, res) => {
    const { mfo } = getMfoData();
    const item = mfo.find(m => m.slug === req.params.slug);
    if (!item) {
      const alias = resolveLegacyCatalogItem(mfo, req.params.slug);
      if (alias) return res.redirect(301, `/mfo/${alias.slug}`);
    }
    if (!item) return sendNotFound(res);
    res.render('mfo/item', { item, lowContentBoost });
  });

  app.get('/lombards', (req, res) => {
    const { lombards } = getMfoData();
    const catalog = paginateCatalog(lombards, req, item => [
      item.name, item.nameFull, item.bin, item.address, item.leader,
    ].join(' '));
    res.render('lombards/catalog', { items: catalog.items, catalog, lowContentBoost });
  });

  app.get('/lombards/:slug', (req, res) => {
    const { lombards } = getMfoData();
    const item = lombards.find(l => l.slug === req.params.slug);
    if (!item) {
      const alias = resolveLegacyCatalogItem(lombards, req.params.slug);
      if (alias) return res.redirect(301, `/lombards/${alias.slug}`);
    }
    if (!item) return sendNotFound(res);
    res.render('lombards/item', { item, lowContentBoost });
  });

  // ===== BIN SEARCH =====
  app.get('/bin-search', (req, res) => {
    const bin = (req.query.bin || '').replace(/\D/g, '').slice(0, 12);
    if (bin.length < 9) return res.render('bin-search/index', { bin, results: [], searched: false });
    const results = [];
    try { getBanksData().filter(b => b.bin === bin).forEach(b => results.push({ type: 'Банк', name: b.shortName || b.name, url: '/banks/' + b.slug })); } catch(e){}
    try { const { mfo, lombards } = getMfoData(); mfo.filter(m => m.bin === bin).forEach(m => results.push({ type: 'МФО', name: m.name, url: '/mfo/' + m.slug })); lombards.filter(m => m.bin === bin).forEach(m => results.push({ type: 'Ломбард', name: m.name, url: '/lombards/' + m.slug })); } catch(e){}
    try { getCollectors().filter(c => c.bin === bin).forEach(c => results.push({ type: 'Коллектор', name: c.name, url: '/collectors/' + c.slug })); } catch(e){}
    try { getInsuranceData().filter(c => c.bin === bin).forEach(c => results.push({ type: 'Страховая', name: c.shortName || c.name, url: '/insurance/' + c.slug })); } catch(e){}
    try { getGsiData().filter(g => g.bin && g.bin === bin).forEach(g => results.push({ type: 'ГСИ', name: g.name, url: '/gsi/' + g.slug })); } catch(e){}
    try {
      if (companiesDb && companiesDb.available()) {
        companiesDb.search(bin, 1, 5).items.forEach(company => results.push({
          type: 'Компания',
          name: company.name_ru || company.name_kk,
          url: '/company/' + company.slug,
        }));
      }
    } catch(e){}
    if (clicksDb) clicksDb.recordClick({ type: 'bin_search_completed', target: bin, page: '/bin-search', ip: req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown', ua: req.headers['user-agent'] || '' }).catch(() => {});
    res.render('bin-search/index', { bin, results, searched: true });
  });

}

module.exports = { registerCatalogRoutes };
