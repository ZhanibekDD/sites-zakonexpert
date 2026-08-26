'use strict';

const axios = require('axios');
const cheerio = require('cheerio');

const DATA_EGOV_ORIGIN = 'https://data.egov.kz';
const GOVERNMENT_SECTOR_CATEGORY_ID = 'AVS-EI0B99eXTcgzfxyo';
const CATEGORY_URL = `${DATA_EGOV_ORIGIN}/datasets/listbycategory?categoryId=${GOVERNMENT_SECTOR_CATEGORY_ID}`;
const HTML_ACCEPT = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8';

function clean(value) {
  return String(value === null || value === undefined ? '' : value).replace(/\s+/g, ' ').trim();
}

function cookieHeader(response) {
  return (response.headers?.['set-cookie'] || []).map(value => value.split(';')[0]).join('; ');
}

async function createCatalogClient(http = axios) {
  const response = await http.get(CATEGORY_URL, {
    timeout: 45000,
    headers: { Accept: HTML_ACCEPT, 'User-Agent': 'ZakonExpert open-data catalog/1.0' },
  });
  const cookies = cookieHeader(response);
  return axios.create({
    baseURL: DATA_EGOV_ORIGIN,
    timeout: 45000,
    headers: {
      Accept: 'application/json, text/javascript, */*; q=0.01',
      'User-Agent': 'ZakonExpert open-data catalog/1.0',
      'X-Requested-With': 'XMLHttpRequest',
      Referer: CATEGORY_URL,
      ...(cookies ? { Cookie: cookies } : {}),
    },
  });
}

async function discoverGovernmentSectorDatasets(client) {
  const common = {
    byGovAgencyId: '',
    categoryId: GOVERNMENT_SECTOR_CATEGORY_ID,
    statusType: '',
    datasetSortSelect: '',
    status: 'PUBLISHED',
  };
  const countResponse = await client.get('/datasets/getdatasetsrecount', { params: common });
  const totalCount = Number(countResponse.data?.totalCount) || 0;
  const pageSize = 100;
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const datasets = [];
  for (let page = 1; page <= totalPages; page += 1) {
    const response = await client.get('/datasets/getdatasetsre', { params: { ...common, page, count: pageSize } });
    const batch = Array.isArray(response.data?.datasets) ? response.data.datasets : [];
    datasets.push(...batch.map(dataset => ({
      index: clean(dataset.apiUri),
      title: clean(dataset.nameRu || dataset.nameKk || dataset.nameEn),
      description: clean(dataset.descriptionRu || dataset.descriptionKk || dataset.descriptionEn),
      createdAt: clean(dataset.createdDate),
      status: clean(dataset.status),
    })).filter(dataset => dataset.index));
  }
  return datasets;
}

function portalDateToIso(value) {
  const match = clean(value).match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:\s+(\d{1,2}):(\d{2}))?/);
  if (!match) return '';
  return `${match[3]}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}T${(match[4] || '00').padStart(2, '0')}:${match[5] || '00'}:00+05:00`;
}

function parseDatasetPassport(html, index) {
  const $ = cheerio.load(html);
  const fields = new Map();
  $('table tr').each((_, row) => {
    const cells = $(row).find('td');
    if (cells.length < 2) return;
    fields.set(clean(cells.eq(0).text()).toLowerCase(), clean(cells.eq(1).text()));
  });
  const apiHref = $('a[href*="/api/v4/"]').first().attr('href') || '';
  const apiMatch = apiHref.match(/\/api\/v4\/([^/?]+)\/(v\d+)/i);
  // The portal builds API links with JavaScript, so the current version is
  // normally present on a tab rather than in a literal href.
  const scriptVersion = clean(html.match(/currentVersion\s*=\s*['"](v\d+)['"]/i)?.[1]);
  const tabVersion = clean($('.version[type^="v"]').first().attr('type'));
  const resolvedIndex = clean(apiMatch?.[1] || index);
  const version = clean(apiMatch?.[2] || scriptVersion || tabVersion);
  return {
    index: resolvedIndex,
    title: fields.get('название') || $('title').text().trim(),
    description: fields.get('описание') || '',
    agency: fields.get('государственный орган') || fields.get('владелец') || '',
    category: fields.get('категория') || 'Государственный сектор',
    updateFrequency: fields.get('тип актуализации') || '',
    publishedAt: portalDateToIso(fields.get('дата размещения')),
    updatedAt: portalDateToIso(fields.get('дата обновления')),
    status: fields.get('статус') || '',
    version,
    datasetUrl: `${DATA_EGOV_ORIGIN}/datasets/view?index=${resolvedIndex}`,
    apiUrl: version ? `${DATA_EGOV_ORIGIN}/api/v4/${resolvedIndex}/${version}` : '',
    metaUrl: version ? `${DATA_EGOV_ORIGIN}/meta/${resolvedIndex}/${version}` : '',
  };
}

function catalogDateToIso(value) {
  const raw = clean(value);
  if (!raw) return '';
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString();
}

const ACTUALIZE_LABELS = Object.freeze({
  DAILY: 'Ежедневно', WEEKLY: 'Еженедельно', MONTHLY: 'Ежемесячно',
  QUARTERLY: 'Ежеквартально', HALF_YEAR: 'Каждые полгода', YEARLY: 'Ежегодно',
  AS_NEEDED: 'По мере необходимости',
});

function normalizeCatalogDataset(dataset) {
  const index = clean(dataset?.apiUri || dataset?.id);
  const category = Array.isArray(dataset?.categories) ? dataset.categories[0] || {} : {};
  const agency = dataset?.govAgency || {};
  const status = clean(dataset?.status).toLowerCase();
  return {
    index,
    title: clean(dataset?.nameRu || dataset?.nameKk || dataset?.nameEn || index),
    titleKk: clean(dataset?.nameKk),
    titleEn: clean(dataset?.nameEn),
    description: clean(dataset?.descriptionRu || dataset?.descriptionKk || dataset?.descriptionEn),
    descriptionKk: clean(dataset?.descriptionKk),
    descriptionEn: clean(dataset?.descriptionEn),
    category: clean(category.nameRu || category.nameKk || category.nameEn || 'Без категории'),
    categoryId: clean(category.id),
    categoryIcon: clean(category.icon),
    agency: clean(agency.nameRu || agency.nameKk || agency.nameEn || 'Организация не указана'),
    agencyId: clean(agency.id),
    agencyType: clean(agency.type),
    agencyIsGovernment: Boolean(agency.isGovAgency),
    keywords: (Array.isArray(dataset?.keyWords) ? dataset.keyWords : []).map(clean).filter(Boolean),
    status: status || 'published',
    actual: dataset?.actual !== false && dataset?.actualizationStatus !== false,
    updateFrequency: ACTUALIZE_LABELS[clean(dataset?.actualizeType).toUpperCase()] || clean(dataset?.actualizeType),
    publishedAt: catalogDateToIso(dataset?.createdDate),
    updatedAt: catalogDateToIso(dataset?.modifiedDate),
    portalViews: Number(dataset?.views) || 0,
    portalDownloads: Number(dataset?.downloads) || 0,
    terminalStatus: index ? 'live-api-version-resolved-on-demand' : 'metadata-only-no-api-uri',
  };
}

async function discoverAllPublishedDatasets(http = axios, options = {}) {
  const requestedPageSize = Math.min(200, Math.max(20, Number(options.pageSize) || 100));
  const requestOptions = {
    timeout: 45000,
    headers: {
      Accept: 'application/json, text/javascript, */*; q=0.01',
      'User-Agent': 'ZakonExpert complete open-data inventory/1.0',
      'X-Requested-With': 'XMLHttpRequest',
    },
  };
  const common = {
    byGovAgencyId: '', categoryId: '', statusType: '', datasetSortSelect: '', status: 'PUBLISHED',
  };
  const countResponse = await http.get(`${DATA_EGOV_ORIGIN}/datasets/getdatasetsrecount`, {
    ...requestOptions, params: common,
  });
  const expectedCount = Number(countResponse.data?.totalCount) || 0;
  const fetchPage = async page => {
    let lastError;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        const response = await http.get(`${DATA_EGOV_ORIGIN}/datasets/getdatasetsre`, {
          ...requestOptions, params: { ...common, page, count: requestedPageSize },
        });
        return Array.isArray(response.data?.datasets) ? response.data.datasets : [];
      } catch (error) {
        lastError = error;
        if (attempt < 3) await new Promise(resolve => setTimeout(resolve, attempt * 500));
      }
    }
    throw lastError;
  };
  const firstBatch = await fetchPage(1);
  // The current portal caps this endpoint at ten items even when a larger
  // count is requested. Derive pagination from the response, not from the
  // requested count, otherwise only the first 400 of ~3900 sets are read.
  const effectivePageSize = firstBatch.length || requestedPageSize;
  const totalPages = Math.max(1, Math.ceil(expectedCount / effectivePageSize));
  const discovered = firstBatch.map(normalizeCatalogDataset).filter(item => item.index);
  if (typeof options.onProgress === 'function') options.onProgress({ page: 1, totalPages, discovered: discovered.length });
  const concurrency = Math.min(8, Math.max(2, Number(options.concurrency) || 4));
  for (let firstPage = 2; firstPage <= totalPages; firstPage += concurrency) {
    const pages = Array.from(
      { length: Math.min(concurrency, totalPages - firstPage + 1) },
      (_, offset) => firstPage + offset
    );
    const batches = await Promise.all(pages.map(fetchPage));
    batches.forEach(batch => discovered.push(...batch.map(normalizeCatalogDataset).filter(item => item.index)));
    if (typeof options.onProgress === 'function') {
      options.onProgress({ page: pages.at(-1), totalPages, discovered: discovered.length });
    }
  }
  const unique = Array.from(new Map(discovered.map(dataset => [dataset.index, dataset])).values());
  return { expectedCount, datasets: unique };
}

async function fetchDatasetPassport(client, index) {
  const response = await client.get('/datasets/view', {
    params: { index },
    headers: { Accept: HTML_ACCEPT },
  });
  return parseDatasetPassport(response.data, index);
}

async function fetchPublicDatasetRows(client, dataset) {
  const rows = [];
  const pageSize = 100;
  for (let page = 1; page <= 1000; page += 1) {
    const response = await client.get('/datasets/getdata', {
      params: { index: dataset.index, version: dataset.version, page, count: pageSize, text: '', column: '', order: '' },
    });
    const body = response.data || {};
    const batch = Array.isArray(body.elements) ? body.elements : [];
    rows.push(...batch);
    const totalPages = Number(body.totalPages) || 0;
    if (!batch.length || batch.length < pageSize || (totalPages && page >= totalPages)) break;
  }
  return rows;
}

module.exports = {
  CATEGORY_URL,
  GOVERNMENT_SECTOR_CATEGORY_ID,
  createCatalogClient,
  discoverAllPublishedDatasets,
  discoverGovernmentSectorDatasets,
  fetchDatasetPassport,
  fetchPublicDatasetRows,
  parseDatasetPassport,
  portalDateToIso,
  normalizeCatalogDataset,
};
