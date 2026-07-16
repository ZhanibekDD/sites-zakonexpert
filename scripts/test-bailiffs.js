'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { importBailiffs, parseCSV, parseCombinedField } = require('./import-bailiffs');

async function main() {
  const csv = fs.readFileSync(path.join(__dirname, '..', 'bailiffs_all_regions.csv'), 'utf8');
  const rows = parseCSV(csv).filter(row => /^\d+$/.test(String(row[1] || '').trim()));
  assert.strictEqual(rows.length, 2079, 'unexpected number of ChSI records in the fallback snapshot');

  const parsed = rows.map(row => parseCombinedField(row[3]));
  assert.ok(parsed.every(item => item.license), 'every ChSI record must contain a license number');
  assert.ok(parsed.every(item => item.licenseDate), 'every ChSI record must contain a license date');

  await importBailiffs();
  const bailiffsDb = require('../modules/bailiffs-db');
  const astana = await bailiffsDb.findByRegion('город Астана');
  assert.strictEqual(astana.length, 282, 'regional catalog must not be truncated to 200 records');
  assert.ok(astana.every(item => item.license && item.licenseDate), 'catalog projection must include license fields');
  assert.ok(astana.every(item => item.slug && item.name), 'catalog records must include identity fields');

  console.log(`Bailiff data OK: ${rows.length} records, ${astana.length} Astana records with licenses`);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
