#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const {
  createCatalogClient,
  discoverAllPublishedDatasets,
  fetchDatasetPassport,
} = require('../modules/open-data-catalog');
const { DEFAULT_INVENTORY_PATH } = require('../modules/open-data-inventory');

function atomicWriteJson(filename, value) {
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  const temporary = `${filename}.tmp-${process.pid}`;
  const serialized = Buffer.from(`${JSON.stringify(value)}\n`);
  const contents = filename.endsWith('.br')
    ? zlib.brotliCompressSync(serialized, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 9 } })
    : serialized;
  fs.writeFileSync(temporary, contents, { mode: 0o600 });
  fs.renameSync(temporary, filename);
}

async function syncOpenDataInventory(options = {}) {
  const outputPath = path.resolve(options.outputPath || DEFAULT_INVENTORY_PATH);
  const result = await discoverAllPublishedDatasets(options.http, {
    pageSize: options.pageSize || 100,
    onProgress: options.onProgress,
  });
  if (!result.expectedCount || result.datasets.length < result.expectedCount) {
    throw new Error(`Каталог неполон: ${result.datasets.length} из ${result.expectedCount}`);
  }
  const datasets = result.datasets.sort((left, right) => left.index.localeCompare(right.index));
  // Resolve versions for citizen-facing housing lists during the compact
  // catalog sync. This keeps cross-region FIO search fast without storing the
  // actual records or resolving thousands of unrelated versions in advance.
  if (options.enrichHousing !== false) {
    const housing = datasets.filter(dataset => /список граждан/i.test(dataset.title) && /жилищ|жиль/i.test(dataset.title));
    const client = await createCatalogClient(options.http);
    for (let offset = 0; offset < housing.length; offset += 6) {
      const chunk = housing.slice(offset, offset + 6);
      const settled = await Promise.allSettled(chunk.map(dataset => fetchDatasetPassport(client, dataset.index)));
      settled.forEach((entry, index) => {
        if (entry.status !== 'fulfilled' || !entry.value.version) return;
        Object.assign(chunk[index], {
          version: entry.value.version,
          terminalStatus: 'live-api-version-resolved',
        });
      });
      if (typeof options.onHousingProgress === 'function') options.onHousingProgress({ processed: Math.min(offset + chunk.length, housing.length), total: housing.length });
    }
  }
  const digest = crypto.createHash('sha256').update(JSON.stringify(datasets)).digest('hex').slice(0, 16);
  const inventory = {
    schemaVersion: 2,
    generatedAt: new Date().toISOString(),
    source: 'https://data.egov.kz',
    expectedCount: result.expectedCount,
    processedCount: datasets.length,
    terminalStatusCount: datasets.filter(dataset => dataset.terminalStatus).length,
    storageMode: 'compact-metadata-plus-live-api',
    digest,
    datasets,
  };
  atomicWriteJson(outputPath, inventory);
  return inventory;
}

if (require.main === module) {
  syncOpenDataInventory({
    onProgress(progress) {
      process.stdout.write(`\rКаталог data.egov.kz: ${progress.page}/${progress.totalPages}, ${progress.discovered} наборов`);
    },
    onHousingProgress(progress) {
      process.stdout.write(`\rВерсии жилищных списков: ${progress.processed}/${progress.total}`);
    },
  }).then(inventory => {
    process.stdout.write('\n');
    console.log(`Готово: ${inventory.processedCount}/${inventory.expectedCount}; digest ${inventory.digest}`);
  }).catch(error => {
    process.stdout.write('\n');
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = { syncOpenDataInventory };
