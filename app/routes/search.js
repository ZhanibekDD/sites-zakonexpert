'use strict';

const { TOOLS } = require('../../modules/tools-catalog');
const openDataPages = require('../../modules/open-data-pages');
const { BANK_ARREST_PAGES } = require('../../modules/bank-arrest-pages');
const { LEGAL_INTENT_PAGES } = require('../../modules/legal-intent-pages');
const { normalizeSearchQuery, searchItems, searchStaticPages } = require('../../modules/site-search');

function registerSearchRoutes(app, dependencies) {
  const {
    newsDb,
    notariesDb,
    bailiffsDb,
    companiesDb,
    lawsDb,
    asyncHandler,
    getBanksData,
    getCourtsData,
    getChambersData,
    getGsiData,
    getInsuranceData,
    getCollectors,
    getMfoData,
    logger,
  } = dependencies;

  function searchSummary(values, maxLength = 220) {
    const summary = values
      .flatMap(value => Array.isArray(value) ? value : [value])
      .filter(Boolean)
      .map(value => String(value).replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .join(' · ');
    if (summary.length <= maxLength) return summary;
    return `${summary.slice(0, maxLength - 1).trimEnd()}…`;
  }

  async function safeGlobalSearch(source, fallback = []) {
    try {
      return await source();
    } catch (error) {
      logger.warn(`Global search source unavailable: ${error.message}`);
      return fallback;
    }
  }

  async function buildGlobalSearchResults(query) {
    const cleanQuery = normalizeSearchQuery(query);
    if (cleanQuery.length < 2) return [];

    const companyResults = await safeGlobalSearch(() => {
      if (!companiesDb || !companiesDb.available()) return [];
      return companiesDb.search(cleanQuery, 1, 12).items.map(company => ({
        title: company.name_ru || company.name_kk,
        description: searchSummary([
          company.bin ? `БИН ${company.bin}` : '',
          company.activity_ru,
          company.leader,
          company.address_ru,
        ]),
        url: `/company/${company.slug}`,
      }));
    });

    const [notaries, bailiffs, laws, news] = await Promise.all([
      safeGlobalSearch(() => notariesDb ? notariesDb.search(cleanQuery, 10) : []),
      safeGlobalSearch(() => bailiffsDb ? bailiffsDb.search(cleanQuery, 10) : []),
      safeGlobalSearch(() => lawsDb ? lawsDb.search(cleanQuery, '', 12) : []),
      safeGlobalSearch(() => newsDb?.searchPublished ? newsDb.searchPublished(cleanQuery, 10) : []),
    ]);

    const { mfo, lombards } = getMfoData();
    const registryItems = [
      ...searchItems(getBanksData(), cleanQuery, {
        title: item => item.shortName || item.name,
        description: item => searchSummary([item.name, item.bin ? `БИН ${item.bin}` : '', item.city, item.address]),
        url: item => `/banks/${item.slug}`,
        keywords: item => [item.bin, item.chairman, item.email, item.phone, item.phoneShort, item.web],
        limit: 8,
      }),
      ...searchItems(mfo, cleanQuery, {
        title: item => item.name,
        description: item => searchSummary([item.nameFull, item.bin ? `БИН ${item.bin}` : '', item.address]),
        url: item => `/mfo/${item.slug}`,
        keywords: item => [item.bin, item.leader],
        limit: 8,
      }),
      ...searchItems(lombards, cleanQuery, {
        title: item => item.name,
        description: item => searchSummary([item.nameFull, item.bin ? `БИН ${item.bin}` : '', item.address]),
        url: item => `/lombards/${item.slug}`,
        keywords: item => [item.bin, item.leader],
        limit: 8,
      }),
      ...searchItems(getCollectors(), cleanQuery, {
        title: item => item.name,
        description: item => searchSummary([item.nameFull, item.bin ? `БИН ${item.bin}` : '', item.address]),
        url: item => `/collectors/${item.slug}`,
        keywords: item => [item.bin, item.regNum, item.leader, item.phones, item.emails, item.sites],
        limit: 8,
      }),
      ...searchItems(getCourtsData(), cleanQuery, {
        title: item => item.name,
        description: item => searchSummary([item.level, item.region, item.address]),
        url: item => `/courts/${item.slug}`,
        keywords: item => [item.chairman, item.email, item.phone],
        limit: 8,
      }),
      ...searchItems(getChambersData(), cleanQuery, {
        title: item => item.region,
        description: item => searchSummary([item.notary_name, item.chsi_name]),
        url: item => `/chambers/${item.slug}`,
        keywords: item => [item.notary_leader, item.chsi_leader, item.notary_phone, item.chsi_phone],
        limit: 8,
      }),
      ...searchItems(getGsiData(), cleanQuery, {
        title: item => item.name || item.region,
        description: item => searchSummary([item.region, item.address]),
        url: item => `/gsi/${item.slug}`,
        keywords: item => [item.leader, item.email, item.phone],
        limit: 8,
      }),
      ...searchItems(getInsuranceData(), cleanQuery, {
        title: item => item.shortName || item.name,
        description: item => searchSummary([item.name, item.bin ? `БИН ${item.bin}` : '', item.address]),
        url: item => `/insurance/${item.slug}`,
        keywords: item => [item.bin, item.leader, item.email, item.phone, item.web],
        limit: 8,
      }),
    ].slice(0, 18);

    const specialistResults = [
      ...notaries.map(item => ({
        title: item.name,
        description: searchSummary(['Нотариус', item.region, item.address, item.license ? `Лицензия ${item.license}` : '']),
        url: `/notary/${item.slug}`,
      })),
      ...bailiffs.map(item => ({
        title: item.name,
        description: searchSummary(['Частный судебный исполнитель', item.region, item.address, item.license ? `Лицензия ${item.license}` : '']),
        url: `/bailiff/${item.slug}`,
      })),
    ].slice(0, 18);

    const lawResults = laws.map(article => ({
      title: `Статья ${article.num || ''}${article.codeName ? ` ${article.codeName}` : ''}: ${article.title || ''}`.replace(/\s+/g, ' ').trim(),
      description: searchSummary([article.codeName, article.shortName]),
      url: `/statya/${article.slug}`,
    }));
    const newsResults = news.map(article => ({
      title: article.title,
      description: searchSummary([article.category, article.excerpt]),
      url: `/news/${article.slug}`,
    }));

    const sectionResults = [
      ...searchStaticPages(cleanQuery, 12),
      ...searchItems(TOOLS, cleanQuery, {
        title: item => item.title,
        description: item => item.description,
        url: item => item.href,
        keywords: item => [item.short, item.actionLabel],
        limit: 8,
      }),
      ...searchItems(LEGAL_INTENT_PAGES, cleanQuery, {
        title: item => item.h1,
        description: item => searchSummary([item.description, item.shortAnswer]),
        url: item => item.path,
        keywords: item => [item.kicker, item.documents],
        limit: 8,
      }),
      ...searchItems(BANK_ARREST_PAGES, cleanQuery, {
        title: item => `Арест счёта в ${item.brand}`,
        description: item => searchSummary([item.context]),
        url: item => item.path,
        keywords: item => [item.brand, item.bin, item.aliases],
        limit: 8,
      }),
    ].filter((result, index, items) => items.findIndex(item => item.url === result.url) === index)
      .slice(0, 18);

    const openDataResults = searchItems(openDataPages.listDatasets(), cleanQuery, {
      title: item => item.title,
      description: item => searchSummary([item.category, item.agency, item.description]),
      url: item => item.path,
      keywords: item => [item.titleKk, item.titleEn, item.keywords],
      limit: 12,
    });

    return [
      { key: 'companies', title: 'Организации', icon: 'bi-building', items: companyResults },
      { key: 'specialists', title: 'Нотариусы и ЧСИ', icon: 'bi-person-badge', items: specialistResults },
      { key: 'registries', title: 'Реестры', icon: 'bi-journal-bookmark', items: registryItems },
      { key: 'laws', title: 'Статьи законов', icon: 'bi-journal-text', items: lawResults },
      { key: 'news', title: 'Новости', icon: 'bi-newspaper', items: newsResults },
      { key: 'open-data', title: 'Открытые данные', icon: 'bi-database', items: openDataResults },
      { key: 'sections', title: 'Разделы и инструменты', icon: 'bi-grid', items: sectionResults },
    ].filter(group => group.items.length);
  }

  app.get('/poisk', asyncHandler(async (req, res) => {
    const query = normalizeSearchQuery(req.query.q);
    const groups = query.length >= 2 ? await buildGlobalSearchResults(query) : [];
    const total = groups.reduce((sum, group) => sum + group.items.length, 0);
    res.set('Cache-Control', query ? 'private, no-store' : 'public, max-age=300');
    res.render('search/global', { query, groups, total });
  }));

}

module.exports = { registerSearchRoutes };
