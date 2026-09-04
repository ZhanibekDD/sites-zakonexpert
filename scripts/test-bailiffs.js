'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ejs = require('ejs');
const { importBailiffs, parseCombinedField } = require('./import-bailiffs');
const { readRegistrySource } = require('../modules/registry-source');
const { getRegionEmblem } = require('../modules/region-emblems');
const {
  BAILIFF_REGIONS,
  getBailiffRegionBySlug,
  getBailiffRegionByName,
  withBailiffRegionPaths,
} = require('../modules/bailiff-regions');

async function main() {
  const source = readRegistrySource(path.join(__dirname, '..', 'registry', 'bailiffs.json.gz'), 'bailiffs');
  const rows = source.records;
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

  assert.strictEqual(BAILIFF_REGIONS.length, 20, 'all Kazakhstan bailiff regions need stable URLs');
  assert.strictEqual(new Set(BAILIFF_REGIONS.map(item => item.slug)).size, 20, 'region slugs must be unique');
  assert.strictEqual(new Set(BAILIFF_REGIONS.map(item => item.sourceName)).size, 20, 'source names must be unique');
  BAILIFF_REGIONS.forEach(region => {
    const emblem = getRegionEmblem(region.sourceName);
    assert.ok(emblem, `${region.sourceName} needs a regional emblem`);
    assert.ok(fs.existsSync(path.join(__dirname, '..', 'public', 'img', 'regions', `${emblem}.webp`)), `${region.sourceName} emblem is missing`);
  });
  assert.strictEqual(getBailiffRegionBySlug('astana').sourceName, 'город Астана');
  assert.strictEqual(getBailiffRegionByName('г. Астана').path, '/bailiffs/astana');
  assert.strictEqual(getBailiffRegionByName('область Жетісу').path, '/bailiffs/zhetisu');

  const allRegions = withBailiffRegionPaths(await bailiffsDb.getRegions());
  assert.ok(allRegions.every(item => item.path && !item.path.includes('?region=')), 'known regions need clean internal URLs');
  const lastUpdated = await bailiffsDb.getLastUpdated();
  const regionPage = getBailiffRegionBySlug('astana');
  const html = await ejs.renderFile(path.join(__dirname, '..', 'views', 'bailiff', 'catalog.ejs'), {
    selectedRegion: regionPage.sourceName,
    regionPage,
    allRegions,
    regionItems: astana,
    lastUpdated,
    getRegionEmblem,
  }, {
    root: path.join(__dirname, '..', 'views'),
    views: [path.join(__dirname, '..', 'views')],
  });
  assert.ok(html.includes('<title>ЧСИ Астаны: список, контакты и адреса | ZakonExpert</title>'));
  assert.ok(html.includes('<link rel="canonical" href="https://zakonexpertt.kz/bailiffs/astana">'));
  assert.ok(html.includes('ЧСИ Астаны: список и контакты'));
  assert.ok(html.includes('/img/regions/astana.webp'));
  assert.ok(html.includes('Что проверить до оплаты'));
  assert.ok(html.includes('/kak-poluchit-postanovlenie-chsi'));
  assert.ok(html.includes('/bailiffs/almaty'));
  assert.ok(!html.includes('/bailiffs?region='), 'regional page must not link back to legacy query URLs');

  const serverSource = require('./lib/source-files').readServerSource();
  assert.ok(serverSource.includes("app.get('/bailiffs/:regionSlug'"), 'clean regional route is missing');
  assert.ok(serverSource.includes("res.redirect(301, regionPage ? regionPage.path : '/bailiffs')"), 'legacy region redirect is missing');
  assert.ok(!serverSource.includes('<loc>https://zakonexpertt.kz/bailiffs?region='), 'sitemap must not publish legacy query URLs');

  console.log(`Bailiff data OK: ${rows.length} records, ${astana.length} Astana records, 20 clean regional URLs`);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
