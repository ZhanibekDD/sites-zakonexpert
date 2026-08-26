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
  const resolvedIndex = clean(apiMatch?.[1] || index);
  const version = clean(apiMatch?.[2]);
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
  discoverGovernmentSectorDatasets,
  fetchDatasetPassport,
  fetchPublicDatasetRows,
  parseDatasetPassport,
  portalDateToIso,
};
