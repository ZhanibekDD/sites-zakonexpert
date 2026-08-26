'use strict';

const axios = require('axios');
const { dateToIso } = require('./open-data-refresh');

const SEARCH_PAGE_SIZE = 100;
const MAX_RESULTS = 100;
const PREFERRED_HOUSING_FIELDS = [
  'id', 'fio', 'queuedate', 'queue_date', 'obl', 'oblast', 'region', 'city',
  'subcategory', 'categor', 'category', 'mgp', 'program', 'programme',
  'date_pas', 'give_date', 'date',
];
const FIELD_LABELS = {
  id: '№', fio: 'ФИО', queuedate: 'Дата постановки на учёт', queue_date: 'Дата постановки на учёт',
  obl: 'Область', oblast: 'Область', region: 'Населённый пункт / район', city: 'Город',
  subcategory: 'Категория', categor: 'Категория', category: 'Категория',
  mgp: 'Программа', program: 'Программа', programme: 'Программа', date_pas: 'Дата документа',
  give_date: 'Дата предоставления жилья', date: 'Дата', note: 'Примечание',
};

const NON_DATA_FIELD = /^(?:_.*|api_?key|access_?token|token|password|secret)$/i;

function clean(value) {
  return String(value === null || value === undefined ? '' : value).replace(/\s+/g, ' ').trim();
}

function normalizeFullName(value) {
  return clean(value)
    .normalize('NFKC')
    .replace(/[.,;:()\[\]{}"«»]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleUpperCase('ru-RU');
}

function validateFullName(value) {
  const normalized = normalizeFullName(value);
  if (normalized.length < 5 || normalized.length > 120) return null;
  if (normalized.split(' ').filter(Boolean).length < 2) return null;
  if (!/^[A-ZА-ЯЁӘҒҚҢӨҰҮҺІ\- ']+$/u.test(normalized)) return null;
  return normalized;
}

function unwrapRows(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.elements)) return payload.elements;
  return [];
}

function valueFrom(row, candidates) {
  const entries = new Map(Object.entries(row || {}).map(([key, value]) => [String(key).toLowerCase(), value]));
  for (const candidate of candidates) {
    const value = clean(entries.get(candidate.toLowerCase()));
    if (value) return value;
  }
  return '';
}

function listType(dataset) {
  const title = clean(dataset.title).toLowerCase();
  if (dataset.kind === 'housing_waitlist' || /нуждающ|уч[её]т|очеред/.test(title)) return 'Состоит на учёте';
  if (dataset.kind === 'housing_received' || /получивш|предоставлен/.test(title)) return 'Получил(а) жильё';
  return 'Жилищный список';
}

function fieldLabel(key) {
  if (FIELD_LABELS[key]) return FIELD_LABELS[key];
  const label = clean(key).replace(/[_-]+/g, ' ');
  return label ? label.charAt(0).toLocaleUpperCase('ru-RU') + label.slice(1) : key;
}

function publicFieldEntries(row) {
  const entries = Object.entries(row || {})
    .filter(([key]) => key && key.length <= 120 && !NON_DATA_FIELD.test(key))
    .map(([key, value]) => {
      const scalar = value && typeof value === 'object' ? JSON.stringify(value) : value;
      const cleaned = clean(scalar);
      return [key, /date/i.test(key) ? (dateToIso(cleaned) || cleaned) : cleaned];
    });
  const rank = key => {
    const index = PREFERRED_HOUSING_FIELDS.indexOf(key);
    return index === -1 ? PREFERRED_HOUSING_FIELDS.length : index;
  };
  return entries.sort((left, right) => rank(left[0]) - rank(right[0]));
}

function isHousingDataset(dataset) {
  if (!dataset?.apiUrl || !dataset?.datasetUrl) return false;
  if (dataset.kind === 'housing_waitlist' || dataset.kind === 'housing_received') return true;
  const title = clean(dataset.title).toLowerCase();
  return /список граждан/.test(title) && /жилищ/.test(title);
}

function safeResult(dataset, row) {
  const details = publicFieldEntries(row).map(([key, value]) => ({ key, label: fieldLabel(key), value }));
  return {
    fullName: clean(valueFrom(row, ['fio', 'full_name', 'fullname'])),
    listType: listType(dataset),
    region: clean(valueFrom(row, ['region', 'obl', 'oblast', 'city'])),
    category: clean(valueFrom(row, ['subcategory', 'categor', 'category'])),
    program: clean(valueFrom(row, ['mgp', 'program', 'programme'])),
    recordDate: clean(valueFrom(row, ['queuedate', 'queue_date', 'give_date', 'date_pas', 'date'])),
    datasetTitle: clean(dataset.title),
    datasetUrl: clean(dataset.datasetUrl),
    sourceUpdatedAt: clean(dataset.updatedAt),
    details,
  };
}

function publicHousingRow(row) {
  return Object.fromEntries(publicFieldEntries(row));
}

function publicColumns(rows) {
  const present = new Set(rows.flatMap(row => Object.keys(row || {})));
  const preferred = PREFERRED_HOUSING_FIELDS.filter(key => present.has(key));
  const extra = Array.from(present).filter(key => !PREFERRED_HOUSING_FIELDS.includes(key)).sort();
  return preferred.concat(extra).map(key => ({ key, label: fieldLabel(key) }));
}

async function searchDataset(dataset, fullName, apiKey, http = axios) {
  const source = {
    size: SEARCH_PAGE_SIZE,
    query: {
      bool: {
        should: [
          { match_phrase: { fio: fullName } },
          { match_phrase: { full_name: fullName } },
          { match_phrase: { fullname: fullName } },
        ],
        minimum_should_match: 1,
      },
    },
  };
  const response = await http.get(dataset.apiUrl, {
    timeout: 25000,
    params: { apiKey, source: JSON.stringify(source) },
    headers: { Accept: 'application/json', 'User-Agent': 'ZakonExpert exact housing lookup/1.0' },
  });
  const expected = normalizeFullName(fullName);
  return unwrapRows(response.data)
    .filter(row => normalizeFullName(valueFrom(row, ['fio', 'full_name', 'fullname'])) === expected)
    .map(row => safeResult(dataset, row));
}

async function fetchHousingRecordsPage(options = {}) {
  const dataset = options.dataset;
  if (!isHousingDataset(dataset)) throw new Error('Жилищный набор не найден');
  const apiKey = clean(options.apiKey);
  if (!apiKey) throw new Error('Доступ к официальному API временно не настроен');
  const cursor = clean(options.cursor);
  const requestedLimit = Number.parseInt(options.limit, 10);
  const limit = Number.isFinite(requestedLimit) ? Math.min(100, Math.max(10, requestedLimit)) : 50;
  const source = { size: limit, sort: [{ id: { order: 'asc' } }] };
  if (cursor) source.search_after = [/^-?\d+(?:\.\d+)?$/.test(cursor) ? Number(cursor) : cursor];
  const fullName = options.fullName ? validateFullName(options.fullName) : '';
  if (options.fullName && !fullName) throw new Error('Введите ФИО полностью');
  if (fullName) {
    source.query = {
      bool: {
        should: [
          { match_phrase: { fio: fullName } },
          { match_phrase: { full_name: fullName } },
          { match_phrase: { fullname: fullName } },
        ],
        minimum_should_match: 1,
      },
    };
  }

  const response = await (options.http || axios).get(dataset.apiUrl, {
    timeout: 25000,
    params: { apiKey, source: JSON.stringify(source) },
    headers: { Accept: 'application/json', 'User-Agent': 'ZakonExpert housing records/1.0' },
  });
  let rows = unwrapRows(response.data);
  if (fullName) {
    rows = rows.filter(row => normalizeFullName(valueFrom(row, ['fio', 'full_name', 'fullname'])) === fullName);
  }
  const publicRows = rows.map(publicHousingRow);
  const lastId = rows.length ? clean(valueFrom(rows[rows.length - 1], ['id'])) : '';
  return {
    dataset: {
      key: dataset.key,
      title: dataset.title,
      sourceUrl: dataset.datasetUrl,
      updatedAt: dataset.updatedAt,
    },
    columns: publicColumns(publicRows),
    rows: publicRows,
    nextCursor: !fullName && rows.length === limit && lastId ? lastId : '',
    hasMore: !fullName && rows.length === limit && Boolean(lastId),
    source: 'data.egov.kz',
  };
}

async function searchHousingRecords(options = {}) {
  const fullName = validateFullName(options.fullName);
  if (!fullName) throw new Error('Введите фамилию, имя и при наличии отчество полностью');
  const apiKey = clean(options.apiKey);
  if (!apiKey) throw new Error('Поиск временно недоступен: ключ официального API не настроен');
  const datasets = (Array.isArray(options.datasets) ? options.datasets : []).filter(isHousingDataset);
  const results = [];
  let failedDatasets = 0;

  for (let offset = 0; offset < datasets.length; offset += 5) {
    const chunk = datasets.slice(offset, offset + 5);
    const settled = await Promise.allSettled(chunk.map(dataset => searchDataset(dataset, fullName, apiKey, options.http)));
    settled.forEach(item => {
      if (item.status === 'fulfilled') results.push(...item.value);
      else failedDatasets += 1;
    });
    if (results.length >= MAX_RESULTS) break;
  }

  const unique = [];
  const seen = new Set();
  results.slice(0, MAX_RESULTS).forEach(item => {
    const signature = [normalizeFullName(item.fullName), item.datasetUrl, item.region, item.category, item.program, item.recordDate].join('|');
    if (!seen.has(signature)) {
      seen.add(signature);
      unique.push(item);
    }
  });

  return {
    query: fullName,
    results: unique,
    searchedDatasets: datasets.length,
    failedDatasets,
    source: 'data.egov.kz',
  };
}

module.exports = {
  fetchHousingRecordsPage,
  isHousingDataset,
  normalizeFullName,
  searchDataset,
  searchHousingRecords,
  validateFullName,
};
