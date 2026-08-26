'use strict';

const fs = require('fs');
const path = require('path');
const { OPEN_DATA_DATASETS, OPEN_DATA_BY_KEY } = require('./open-data-config');
const { DEFAULT_OUTPUT } = require('./open-data-refresh');

const SITE_URL = 'https://zakonexpertt.kz';
let snapshotCache = null;
let snapshotMtime = 0;

function loadSnapshot(snapshotPath = DEFAULT_OUTPUT) {
  try {
    const stat = fs.statSync(snapshotPath);
    if (!snapshotCache || stat.mtimeMs !== snapshotMtime) {
      const parsed = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'));
      snapshotCache = parsed && parsed.datasets ? parsed : { datasets: {} };
      snapshotMtime = stat.mtimeMs;
    }
  } catch (_) {
    snapshotCache = { schemaVersion: 1, generatedAt: '', datasets: {} };
    snapshotMtime = 0;
  }
  return snapshotCache;
}

function withSnapshot(dataset) {
  const stats = loadSnapshot().datasets[dataset.key] || {};
  return {
    ...dataset,
    ...stats,
    hasData: Boolean(stats.hasData),
    rowCount: Number(stats.rowCount) || 0,
    categories: Array.isArray(stats.categories) ? stats.categories : [],
    programs: Array.isArray(stats.programs) ? stats.programs : [],
    localities: Array.isArray(stats.localities) ? stats.localities : [],
    indicators: Array.isArray(stats.indicators) ? stats.indicators : [],
    columns: Array.isArray(stats.columns) ? stats.columns : [],
    sampleRows: Array.isArray(stats.sampleRows) ? stats.sampleRows : [],
    sensitiveColumns: Array.isArray(stats.sensitiveColumns) ? stats.sensitiveColumns : [],
    dateRange: stats.dateRange || { from: '', to: '' },
  };
}

function datasetDefinitions() {
  const configuredKeys = new Set(OPEN_DATA_DATASETS.map(dataset => dataset.key));
  const dynamic = Object.values(loadSnapshot().datasets || {})
    .filter(dataset => dataset && dataset.key && dataset.path && !configuredKeys.has(dataset.key));
  return OPEN_DATA_DATASETS.concat(dynamic);
}

function listDatasets(kind) {
  return datasetDefinitions().filter(dataset => !kind || dataset.kind === kind).map(withSnapshot);
}

function getDataset(key) {
  const dataset = OPEN_DATA_BY_KEY.get(key) || datasetDefinitions().find(item => item.key === key);
  return dataset ? withSnapshot(dataset) : null;
}

function getDatasetByPath(requestPath) {
  const dataset = datasetDefinitions().find(item => item.path === requestPath);
  return dataset ? withSnapshot(dataset) : null;
}

function getHousingDataset(kind, regionSlug) {
  const dataset = OPEN_DATA_DATASETS.find(item => item.kind === kind && item.regionSlug === regionSlug);
  return dataset ? withSnapshot(dataset) : null;
}

function mergeDistribution(datasets, field) {
  const totals = new Map();
  datasets.forEach(dataset => {
    (dataset[field] || []).forEach(item => totals.set(item.label, (totals.get(item.label) || 0) + item.count));
  });
  return Array.from(totals, ([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'ru'));
}

function housingGroup(kind) {
  const datasets = listDatasets(kind);
  return {
    kind,
    datasets,
    rowCount: datasets.reduce((sum, dataset) => sum + dataset.rowCount, 0),
    partial: datasets.some(dataset => dataset.rowLimitReached || dataset.completeness !== 'complete'),
    categories: mergeDistribution(datasets, 'categories'),
    programs: mergeDistribution(datasets, 'programs'),
    updatedAt: datasets.map(item => item.updatedAt).filter(Boolean).sort().at(-1) || '',
  };
}

function formatNumber(value, maximumFractionDigits = 0) {
  const number = Number(value);
  if (!Number.isFinite(number)) return String(value || '—');
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits }).format(number);
}

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value.length === 10 ? `${value}T12:00:00+05:00` : value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: 'long', year: 'numeric' }).format(date);
}

function recordCountLabel(dataset) {
  if (!dataset.rowCount) return 'Нет записей';
  return `${dataset.rowLimitReached ? 'не менее ' : ''}${formatNumber(dataset.rowCount)}`;
}

function canonical(pathname) {
  return `${SITE_URL}${pathname}`;
}

function breadcrumbSchema(items) {
  return {
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem', position: index + 1, name: item.name, item: canonical(item.path),
    })),
  };
}

function datasetSchema(dataset, breadcrumbs) {
  const variables = dataset.indicators.length
    ? dataset.indicators.map(item => item.title)
    : dataset.categories.slice(0, 20).map(item => item.label);
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebPage',
        '@id': `${canonical(dataset.path)}#webpage`,
        url: canonical(dataset.path),
        name: dataset.title,
        description: dataset.description,
        dateModified: dataset.updatedAt,
        isPartOf: { '@id': `${SITE_URL}/#website` },
        about: { '@id': `${canonical(dataset.path)}#dataset` },
      },
      {
        '@type': 'Dataset',
        '@id': `${canonical(dataset.path)}#dataset`,
        name: dataset.title,
        description: dataset.description,
        url: canonical(dataset.path),
        sameAs: dataset.datasetUrl,
        isAccessibleForFree: true,
        inLanguage: ['ru', 'kk'],
        datePublished: dataset.publishedAt,
        dateModified: dataset.updatedAt,
        creator: { '@type': 'GovernmentOrganization', name: dataset.agency },
        ...(dataset.apiUrl ? { distribution: [{
          '@type': 'DataDownload',
          contentUrl: dataset.apiUrl,
          encodingFormat: 'application/json',
        }] } : {}),
        ...(variables.length ? { variableMeasured: variables } : {}),
      },
      breadcrumbSchema(breadcrumbs),
    ],
  };
}

function pageSchema(name, description, pathname, breadcrumbs) {
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'CollectionPage',
        '@id': `${canonical(pathname)}#webpage`,
        url: canonical(pathname),
        name,
        description,
        isPartOf: { '@id': `${SITE_URL}/#website` },
      },
      breadcrumbSchema(breadcrumbs),
    ],
  };
}

function sitemapEntries() {
  const snapshot = loadSnapshot();
  const generated = String(snapshot.generatedAt || '').substring(0, 10);
  const base = [
    { path: '/otkrytye-dannye', lastmod: generated, priority: '0.86' },
    { path: '/otkrytye-dannye/gosudarstvennyy-sektor', lastmod: generated, priority: '0.88' },
    { path: '/zhilishchnye-spiski', lastmod: generated, priority: '0.9' },
    { path: '/zhilishchnye-spiski/ochered-na-zhile', lastmod: generated, priority: '0.86' },
    { path: '/zhilishchnye-spiski/poluchili-zhile', lastmod: generated, priority: '0.86' },
  ];
  const datasets = listDatasets().filter(dataset => dataset.hasData).map(dataset => ({
    path: dataset.path,
    lastmod: String(dataset.updatedAt || generated).substring(0, 10),
    priority: dataset.kind === 'audit' ? '0.78' : '0.8',
  }));
  return base.concat(datasets);
}

module.exports = {
  SITE_URL,
  canonical,
  datasetSchema,
  formatDate,
  formatNumber,
  getDataset,
  getDatasetByPath,
  getHousingDataset,
  housingGroup,
  listDatasets,
  loadSnapshot,
  pageSchema,
  recordCountLabel,
  sitemapEntries,
};
