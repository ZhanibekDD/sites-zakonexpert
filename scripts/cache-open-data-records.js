'use strict';

require('dotenv').config();

const openDataPages = require('../modules/open-data-pages');
const { warmOpenDataRecordCache } = require('../modules/open-data-cache-warmer');

function megabytes(bytes) {
  return `${Math.round(Number(bytes || 0) / 1024 / 1024)} MB`;
}

async function run() {
  const result = await warmOpenDataRecordCache({
    apiKey: process.env.EGOV_API_KEY,
    datasets: openDataPages.listDatasets(),
    onProgress: progress => {
      if (progress.processed % 100 === 0) {
        console.log(`${progress.phase}: ${progress.processed}/${progress.total}; cache ${megabytes(progress.bytes)}; errors ${progress.failures}`);
      }
    },
  });
  console.log(JSON.stringify({
    datasets: result.datasets,
    completed: result.completed,
    errors: result.failures.length,
    cacheSize: megabytes(result.bytes),
    cacheLimit: megabytes(result.allowedBytes),
    stoppedForSpace: result.stoppedForSpace,
  }, null, 2));
  if (result.failures.length) console.log('First errors:', result.failures.slice(0, 20));
}

if (require.main === module) {
  run().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = { run };
