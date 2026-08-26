'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { OPEN_DATA_DATASETS, genericDatasetDefinition } = require('./open-data-config');
const {
  createCatalogClient,
  discoverGovernmentSectorDatasets,
  fetchDatasetPassport,
  fetchPublicDatasetRows,
} = require('./open-data-catalog');

const ROOT = path.join(__dirname, '..');
const DEFAULT_OUTPUT = path.join(ROOT, 'data', 'open-data-snapshots.json');
const DEFAULT_PAGE_SIZE = 500;
const MINIMUM_GOVERNMENT_SECTOR_DATASETS = 50;
const PERSONAL_FIELD_PATTERN = /^(?:fio|iin|phone|telephone|email|mail|address|fullname|surname|firstname|lastname|patronymic|birthdate|фио|иин|телефон|почта|элпочта|адрес|фамилия|имя|отчество|датарождения)$/i;

function clean(value) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/\s+/g, ' ').trim();
}

function normalizedRow(row) {
  const result = new Map();
  Object.entries(row || {}).forEach(([key, value]) => {
    result.set(String(key).toLowerCase().replace(/[^a-zа-яё0-9]/gi, ''), value);
  });
  return result;
}

function pick(row, candidates) {
  const values = normalizedRow(row);
  for (const candidate of candidates) {
    const value = values.get(candidate.toLowerCase().replace(/[^a-zа-яё0-9]/gi, ''));
    if (clean(value)) return value;
  }
  return '';
}

function excelSerialToIso(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 20000 || numeric > 90000) return '';
  const date = new Date(Math.round((numeric - 25569) * 86400 * 1000));
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().substring(0, 10);
}

function dateToIso(value) {
  const raw = clean(value);
  if (!raw) return '';
  const excel = excelSerialToIso(raw);
  if (excel) return excel;
  const ru = raw.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})/);
  if (ru) return `${ru[3]}-${ru[2].padStart(2, '0')}-${ru[1].padStart(2, '0')}`;
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return iso ? iso[0] : '';
}

function distribution(rows, candidates) {
  const counts = new Map();
  rows.forEach(row => {
    const label = clean(pick(row, candidates)) || 'Не указано';
    counts.set(label, (counts.get(label) || 0) + 1);
  });
  return Array.from(counts, ([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'ru'));
}

function dateRange(rows, candidates) {
  const dates = rows.map(row => dateToIso(pick(row, candidates))).filter(Boolean).sort();
  return dates.length ? { from: dates[0], to: dates[dates.length - 1] } : { from: '', to: '' };
}

function auditIndicators(rows) {
  return rows.map((row, index) => {
    const entries = Object.entries(row || {});
    const titleEntry = entries.find(([key]) => /naimen|наимен/i.test(key) && /ru/i.test(key))
      || entries.find(([key]) => /naimen|наимен/i.test(key));
    const valueEntry = entries.find(([key]) => /kvartal|квартал/i.test(key) && !/naimen|наимен/i.test(key));
    return {
      order: Number.parseInt(clean(row.id), 10) || index + 1,
      title: clean(titleEntry?.[1]) || `Показатель ${index + 1}`,
      value: clean(valueEntry?.[1]),
      unit: clean(pick(row, ['ed.izm_ru', 'edizmr', 'unitru'])) || '—',
    };
  }).filter(item => item.title && item.value)
    .sort((a, b) => a.order - b.order);
}

function normalizedKey(key) {
  return String(key || '').toLowerCase().replace(/[^a-zа-яё0-9]/gi, '');
}

function isSensitiveField(key) {
  return PERSONAL_FIELD_PATTERN.test(normalizedKey(key));
}

function officialDataUrl(value) {
  try {
    const url = new URL(clean(value));
    if (url.protocol !== 'https:' || url.hostname !== 'data.egov.kz') return '';
    url.username = '';
    url.password = '';
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch (_) {
    return '';
  }
}

function numeric(value) {
  const raw = clean(value).replace(/\s/g, '').replace(',', '.');
  if (!raw || !/^-?\d+(?:\.\d+)?$/.test(raw)) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function genericSummary(rows) {
  const keys = Array.from(new Set(rows.flatMap(row => Object.keys(row || {}))));
  const columns = keys.map(key => {
    const values = rows.map(row => clean(row[key])).filter(Boolean);
    const sensitive = isSensitiveField(key);
    const numbers = values.map(numeric).filter(value => value !== null);
    const dateValues = values.map(dateToIso).filter(Boolean).sort();
    const counts = new Map();
    if (!sensitive) values.forEach(value => counts.set(value, (counts.get(value) || 0) + 1));
    const topValues = Array.from(counts, ([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'ru'))
      .slice(0, 10);
    const numericColumn = values.length > 0 && numbers.length / values.length >= 0.8;
    const dateColumn = !numericColumn && values.length > 0 && dateValues.length / values.length >= 0.8;
    return {
      key,
      label: key.replace(/_/g, ' '),
      type: sensitive ? 'personal' : numericColumn ? 'number' : dateColumn ? 'date' : 'text',
      sensitive,
      filledCount: values.length,
      emptyCount: rows.length - values.length,
      uniqueCount: new Set(values).size,
      ...(numericColumn ? {
        minimum: Math.min(...numbers), maximum: Math.max(...numbers),
        total: numbers.reduce((sum, value) => sum + value, 0),
      } : {}),
      ...(dateColumn ? { dateRange: { from: dateValues[0], to: dateValues[dateValues.length - 1] } } : {}),
      ...(!sensitive && !numericColumn && !dateColumn && topValues.length <= 10 ? { topValues } : {}),
    };
  });
  const safeKeys = keys.filter(key => !isSensitiveField(key));
  const sampleRows = rows.slice(0, 20).map(row => Object.fromEntries(safeKeys.map(key => [key, clean(row[key])])));
  return {
    columns,
    sampleRows,
    sensitiveColumns: columns.filter(column => column.sensitive).map(column => column.label),
  };
}

function aggregateDataset(dataset, rows, options = {}) {
  const safeRows = Array.isArray(rows) ? rows.filter(row => row && typeof row === 'object') : [];
  const completeness = options.complete === true ? 'complete' : 'provided_snapshot';
  const base = {
    key: dataset.key,
    kind: dataset.kind,
    rowCount: safeRows.length,
    hasData: safeRows.length > 0,
    completeness,
    rowLimitReached: options.complete !== true && safeRows.length >= 100,
  };

  if (dataset.kind === 'housing_received') {
    return {
      ...base,
      categories: distribution(safeRows, ['categor', 'category', 'subcategory']),
      programs: distribution(safeRows, ['mgp', 'program', 'programme']),
      localities: distribution(safeRows, ['region', 'obl']),
      dateRange: dateRange(safeRows, ['give_date', 'date_pas', 'date']),
    };
  }

  if (dataset.kind === 'housing_waitlist') {
    return {
      ...base,
      categories: distribution(safeRows, ['subcategory', 'categor', 'category']),
      localities: distribution(safeRows, ['region', 'obl']),
      dateRange: dateRange(safeRows, ['queuedate', 'queue_date', 'date']),
    };
  }

  if (dataset.kind === 'audit') {
    return { ...base, indicators: auditIndicators(safeRows) };
  }

  if (dataset.kind === 'government_sector') {
    return { ...base, ...genericSummary(safeRows) };
  }

  return base;
}

function unwrapRows(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.elements)) return payload.elements;
  throw new Error('Источник вернул данные в неизвестном формате');
}

async function fetchDatasetRows(dataset, apiKey, http = axios) {
  const rows = [];
  let searchAfter = null;
  const seenCursors = new Set();

  for (let page = 0; page < 1000; page += 1) {
    const source = { size: DEFAULT_PAGE_SIZE, sort: [{ id: { order: 'asc' } }] };
    if (searchAfter !== null) source.search_after = [searchAfter];
    const response = await http.get(dataset.apiUrl, {
      timeout: 45000,
      params: { apiKey, source: JSON.stringify(source) },
      headers: { Accept: 'application/json', 'User-Agent': 'ZakonExpert open-data updater/1.0' },
    });
    const batch = unwrapRows(response.data);
    rows.push(...batch);
    if (batch.length < DEFAULT_PAGE_SIZE) break;
    const nextCursor = batch[batch.length - 1]?.id;
    if (nextCursor === undefined || nextCursor === null || seenCursors.has(String(nextCursor))) {
      throw new Error(`Не удалось продолжить постраничную загрузку набора ${dataset.key}`);
    }
    seenCursors.add(String(nextCursor));
    searchAfter = nextCursor;
  }
  return rows;
}

function snapshotDigest(datasets) {
  return crypto.createHash('sha256').update(JSON.stringify(datasets)).digest('hex').substring(0, 16);
}

function writeSnapshot(outputPath, snapshot) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const temporary = `${outputPath}.tmp-${process.pid}`;
  fs.writeFileSync(temporary, `${JSON.stringify(snapshot, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, outputPath);
}

function safeBundleFile(inputDir, relativePath) {
  const root = path.resolve(inputDir);
  const resolved = path.resolve(root, String(relativePath || ''));
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error('Путь файла выходит за пределы каталога импорта');
  }
  return resolved;
}

function bundleDataset(configured, entry, rows) {
  const dataset = {
    ...configured,
    ...entry,
    key: configured.key,
    kind: configured.kind,
    index: configured.index,
    path: configured.path,
  };
  return {
    ...aggregateDataset(dataset, rows, { complete: entry.complete !== false }),
    path: dataset.path,
    title: dataset.title,
    description: dataset.description,
    agency: dataset.agency,
    category: dataset.category || 'Государственный сектор',
    version: dataset.version,
    datasetUrl: officialDataUrl(dataset.datasetUrl),
    apiUrl: officialDataUrl(dataset.apiUrl),
    metaUrl: officialDataUrl(dataset.metaUrl),
    publishedAt: dataset.publishedAt,
    updatedAt: dataset.updatedAt,
    updateFrequency: dataset.updateFrequency,
  };
}

async function refreshOpenDataSnapshot(options = {}) {
  const apiKey = clean(options.apiKey || process.env.EGOV_API_KEY);
  const inputDir = options.inputDir ? path.resolve(options.inputDir) : '';
  const outputPath = path.resolve(options.outputPath || DEFAULT_OUTPUT);
  if (!inputDir && !apiKey) throw new Error('EGOV_API_KEY не задан');

  const aggregated = {};
  if (inputDir) {
    const catalogPath = path.join(inputDir, 'catalog.json');
    if (fs.existsSync(catalogPath)) {
      const entries = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
      if (!Array.isArray(entries)) throw new Error('catalog.json должен содержать массив наборов');
      const minimumCatalogSize = Number.isFinite(Number(options.minimumCatalogSize))
        ? Number(options.minimumCatalogSize)
        : MINIMUM_GOVERNMENT_SECTOR_DATASETS;
      if (entries.length < minimumCatalogSize) {
        throw new Error(`catalog.json неполный: ${entries.length} наборов вместо минимум ${minimumCatalogSize}`);
      }
      const byIndex = new Map(OPEN_DATA_DATASETS.map(dataset => [dataset.index, dataset]));
      const seenEntries = new Set();
      for (const entry of entries) {
        const entryIndex = clean(entry.index);
        if (!entryIndex) throw new Error('В catalog.json найден набор без index');
        const signature = `${entryIndex}@${clean(entry.version || 'latest')}`;
        if (seenEntries.has(signature)) throw new Error(`В catalog.json найден дубликат ${signature}`);
        seenEntries.add(signature);
        const configured = byIndex.get(entryIndex) || genericDatasetDefinition(entry);
        const recordsPath = safeBundleFile(inputDir, entry.recordsFile || `records/${configured.index}-${entry.version || 'latest'}.json`);
        if (!fs.existsSync(recordsPath)) throw new Error(`Не найден файл записей ${path.relative(inputDir, recordsPath)}`);
        const rows = unwrapRows(JSON.parse(fs.readFileSync(recordsPath, 'utf8')));
        aggregated[configured.key] = bundleDataset(configured, entry, rows);
      }
      for (const dataset of OPEN_DATA_DATASETS) {
        if (!aggregated[dataset.key]) aggregated[dataset.key] = aggregateDataset(dataset, [], { complete: false });
      }
    } else {
      for (const dataset of OPEN_DATA_DATASETS) {
        const inputPath = dataset.sourceFile ? path.join(inputDir, dataset.sourceFile) : '';
        const rows = inputPath && fs.existsSync(inputPath)
          ? unwrapRows(JSON.parse(fs.readFileSync(inputPath, 'utf8')))
          : [];
        aggregated[dataset.key] = aggregateDataset(dataset, rows, { complete: false });
      }
    }
  } else {
    let previous = { datasets: {} };
    try { previous = JSON.parse(fs.readFileSync(outputPath, 'utf8')); } catch (_) { /* first refresh */ }
    const client = await createCatalogClient(options.http || axios);
    const discovered = await discoverGovernmentSectorDatasets(client);
    const byIndex = new Map(OPEN_DATA_DATASETS.map(dataset => [dataset.index, dataset]));

    for (const listed of discovered) {
      const configured = byIndex.get(listed.index) || genericDatasetDefinition(listed);
      try {
        const passport = await fetchDatasetPassport(client, listed.index);
        const dataset = { ...configured, ...listed, ...passport, key: configured.key, kind: configured.kind };
        let rows;
        if (apiKey && dataset.apiUrl) {
          try { rows = await fetchDatasetRows(dataset, apiKey, options.http || axios); }
          catch (_) { rows = await fetchPublicDatasetRows(client, dataset); }
        } else {
          rows = await fetchPublicDatasetRows(client, dataset);
        }
        aggregated[dataset.key] = {
          ...aggregateDataset(dataset, rows, { complete: true }),
          path: dataset.path,
          title: dataset.title,
          description: dataset.description,
          agency: dataset.agency,
          category: dataset.category,
          version: dataset.version,
          datasetUrl: dataset.datasetUrl,
          apiUrl: dataset.apiUrl,
          metaUrl: dataset.metaUrl,
          publishedAt: dataset.publishedAt,
          updatedAt: dataset.updatedAt,
          updateFrequency: dataset.updateFrequency,
        };
      } catch (error) {
        const prior = previous.datasets?.[configured.key];
        aggregated[configured.key] = prior || {
          ...aggregateDataset(configured, [], { complete: false }),
          fetchError: clean(error.message),
        };
      }
    }

    // Keep connected datasets from other categories (for example the empty
    // rehabilitation set) in the snapshot as well.
    for (const dataset of OPEN_DATA_DATASETS) {
      if (aggregated[dataset.key]) continue;
      if (dataset.kind === 'government_sector') {
        aggregated[dataset.key] = previous.datasets?.[dataset.key]
          || aggregateDataset(dataset, [], { complete: false });
        continue;
      }
      try {
        const rows = dataset.apiUrl ? await fetchDatasetRows(dataset, apiKey, options.http || axios) : [];
        aggregated[dataset.key] = aggregateDataset(dataset, rows, { complete: true });
      } catch (error) {
        aggregated[dataset.key] = previous.datasets?.[dataset.key]
          || { ...aggregateDataset(dataset, [], { complete: false }), fetchError: clean(error.message) };
      }
    }
  }

  const snapshot = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    source: 'data.egov.kz',
    privacy: 'aggregate-only-no-personal-records',
    datasets: aggregated,
    digest: snapshotDigest(aggregated),
  };
  writeSnapshot(outputPath, snapshot);
  return snapshot;
}

function containsPersonalField(rows) {
  return (Array.isArray(rows) ? rows : []).some(row =>
    Object.keys(row || {}).some(isSensitiveField)
  );
}

module.exports = {
  DEFAULT_OUTPUT,
  aggregateDataset,
  containsPersonalField,
  dateToIso,
  excelSerialToIso,
  fetchDatasetRows,
  genericSummary,
  isSensitiveField,
  officialDataUrl,
  refreshOpenDataSnapshot,
};
