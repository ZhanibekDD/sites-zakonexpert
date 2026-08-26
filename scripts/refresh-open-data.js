'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });
const { refreshOpenDataSnapshot } = require('../modules/open-data-refresh');

function option(name) {
  const prefix = `--${name}=`;
  const arg = process.argv.slice(2).find(value => value.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : '';
}

async function run() {
  const inputDir = option('input-dir');
  const outputPath = option('output');
  const snapshot = await refreshOpenDataSnapshot({
    inputDir: inputDir || undefined,
    outputPath: outputPath || undefined,
  });
  const totalRows = Object.values(snapshot.datasets).reduce((sum, item) => sum + item.rowCount, 0);
  console.log(`[Open data] ${Object.keys(snapshot.datasets).length} наборов, ${totalRows} записей, digest ${snapshot.digest}`);
  console.log('[Open data] В снимок сохранены только агрегаты; ФИО и другие персональные записи не записываются.');
}

if (require.main === module) {
  run().catch(error => {
    console.error(`[Open data] Обновление не выполнено: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { run };
