'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { promisify } = require('util');

const brotliCompress = promisify(zlib.brotliCompress);
const brotliDecompress = promisify(zlib.brotliDecompress);

const ROOT = path.join(__dirname, '..');
const DEFAULT_CACHE_DIR = path.join(ROOT, 'data', 'open-data-record-cache');
const CACHE_SCHEMA_VERSION = 1;
const MATERIALIZED_PAGE_SIZE = 500;
const DEFAULT_RESPONSE_TTL_MS = 12 * 60 * 60 * 1000;
const activeRefreshes = new Map();

function clean(value) {
  return String(value === null || value === undefined ? '' : value).replace(/\s+/g, ' ').trim();
}

function safeInteger(value, fallback = 0) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function digest(value, length = 20) {
  return crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, length);
}

function datasetId(dataset) {
  const index = clean(dataset?.index || dataset?.key || 'dataset');
  const readable = index.replace(/[^a-z0-9_-]+/gi, '-').replace(/^-|-$/g, '').slice(0, 72) || 'dataset';
  return `${readable}-${digest(index, 12)}`;
}

function resolvedCacheDir(cacheDir) {
  return path.resolve(cacheDir || process.env.OPEN_DATA_RECORD_CACHE_DIR || DEFAULT_CACHE_DIR);
}

function inside(root, target) {
  const relative = path.relative(root, target);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Некорректный путь кэша открытых данных');
  return target;
}

function datasetDir(dataset, cacheDir) {
  const root = resolvedCacheDir(cacheDir);
  return inside(root, path.join(root, 'datasets', datasetId(dataset)));
}

function manifestPath(dataset, cacheDir) {
  return path.join(datasetDir(dataset, cacheDir), 'manifest.json');
}

function chunkPath(dataset, chunkIndex, cacheDir) {
  const filename = `${String(safeInteger(chunkIndex)).padStart(8, '0')}.json.br`;
  return path.join(datasetDir(dataset, cacheDir), 'chunks', filename);
}

function responsePath(dataset, cacheKey, cacheDir) {
  const root = resolvedCacheDir(cacheDir);
  return inside(root, path.join(root, 'responses', datasetId(dataset), `${digest(cacheKey, 32)}.json.br`));
}

async function atomicWrite(file, contents) {
  await fs.promises.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
  await fs.promises.writeFile(temporary, contents, { mode: 0o600 });
  await fs.promises.rename(temporary, file);
}

async function writeJson(file, payload) {
  await atomicWrite(file, `${JSON.stringify(payload)}\n`);
}

async function readJson(file) {
  try {
    return JSON.parse(await fs.promises.readFile(file, 'utf8'));
  } catch (_) {
    return null;
  }
}

async function writeCompressedJson(file, payload) {
  const compressed = await brotliCompress(Buffer.from(JSON.stringify(payload)), {
    params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 4 },
  });
  await atomicWrite(file, compressed);
  return compressed.length;
}

async function readCompressedJson(file) {
  try {
    const compressed = await fs.promises.readFile(file);
    return JSON.parse((await brotliDecompress(compressed)).toString('utf8'));
  } catch (_) {
    return null;
  }
}

async function readManifest(dataset, cacheDir) {
  const manifest = await readJson(manifestPath(dataset, cacheDir));
  if (!manifest || manifest.schemaVersion !== CACHE_SCHEMA_VERSION || manifest.index !== clean(dataset?.index)) return null;
  return manifest;
}

async function initializeMaterializedDataset(options = {}) {
  const dataset = options.dataset;
  if (!dataset?.index) throw new Error('Набор данных не указан');
  const directory = datasetDir(dataset, options.cacheDir);
  await fs.promises.rm(directory, { recursive: true, force: true });
  const manifest = {
    schemaVersion: CACHE_SCHEMA_VERSION,
    index: clean(dataset.index),
    key: clean(dataset.key),
    title: clean(dataset.title),
    version: clean(options.version || dataset.version),
    sourceUpdatedAt: clean(dataset.updatedAt),
    sourceUrl: clean(dataset.datasetUrl),
    pageSize: safeInteger(options.pageSize, MATERIALIZED_PAGE_SIZE) || MATERIALIZED_PAGE_SIZE,
    rowCount: 0,
    chunkCount: 0,
    complete: false,
    pagination: options.pagination === 'offset' ? 'offset' : 'search_after',
    cursor: null,
    cachedAt: new Date().toISOString(),
  };
  await writeJson(manifestPath(dataset, options.cacheDir), manifest);
  return manifest;
}

async function updateMaterializedManifest(options = {}) {
  const dataset = options.dataset;
  const manifest = { ...options.manifest, cachedAt: new Date().toISOString() };
  await writeJson(manifestPath(dataset, options.cacheDir), manifest);
  return manifest;
}

async function appendMaterializedChunk(options = {}) {
  const rows = Array.isArray(options.rows) ? options.rows : [];
  const manifest = options.manifest;
  if (!manifest || manifest.complete) throw new Error('Кэш набора не подготовлен для записи');
  const chunkIndex = safeInteger(manifest.chunkCount);
  let writtenBytes = 0;
  if (rows.length) writtenBytes = await writeCompressedJson(chunkPath(options.dataset, chunkIndex, options.cacheDir), rows);
  const updated = {
    ...manifest,
    rowCount: safeInteger(manifest.rowCount) + rows.length,
    chunkCount: chunkIndex + (rows.length ? 1 : 0),
    complete: options.complete === true,
    pagination: options.pagination || manifest.pagination,
    cursor: options.cursor === undefined ? manifest.cursor : options.cursor,
    lastBatchSize: rows.length,
  };
  await updateMaterializedManifest({ dataset: options.dataset, cacheDir: options.cacheDir, manifest: updated });
  return { manifest: updated, writtenBytes };
}

function normalizeSearch(value) {
  return clean(value).normalize('NFKC').toLocaleLowerCase('ru-RU');
}

function defaultMatcher(row, query) {
  const terms = normalizeSearch(query).split(' ').filter(Boolean);
  const haystack = normalizeSearch(Object.values(row || {}).join(' '));
  return terms.every(term => haystack.includes(term));
}

async function readChunk(dataset, index, cacheDir) {
  const rows = await readCompressedJson(chunkPath(dataset, index, cacheDir));
  return Array.isArray(rows) ? rows : null;
}

async function readMaterializedRecords(options = {}) {
  const dataset = options.dataset;
  const manifest = await readManifest(dataset, options.cacheDir);
  if (!manifest) return null;
  const offset = safeInteger(options.offset);
  const limit = Math.max(1, Math.min(100, safeInteger(options.limit, 50) || 50));
  const query = clean(options.query);

  if (query) {
    if (!manifest.complete) return null;
    const matcher = typeof options.matcher === 'function' ? options.matcher : defaultMatcher;
    const matches = [];
    let skipped = 0;
    for (let chunkIndex = 0; chunkIndex < manifest.chunkCount && matches.length <= limit; chunkIndex += 1) {
      const rows = await readChunk(dataset, chunkIndex, options.cacheDir);
      if (!rows) return null;
      for (const row of rows) {
        if (!matcher(row, query)) continue;
        if (skipped < offset) { skipped += 1; continue; }
        matches.push(row);
        if (matches.length > limit) break;
      }
    }
    return {
      rows: matches.slice(0, limit),
      offset,
      hasMore: matches.length > limit,
      complete: true,
      manifest,
      delivery: 'materialized-cache',
      cachedAt: manifest.cachedAt,
    };
  }

  if (!manifest.complete && offset >= manifest.rowCount) return null;
  if (manifest.complete && offset >= manifest.rowCount) {
    return { rows: [], offset, hasMore: false, complete: true, manifest, delivery: 'materialized-cache', cachedAt: manifest.cachedAt };
  }

  const firstChunk = Math.floor(offset / manifest.pageSize);
  const lastChunk = Math.floor((offset + limit - 1) / manifest.pageSize);
  const combined = [];
  for (let chunkIndex = firstChunk; chunkIndex <= lastChunk; chunkIndex += 1) {
    if (chunkIndex >= manifest.chunkCount) break;
    const rows = await readChunk(dataset, chunkIndex, options.cacheDir);
    if (!rows) return null;
    combined.push(...rows);
  }
  const localOffset = offset - firstChunk * manifest.pageSize;
  const rows = combined.slice(localOffset, localOffset + limit);
  if (!rows.length && !manifest.complete) return null;
  return {
    rows,
    offset,
    hasMore: manifest.complete
      ? offset + rows.length < manifest.rowCount
      : offset + rows.length < manifest.rowCount || rows.length === limit,
    complete: manifest.complete,
    manifest,
    delivery: 'materialized-cache',
    cachedAt: manifest.cachedAt,
  };
}

function decoratePayload(payload, delivery, cachedAt) {
  return { ...payload, delivery, cachedAt: cachedAt || new Date().toISOString() };
}

async function cacheResponse(options = {}) {
  const file = responsePath(options.dataset, options.cacheKey, options.cacheDir);
  const wrapper = await readCompressedJson(file);
  const ttlMs = Math.max(60_000, safeInteger(options.ttlMs, DEFAULT_RESPONSE_TTL_MS));
  const savedAt = wrapper?.savedAt ? Date.parse(wrapper.savedAt) : 0;
  const fresh = wrapper?.payload && savedAt && Date.now() - savedAt < ttlMs;
  if (fresh) return decoratePayload(wrapper.payload, 'response-cache', wrapper.savedAt);

  const refreshKey = file;
  const refresh = async () => {
    const payload = await options.fetcher();
    const saved = { schemaVersion: CACHE_SCHEMA_VERSION, savedAt: new Date().toISOString(), payload };
    await writeCompressedJson(file, saved);
    return decoratePayload(payload, 'official-api', saved.savedAt);
  };

  if (wrapper?.payload) {
    if (!activeRefreshes.has(refreshKey)) {
      const pending = refresh().catch(() => null).finally(() => activeRefreshes.delete(refreshKey));
      activeRefreshes.set(refreshKey, pending);
    }
    return decoratePayload(wrapper.payload, 'stale-cache', wrapper.savedAt);
  }

  if (!activeRefreshes.has(refreshKey)) {
    const pending = refresh().finally(() => activeRefreshes.delete(refreshKey));
    activeRefreshes.set(refreshKey, pending);
  }
  return activeRefreshes.get(refreshKey);
}

function directorySize(directory) {
  let bytes = 0;
  let files = 0;
  let manifests = 0;
  let completeDatasets = 0;
  let cachedRows = 0;
  if (!fs.existsSync(directory)) return { bytes, files, manifests, completeDatasets, cachedRows };
  const stack = [directory];
  while (stack.length) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const file = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(file);
      else {
        files += 1;
        try {
          bytes += fs.statSync(file).size;
          if (entry.name === 'manifest.json') {
            manifests += 1;
            const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
            if (manifest.complete) completeDatasets += 1;
            cachedRows += safeInteger(manifest.rowCount);
          }
        } catch (_) { /* A concurrent writer may replace a file while stats are collected. */ }
      }
    }
  }
  return { bytes, files, manifests, completeDatasets, cachedRows };
}

function materializedDatasetSize(dataset, cacheDir) {
  return directorySize(datasetDir(dataset, cacheDir)).bytes;
}

function cacheLimits(cacheDir) {
  const root = resolvedCacheDir(cacheDir);
  fs.mkdirSync(root, { recursive: true });
  const configuredMaxMb = Math.max(64, safeInteger(process.env.OPEN_DATA_RECORD_CACHE_MAX_MB, 700));
  const reserveMb = Math.max(128, safeInteger(process.env.OPEN_DATA_RECORD_CACHE_RESERVE_MB, 350));
  const existing = directorySize(root);
  let availableBytes = Number.MAX_SAFE_INTEGER;
  try {
    const stats = fs.statfsSync(root);
    availableBytes = Number(stats.bavail) * Number(stats.bsize || stats.frsize);
  } catch (_) { /* Configured ceiling remains the safety boundary. */ }
  const configuredBytes = configuredMaxMb * 1024 * 1024;
  const reserveBytes = reserveMb * 1024 * 1024;
  const diskSafeBytes = existing.bytes + Math.max(0, availableBytes - reserveBytes);
  return {
    root,
    existing,
    configuredBytes,
    reserveBytes,
    availableBytes,
    allowedBytes: Math.max(existing.bytes, Math.min(configuredBytes, diskSafeBytes)),
  };
}

module.exports = {
  CACHE_SCHEMA_VERSION,
  DEFAULT_CACHE_DIR,
  DEFAULT_RESPONSE_TTL_MS,
  MATERIALIZED_PAGE_SIZE,
  appendMaterializedChunk,
  cacheLimits,
  cacheResponse,
  datasetId,
  directorySize,
  initializeMaterializedDataset,
  materializedDatasetSize,
  normalizeSearch,
  readManifest,
  readMaterializedRecords,
  updateMaterializedManifest,
};
