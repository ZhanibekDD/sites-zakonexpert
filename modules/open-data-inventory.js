'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');
const slugify = require('slugify');

const ROOT = path.join(__dirname, '..');
const DEFAULT_INVENTORY_PATH = path.join(ROOT, 'data', 'open-data-inventory.json.br');
const DATA_EGOV_BASE = 'https://data.egov.kz';

let cachedInventory = null;
let cachedMtime = -1;
let cachedPath = '';

function clean(value) {
  return String(value === null || value === undefined ? '' : value).replace(/\s+/g, ' ').trim();
}

function safeSuffix(value, length = 18) {
  const compact = clean(value).replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase();
  return compact.slice(-length) || 'official';
}

function textSlug(value, fallback = 'nabor-dannyh', length = 82) {
  return slugify(clean(value), { lower: true, strict: true, locale: 'ru' }).slice(0, length) || fallback;
}

function stableId(value) {
  return crypto.createHash('sha1').update(clean(value)).digest('hex').slice(0, 8);
}

function datasetPath(dataset) {
  const slug = `${textSlug(dataset.title, 'nabor-dannyh', 78)}-${safeSuffix(dataset.index)}-${stableId(dataset.index)}`;
  return clean(dataset.category).toLocaleLowerCase('ru-RU') === 'государственный сектор'
    ? `/otkrytye-dannye/gosudarstvennyy-sektor/${slug}`
    : `/otkrytye-dannye/nabor/${slug}`;
}

function categorySlug(category) {
  return `${textSlug(category.name, 'kategoriya', 70)}-${safeSuffix(category.id || category.name, 10)}`;
}

function agencySlug(agency) {
  return `${textSlug(agency.name, 'organizaciya', 70)}-${safeSuffix(agency.id || agency.name, 10)}`;
}

function emptyInventory() {
  return { schemaVersion: 1, generatedAt: '', expectedCount: 0, processedCount: 0, datasets: [] };
}

function loadInventory(inventoryPath = DEFAULT_INVENTORY_PATH) {
  inventoryPath = path.resolve(inventoryPath);
  try {
    const stat = fs.statSync(inventoryPath);
    if (!cachedInventory || inventoryPath !== cachedPath || stat.mtimeMs !== cachedMtime) {
      const contents = fs.readFileSync(inventoryPath);
      const decoded = inventoryPath.endsWith('.br') ? zlib.brotliDecompressSync(contents) : contents;
      const parsed = JSON.parse(decoded.toString('utf8'));
      cachedInventory = parsed && Array.isArray(parsed.datasets) ? parsed : emptyInventory();
      cachedMtime = stat.mtimeMs;
      cachedPath = inventoryPath;
    }
  } catch (_) {
    cachedInventory = emptyInventory();
    cachedMtime = -1;
    cachedPath = inventoryPath;
  }
  return cachedInventory;
}

function inventoryDatasetDefinition(item) {
  const index = clean(item.index);
  const category = clean(item.category) || 'Без категории';
  const title = clean(item.title) || index || 'Набор открытых данных';
  return {
    key: `catalog-${index}`,
    kind: category.toLocaleLowerCase('ru-RU') === 'государственный сектор' ? 'government_sector' : 'catalog_dataset',
    path: datasetPath({ ...item, title, category }),
    index,
    version: clean(item.version),
    title,
    titleKk: clean(item.titleKk),
    titleEn: clean(item.titleEn),
    shortTitle: title,
    description: clean(item.description) || `Официальный набор открытых данных «${title}».`,
    descriptionKk: clean(item.descriptionKk),
    descriptionEn: clean(item.descriptionEn),
    category,
    categoryId: clean(item.categoryId),
    agency: clean(item.agency) || 'Организация не указана',
    agencyId: clean(item.agencyId),
    agencyType: clean(item.agencyType),
    agencyIsGovernment: Boolean(item.agencyIsGovernment),
    keywords: Array.isArray(item.keywords) ? item.keywords.map(clean).filter(Boolean) : [],
    status: clean(item.status) || 'published',
    actual: item.actual !== false,
    terminalStatus: clean(item.terminalStatus) || 'live-api-version-resolved-on-demand',
    updateFrequency: clean(item.updateFrequency),
    publishedAt: clean(item.publishedAt),
    updatedAt: clean(item.updatedAt),
    portalViews: Number(item.portalViews) || 0,
    portalDownloads: Number(item.portalDownloads) || 0,
    datasetUrl: `${DATA_EGOV_BASE}/datasets/view?index=${encodeURIComponent(index)}`,
    apiUrl: item.version ? `${DATA_EGOV_BASE}/api/v4/${encodeURIComponent(index)}/${encodeURIComponent(item.version)}` : '',
    metaUrl: item.version ? `${DATA_EGOV_BASE}/meta/${encodeURIComponent(index)}/${encodeURIComponent(item.version)}` : '',
    liveAvailable: Boolean(index),
  };
}

function inventoryDefinitions() {
  return loadInventory().datasets.map(inventoryDatasetDefinition);
}

function groupSummaries(items, type) {
  const idField = type === 'category' ? 'categoryId' : 'agencyId';
  const nameField = type === 'category' ? 'category' : 'agency';
  const groups = new Map();
  items.forEach(dataset => {
    const id = clean(dataset[idField]) || clean(dataset[nameField]);
    const name = clean(dataset[nameField]) || (type === 'category' ? 'Без категории' : 'Организация не указана');
    const key = `${id}\u0000${name}`;
    if (!groups.has(key)) groups.set(key, { id, name, count: 0, datasets: [] });
    const group = groups.get(key);
    group.count += 1;
    group.datasets.push(dataset);
  });
  return Array.from(groups.values()).map(group => ({
    ...group,
    slug: type === 'category' ? categorySlug(group) : agencySlug(group),
  })).sort((left, right) => right.count - left.count || left.name.localeCompare(right.name, 'ru'));
}

function categorySummaries(items = inventoryDefinitions()) {
  return groupSummaries(items, 'category');
}

function agencySummaries(items = inventoryDefinitions()) {
  return groupSummaries(items, 'agency');
}

module.exports = {
  DEFAULT_INVENTORY_PATH,
  agencySlug,
  agencySummaries,
  categorySlug,
  categorySummaries,
  datasetPath,
  inventoryDatasetDefinition,
  inventoryDefinitions,
  loadInventory,
  stableId,
};
