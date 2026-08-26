'use strict';

const axios = require('axios');
const {
  MATERIALIZED_PAGE_SIZE,
  appendMaterializedChunk,
  cacheLimits,
  initializeMaterializedDataset,
  materializedDatasetSize,
  readManifest,
  updateMaterializedManifest,
} = require('./open-data-record-cache');
const { publicRow, resolveLiveDataset } = require('./open-data-records');

const activeJobs = new Map();

function clean(value) {
  return String(value === null || value === undefined ? '' : value).replace(/\s+/g, ' ').trim();
}

function unwrapRows(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.elements)) return payload.elements;
  return [];
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function datasetPriority(dataset) {
  const housing = dataset.kind === 'housing_received' || dataset.kind === 'housing_waitlist' ? 10_000_000 : 0;
  const configuredVersion = dataset.version ? 1_000_000 : 0;
  return housing + configuredVersion + (Number(dataset.portalViews) || 0);
}

async function requestBatch(options) {
  const source = { size: options.pageSize };
  if (options.manifest.pagination === 'search_after') {
    source.sort = [{ id: { order: 'asc' } }];
    if (options.manifest.cursor !== null && options.manifest.cursor !== undefined) source.search_after = [options.manifest.cursor];
  } else {
    source.from = options.manifest.rowCount;
  }
  const response = await options.http.get(options.dataset.apiUrl, {
    timeout: 45_000,
    params: { apiKey: options.apiKey, source: JSON.stringify(source) },
    headers: { Accept: 'application/json', 'User-Agent': 'ZakonExpert materialized open-data cache/1.0' },
  });
  return unwrapRows(response.data);
}

async function warmDataset(options = {}) {
  let manifest = await readManifest(options.dataset, options.cacheDir);
  const maxAgeHours = Math.max(24, Number(options.maxAgeHours || process.env.OPEN_DATA_RECORD_CACHE_MAX_AGE_HOURS) || 168);
  const manifestAge = manifest?.cachedAt ? Date.now() - Date.parse(manifest.cachedAt) : Number.MAX_SAFE_INTEGER;
  const metadataUnchanged = manifest && manifest.sourceUpdatedAt === clean(options.dataset.updatedAt);
  if (manifest?.complete && metadataUnchanged && manifestAge <= maxAgeHours * 60 * 60 * 1000) {
    return { dataset: options.dataset, manifest, writtenBytes: 0, chunks: 0, skipped: true };
  }
  if (options.shouldStop?.() && (!manifest || !manifest.complete)) {
    return { dataset: options.dataset, manifest, writtenBytes: 0, chunks: 0, skipped: true };
  }

  let dataset = await resolveLiveDataset(options.dataset, options.http || axios, options.apiKey);
  const cacheExpired = manifest?.complete && (!Date.parse(manifest.cachedAt) || Date.now() - Date.parse(manifest.cachedAt) > maxAgeHours * 60 * 60 * 1000);
  const sourceChanged = manifest && (
    manifest.version !== clean(dataset.version)
    || (clean(dataset.updatedAt) && manifest.sourceUpdatedAt !== clean(dataset.updatedAt))
    || cacheExpired
  );
  if (!manifest || sourceChanged) {
    if (manifest) options.onBytes?.(-materializedDatasetSize(dataset, options.cacheDir));
    manifest = await initializeMaterializedDataset({
      dataset,
      version: dataset.version,
      pageSize: options.pageSize,
      pagination: 'search_after',
      cacheDir: options.cacheDir,
    });
  }
  if (manifest.complete) return { dataset, manifest, writtenBytes: 0, chunks: 0, skipped: true };
  if (options.firstPageOnly && manifest.chunkCount > 0) return { dataset, manifest, writtenBytes: 0, chunks: 0, skipped: true };

  let writtenBytes = 0;
  let chunks = 0;
  const maximumChunks = options.firstPageOnly ? 1 : Number.MAX_SAFE_INTEGER;
  while (!manifest.complete && chunks < maximumChunks) {
    if (options.shouldStop?.()) break;
    let rawRows;
    try {
      rawRows = await requestBatch({ ...options, dataset, manifest });
    } catch (error) {
      if (manifest.rowCount === 0 && manifest.pagination === 'search_after') {
        manifest = await initializeMaterializedDataset({
          dataset,
          version: dataset.version,
          pageSize: options.pageSize,
          pagination: 'offset',
          cacheDir: options.cacheDir,
        });
        rawRows = await requestBatch({ ...options, dataset, manifest });
      } else {
        throw error;
      }
    }

    if (manifest.pagination === 'search_after' && rawRows.length === options.pageSize) {
      const nextCursor = rawRows.at(-1)?.id;
      if (nextCursor === undefined || nextCursor === null || String(nextCursor) === String(manifest.cursor)) {
        if (manifest.rowCount === 0) {
          manifest = await initializeMaterializedDataset({
            dataset,
            version: dataset.version,
            pageSize: options.pageSize,
            pagination: 'offset',
            cacheDir: options.cacheDir,
          });
          continue;
        }
        throw new Error('Источник не вернул стабильный курсор id');
      }
    }

    const rows = rawRows.map(publicRow);
    const complete = rawRows.length < options.pageSize;
    const cursor = manifest.pagination === 'search_after' && rawRows.length
      ? rawRows.at(-1)?.id ?? manifest.cursor
      : manifest.cursor;
    const saved = await appendMaterializedChunk({
      dataset,
      manifest,
      rows,
      complete,
      cursor,
      pagination: manifest.pagination,
      cacheDir: options.cacheDir,
    });
    manifest = saved.manifest;
    writtenBytes += saved.writtenBytes;
    chunks += 1;
    options.onBytes?.(saved.writtenBytes);
    if (!rawRows.length) break;
    if (options.delayMs) await sleep(options.delayMs);
  }
  return { dataset, manifest, writtenBytes, chunks, skipped: false };
}

async function workerPool(items, concurrency, handler) {
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      await handler(items[index], index);
    }
  });
  await Promise.all(workers);
}

async function runWarm(options = {}) {
  const apiKey = clean(options.apiKey || process.env.EGOV_API_KEY);
  if (!apiKey) throw new Error('EGOV_API_KEY не задан');
  const datasets = (Array.isArray(options.datasets) ? options.datasets : [])
    .filter(dataset => dataset?.index && dataset.liveAvailable !== false)
    .sort((left, right) => datasetPriority(right) - datasetPriority(left));
  const pageSize = Math.max(100, Math.min(500, Number(options.pageSize) || MATERIALIZED_PAGE_SIZE));
  const concurrency = Math.max(1, Math.min(5, Number(options.concurrency || process.env.OPEN_DATA_RECORD_CACHE_CONCURRENCY) || 2));
  const delayMs = Math.max(0, Math.min(5_000, Number(options.delayMs ?? process.env.OPEN_DATA_RECORD_CACHE_DELAY_MS) || 100));
  const limits = cacheLimits(options.cacheDir);
  let bytes = limits.existing.bytes;
  let stoppedForSpace = false;
  const failures = [];
  let processed = 0;
  const shouldStop = () => {
    const atLimit = bytes >= limits.allowedBytes;
    if (atLimit) stoppedForSpace = true;
    return atLimit;
  };
  const onBytes = count => { bytes += Number(count) || 0; shouldStop(); };
  const handle = phase => async dataset => {
    try {
      await warmDataset({
        dataset,
        apiKey,
        http: options.http || axios,
        cacheDir: options.cacheDir,
        pageSize,
        delayMs,
        firstPageOnly: phase === 'first-page',
        shouldStop,
        onBytes,
      });
    } catch (error) {
      failures.push({ index: dataset.index, message: clean(error.message).slice(0, 240) });
    } finally {
      processed += 1;
      if (processed % 25 === 0 || processed === datasets.length * 2) {
        options.onProgress?.({ phase, processed, total: datasets.length * 2, bytes, failures: failures.length });
      }
    }
  };

  // First make the initial table page instant for every dataset. Only then do
  // we spend the remaining disk budget materialising long datasets in full.
  await workerPool(datasets, concurrency, handle('first-page'));
  if (!shouldStop()) await workerPool(datasets, concurrency, handle('complete'));
  const finalStats = cacheLimits(options.cacheDir).existing;

  return {
    datasets: datasets.length,
    processed,
    completed: finalStats.completeDatasets,
    cachedRows: finalStats.cachedRows,
    failures,
    stoppedForSpace,
    bytes: finalStats.bytes,
    allowedBytes: limits.allowedBytes,
    reserveBytes: limits.reserveBytes,
  };
}

function warmOpenDataRecordCache(options = {}) {
  const jobKey = options.cacheDir || 'default';
  if (activeJobs.has(jobKey)) return activeJobs.get(jobKey);
  const job = runWarm(options).finally(() => activeJobs.delete(jobKey));
  activeJobs.set(jobKey, job);
  return job;
}

module.exports = {
  datasetPriority,
  runWarm,
  warmDataset,
  warmOpenDataRecordCache,
};
