'use strict';

const axios = require('axios');
const { createCatalogClient, fetchDatasetPassport } = require('./open-data-catalog');
const { cacheResponse, readMaterializedRecords } = require('./open-data-record-cache');

const DATA_EGOV_ORIGIN = 'https://data.egov.kz';

const PASSPORT_TTL_MS = 6 * 60 * 60 * 1000;
const passportCache = new Map();
const NON_PUBLIC_TECHNICAL_FIELD = /^(?:_.*|api_?key|access_?token|token|password|secret)$/i;

function clean(value) {
  return String(value === null || value === undefined ? '' : value).replace(/\s+/g, ' ').trim();
}

function unwrapRows(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.elements)) return payload.elements;
  return [];
}

function fieldLabel(key) {
  const common = {
    id: '№', fio: 'ФИО', fullname: 'ФИО', full_name: 'ФИО', iin: 'ИИН', bin: 'БИН',
    address: 'Адрес', phone: 'Телефон', email: 'E-mail', region: 'Регион',
    oblast: 'Область', city: 'Город', date: 'Дата', year: 'Год', name: 'Наименование',
  };
  const normalized = clean(key).toLowerCase();
  if (common[normalized]) return common[normalized];
  const label = clean(key).replace(/[_-]+/g, ' ');
  return label ? label.charAt(0).toLocaleUpperCase('ru-RU') + label.slice(1) : clean(key);
}

function publicRow(row) {
  return Object.fromEntries(Object.entries(row || {})
    .filter(([key]) => key && !NON_PUBLIC_TECHNICAL_FIELD.test(key))
    .map(([key, value]) => [key, value && typeof value === 'object' ? JSON.stringify(value) : clean(value)]));
}

function publicColumns(rows) {
  const keys = [];
  const seen = new Set();
  rows.forEach(row => Object.keys(row || {}).forEach(key => {
    if (!seen.has(key)) { seen.add(key); keys.push(key); }
  }));
  return keys.map(key => ({ key, label: fieldLabel(key) }));
}

function latestMappingVersion(payload, index) {
  const root = payload?.[index] || Object.values(payload || {}).find(value => value && typeof value === 'object') || {};
  const mappings = root.mappings && typeof root.mappings === 'object' ? root.mappings : root;
  return Object.keys(mappings || {})
    .filter(version => /^v\d+$/i.test(version))
    .sort((left, right) => Number(right.slice(1)) - Number(left.slice(1)))[0] || '';
}

async function resolveLiveDataset(dataset, http = axios, apiKey = '') {
  if (dataset?.apiUrl) {
    const inferredVersion = clean(dataset.version || dataset.apiUrl.match(/\/(v\d+)(?:[/?#]|$)/i)?.[1]);
    return { ...dataset, version: inferredVersion };
  }
  const index = clean(dataset?.index);
  if (!index || !/^[a-z0-9_-]{1,160}$/i.test(index)) throw new Error('Набор данных не найден');
  const cached = passportCache.get(index);
  if (cached && Date.now() - cached.savedAt < PASSPORT_TTL_MS) return { ...dataset, ...cached.passport };
  let passport = null;
  try {
    const mappingResponse = await http.get(`${DATA_EGOV_ORIGIN}/api/v4/mapping/${encodeURIComponent(index)}`, {
      timeout: 20000,
      params: apiKey ? { apiKey } : {},
      headers: { Accept: 'application/json', 'User-Agent': 'ZakonExpert version resolver/1.0' },
    });
    const version = latestMappingVersion(mappingResponse.data, index);
    if (version) {
      passport = {
        index,
        version,
        datasetUrl: `${DATA_EGOV_ORIGIN}/datasets/view?index=${encodeURIComponent(index)}`,
        apiUrl: `${DATA_EGOV_ORIGIN}/api/v4/${encodeURIComponent(index)}/${version}`,
        metaUrl: `${DATA_EGOV_ORIGIN}/meta/${encodeURIComponent(index)}/${version}`,
      };
    }
  } catch (_) {
    // Older datasets may not expose mapping without a portal session. The
    // passport fallback below resolves the same version through public HTML.
  }
  if (!passport) {
    const client = await createCatalogClient(http);
    passport = await fetchDatasetPassport(client, index);
  }
  if (!passport.version || !passport.apiUrl) throw new Error('В паспорте набора не указана активная версия API');
  passportCache.set(index, { savedAt: Date.now(), passport });
  if (passportCache.size > 500) passportCache.delete(passportCache.keys().next().value);
  return { ...dataset, ...passport };
}

function searchQuery(value) {
  const query = clean(value);
  if (!query) return null;
  if (query.length < 2 || query.length > 160) throw new Error('Запрос должен содержать от 2 до 160 символов');
  return {
    fuzzy_like_this: {
      fields: ['_all'],
      like_text: query,
      fuzziness: '1',
    },
  };
}

async function fetchOpenDataRecords(options = {}) {
  const apiKey = clean(options.apiKey);
  if (!apiKey) throw new Error('Ключ официального API не настроен');
  const dataset = await resolveLiveDataset(options.dataset, options.http || axios, apiKey);
  const offset = Math.max(0, Math.min(10_000_000, Number.parseInt(options.offset, 10) || 0));
  const limit = Math.max(10, Math.min(100, Number.parseInt(options.limit, 10) || 50));
  const source = { from: offset, size: limit };
  const query = searchQuery(options.query);
  if (query) source.query = query;
  const response = await (options.http || axios).get(dataset.apiUrl, {
    timeout: 30000,
    params: { apiKey, source: JSON.stringify(source) },
    headers: { Accept: 'application/json', 'User-Agent': 'ZakonExpert public records browser/1.0' },
  });
  const rows = unwrapRows(response.data).map(publicRow);
  return {
    dataset: {
      key: dataset.key,
      title: dataset.title,
      index: dataset.index,
      version: dataset.version,
      sourceUrl: dataset.datasetUrl,
      updatedAt: dataset.updatedAt,
    },
    columns: publicColumns(rows),
    rows,
    offset,
    nextOffset: rows.length === limit ? offset + rows.length : null,
    hasMore: rows.length === limit,
    query: clean(options.query),
    source: 'data.egov.kz',
  };
}

async function fetchOpenDataRecordsCached(options = {}) {
  const dataset = options.dataset;
  const offset = Math.max(0, Math.min(10_000_000, Number.parseInt(options.offset, 10) || 0));
  const limit = Math.max(10, Math.min(100, Number.parseInt(options.limit, 10) || 50));
  const query = clean(options.query);
  const materialized = await readMaterializedRecords({
    dataset,
    offset,
    limit,
    query,
    cacheDir: options.cacheDir,
  });
  if (materialized) {
    return {
      dataset: {
        key: dataset.key,
        title: dataset.title,
        index: dataset.index,
        version: materialized.manifest.version || dataset.version,
        sourceUrl: dataset.datasetUrl,
        updatedAt: dataset.updatedAt,
      },
      columns: publicColumns(materialized.rows),
      rows: materialized.rows,
      offset,
      nextOffset: materialized.hasMore ? offset + materialized.rows.length : null,
      hasMore: materialized.hasMore,
      query,
      source: 'data.egov.kz',
      delivery: materialized.delivery,
      cachedAt: materialized.cachedAt,
      cacheComplete: materialized.complete,
    };
  }

  const cacheKey = JSON.stringify({
    type: 'records', index: dataset.index, version: dataset.version || 'latest', offset, limit, query,
  });
  return cacheResponse({
    dataset,
    cacheKey,
    cacheDir: options.cacheDir,
    ttlMs: options.cacheTtlMs,
    fetcher: () => fetchOpenDataRecords({ ...options, offset, limit, query }),
  });
}

module.exports = {
  fetchOpenDataRecords,
  fetchOpenDataRecordsCached,
  fieldLabel,
  latestMappingVersion,
  publicColumns,
  publicRow,
  resolveLiveDataset,
  searchQuery,
};
