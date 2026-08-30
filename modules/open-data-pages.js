'use strict';

const fs = require('fs');
const path = require('path');
const { OPEN_DATA_DATASETS, OPEN_DATA_BY_KEY } = require('./open-data-config');
const { DEFAULT_OUTPUT } = require('./open-data-refresh');
const {
  agencySummaries: buildAgencySummaries,
  categorySummaries: buildCategorySummaries,
  inventoryDefinitions,
  loadInventory,
} = require('./open-data-inventory');

const SITE_URL = 'https://zakonexpert.kz';
const OFFICIAL_SOURCES_PATH = path.join(__dirname, '..', 'data', 'official-data-sources.json');
let snapshotCache = null;
let snapshotMtime = 0;

const HOUSING_REGIONS = [
  { slug: 'almaty', name: 'Алматы', prep: 'Алматы', pattern: /(?:г\.?|город(?:е|а)?)\s*Алматы/i },
  { slug: 'astana', name: 'Астана', prep: 'Астане', pattern: /(?:г\.?|город(?:е|а)?)\s*Астан/i },
  { slug: 'shymkent', name: 'Шымкент', prep: 'Шымкенте', pattern: /Шымкент/i },
  { slug: 'akmolinskaya-oblast', name: 'Акмолинская область', prep: 'Акмолинской области', pattern: /Акмолинск/i },
  { slug: 'aktyubinskaya-oblast', name: 'Актюбинская область', prep: 'Актюбинской области', pattern: /Актюбинск/i },
  { slug: 'almatinskaya-oblast', name: 'Алматинская область', prep: 'Алматинской области', pattern: /Алматинск/i },
  { slug: 'atyrauskaya-oblast', name: 'Атырауская область', prep: 'Атырауской области', pattern: /Атырау/i },
  { slug: 'zapadno-kazahstanskaya-oblast', name: 'Западно-Казахстанская область', prep: 'Западно-Казахстанской области', pattern: /Западно-Казахстан/i },
  { slug: 'karagandinskaya-oblast', name: 'Карагандинская область', prep: 'Карагандинской области', pattern: /Карагандин/i },
  { slug: 'kostanayskaya-oblast', name: 'Костанайская область', prep: 'Костанайской области', pattern: /Костанай/i },
  { slug: 'kyzylordinskaya-oblast', name: 'Кызылординская область', prep: 'Кызылординской области', pattern: /Кызылорд/i },
  { slug: 'mangistauskaya-oblast', name: 'Мангистауская область', prep: 'Мангистауской области', pattern: /Мангистау|Маңғыстау/i },
  { slug: 'pavlodarskaya-oblast', name: 'Павлодарская область', prep: 'Павлодарской области', pattern: /Павлодар/i },
  { slug: 'severo-kazahstanskaya-oblast', name: 'Северо-Казахстанская область', prep: 'Северо-Казахстанской области', pattern: /Северо-Казахстан/i },
  { slug: 'vostochno-kazahstanskaya-oblast', name: 'Восточно-Казахстанская область', prep: 'Восточно-Казахстанской области', pattern: /Восточно-Казахстан/i },
  { slug: 'turkestanskaya-oblast', name: 'Туркестанская область', prep: 'Туркестанской области', pattern: /Туркестан/i },
  { slug: 'zhambylskaya-oblast', name: 'Жамбылская область', prep: 'Жамбылской области', pattern: /Жамбыл/i },
  { slug: 'zhetysu', name: 'область Жетісу', prep: 'области Жетісу', pattern: /Жетісу|Жетысу/i },
  { slug: 'abay', name: 'область Абай', prep: 'области Абай', pattern: /облас(?:ть|ти|тя)\s+Абай|Абайск/i },
  { slug: 'ulytau', name: 'область Ұлытау', prep: 'области Ұлытау', pattern: /Ұлытау|Улытау/i },
];

function housingProfile(dataset) {
  const title = String(dataset.title || '');
  if (!/список граждан/i.test(title) || !/жилищ|жиль/i.test(title)) return null;
  const region = HOUSING_REGIONS.find(item => item.pattern.test(title));
  if (!region) return null;
  const kind = /нуждающ|состоящ|очеред/i.test(title) ? 'housing_waitlist' : /получивш|предоставл/i.test(title) ? 'housing_received' : '';
  return kind ? { kind, region } : null;
}

function selectedHousingDefinitions(items) {
  const groups = new Map();
  items.forEach(dataset => {
    const profile = housingProfile(dataset);
    if (!profile) return;
    const key = `${profile.kind}|${profile.region.slug}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ dataset, profile });
  });
  return Array.from(groups.values()).map(candidates => {
    candidates.sort((left, right) => (
      Number(right.dataset.actual) - Number(left.dataset.actual)
      || String(right.dataset.updatedAt || '').localeCompare(String(left.dataset.updatedAt || ''))
    ));
    const { dataset, profile } = candidates[0];
    const groupPath = profile.kind === 'housing_waitlist' ? 'ochered-na-zhile' : 'poluchili-zhile';
    return {
      ...dataset,
      kind: profile.kind,
      path: `/zhilishchnye-spiski/${groupPath}/${profile.region.slug}`,
      regionSlug: profile.region.slug,
      regionName: profile.region.name,
      regionPrepositional: profile.region.prep,
    };
  });
}

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

function officialDataSources() {
  try {
    const parsed = JSON.parse(fs.readFileSync(OFFICIAL_SOURCES_PATH, 'utf8'));
    return {
      reviewedAt: String(parsed.reviewedAt || ''),
      sources: Array.isArray(parsed.sources) ? parsed.sources : [],
    };
  } catch (_) {
    return { reviewedAt: '', sources: [] };
  }
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
  const configuredByIndex = new Map(OPEN_DATA_DATASETS.map(dataset => [dataset.index, dataset]));
  const rawInventory = inventoryDefinitions();
  const selectedHousing = selectedHousingDefinitions(rawInventory);
  const selectedHousingByIndex = new Map(selectedHousing.map(dataset => [dataset.index, dataset]));
  const selectedHousingGroups = new Set(selectedHousing.map(dataset => `${dataset.kind}|${dataset.regionSlug}`));
  const inventory = rawInventory.map(item => {
    if (selectedHousingByIndex.has(item.index)) return selectedHousingByIndex.get(item.index);
    const configured = configuredByIndex.get(item.index);
    if (!configured) return item;
    const configuredGroup = configured.regionSlug ? `${configured.kind}|${configured.regionSlug}` : '';
    if (configuredGroup && selectedHousingGroups.has(configuredGroup)) return item;
    return {
      ...configured,
      ...item,
      key: configured.key,
      kind: configured.kind,
      path: configured.path,
      version: configured.version || item.version,
      regionSlug: configured.regionSlug,
      regionName: configured.regionName,
      regionPrepositional: configured.regionPrepositional,
    };
  });
  const inventoryIndexes = new Set(inventory.map(dataset => dataset.index));
  const dynamic = Object.values(loadSnapshot().datasets || {})
    .filter(dataset => dataset && dataset.key && dataset.path && !configuredKeys.has(dataset.key));
  return inventory
    .concat(OPEN_DATA_DATASETS.filter(dataset => !inventoryIndexes.has(dataset.index) && !selectedHousingGroups.has(`${dataset.kind}|${dataset.regionSlug}`)))
    .concat(dynamic.filter(dataset => !inventoryIndexes.has(dataset.index)));
}

function listDatasets(kind) {
  return datasetDefinitions().filter(dataset => !kind || dataset.kind === kind).map(withSnapshot);
}

function getDataset(key) {
  // Prefer the inventory-enriched definition. Curated definitions keep the
  // readable URL and title, while the inventory adds live API availability.
  // Falling back to OPEN_DATA_BY_KEY preserves manually configured datasets
  // that have not appeared in the latest inventory yet.
  const dataset = datasetDefinitions().find(item => item.key === key) || OPEN_DATA_BY_KEY.get(key);
  return dataset ? withSnapshot(dataset) : null;
}

function getDatasetByPath(requestPath) {
  const dataset = datasetDefinitions().find(item => item.path === requestPath);
  return dataset ? withSnapshot(dataset) : null;
}

function getHousingDataset(kind, regionSlug) {
  const dataset = datasetDefinitions().find(item => item.kind === kind && item.regionSlug === regionSlug);
  return dataset ? withSnapshot(dataset) : null;
}

function categorySummaries() {
  return buildCategorySummaries(listDatasets());
}

function agencySummaries() {
  return buildAgencySummaries(listDatasets());
}

function findCategory(slug) {
  return categorySummaries().find(category => category.slug === slug) || null;
}

function findAgency(slug) {
  return agencySummaries().find(agency => agency.slug === slug) || null;
}

function paginatedDatasets(options = {}) {
  const query = String(options.query || '').replace(/\s+/g, ' ').trim().toLocaleLowerCase('ru-RU');
  let datasets = listDatasets();
  if (options.categoryId) datasets = datasets.filter(dataset => String(dataset.categoryId || dataset.category) === String(options.categoryId));
  if (options.agencyId) datasets = datasets.filter(dataset => String(dataset.agencyId || dataset.agency) === String(options.agencyId));
  if (query) {
    datasets = datasets.filter(dataset => [dataset.title, dataset.description, dataset.agency, dataset.category, ...(dataset.keywords || [])]
      .join(' ').toLocaleLowerCase('ru-RU').includes(query));
  }
  datasets.sort((left, right) => String(right.updatedAt || '').localeCompare(String(left.updatedAt || '')) || left.title.localeCompare(right.title, 'ru'));
  const pageSize = Math.min(100, Math.max(12, Number(options.pageSize) || 48));
  const total = datasets.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(totalPages, Math.max(1, Number(options.page) || 1));
  return { datasets: datasets.slice((page - 1) * pageSize, page * pageSize), total, page, pageSize, totalPages, query };
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
    partial: datasets.some(dataset => !dataset.liveAvailable && (dataset.rowLimitReached || dataset.completeness !== 'complete')),
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
  if (!dataset.rowCount) return dataset.liveAvailable ? 'Онлайн' : 'Нет записей';
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
  const generated = String(loadInventory().generatedAt || snapshot.generatedAt || '').substring(0, 10);
  const base = [
    { path: '/otkrytye-dannye', lastmod: generated, priority: '0.86' },
    { path: '/otkrytye-dannye/gosudarstvennyy-sektor', lastmod: generated, priority: '0.88' },
    { path: '/otkrytye-dannye/kategorii', lastmod: generated, priority: '0.82' },
    { path: '/otkrytye-dannye/organizacii', lastmod: generated, priority: '0.82' },
    { path: '/otkrytye-dannye/istochniki', lastmod: generated, priority: '0.76' },
    { path: '/zhilishchnye-spiski', lastmod: generated, priority: '0.9' },
    { path: '/zhilishchnye-spiski/ochered-na-zhile', lastmod: generated, priority: '0.86' },
    { path: '/zhilishchnye-spiski/poluchili-zhile', lastmod: generated, priority: '0.86' },
  ];
  const datasets = listDatasets().filter(dataset => dataset.liveAvailable || dataset.hasData).map(dataset => ({
    path: dataset.path,
    lastmod: String(dataset.updatedAt || generated).substring(0, 10),
    priority: dataset.kind === 'audit' ? '0.78' : '0.8',
  }));
  const categories = categorySummaries().map(category => ({
    path: `/otkrytye-dannye/kategoriya/${category.slug}`,
    lastmod: generated,
    priority: '0.72',
  }));
  const agencies = agencySummaries().map(agency => ({
    path: `/otkrytye-dannye/organizaciya/${agency.slug}`,
    lastmod: generated,
    priority: '0.66',
  }));
  return base.concat(categories, agencies, datasets);
}

module.exports = {
  SITE_URL,
  agencySummaries,
  canonical,
  categorySummaries,
  datasetSchema,
  findAgency,
  findCategory,
  formatDate,
  formatNumber,
  getDataset,
  getDatasetByPath,
  getHousingDataset,
  housingGroup,
  listDatasets,
  loadInventory,
  loadSnapshot,
  officialDataSources,
  paginatedDatasets,
  pageSchema,
  recordCountLabel,
  sitemapEntries,
};
