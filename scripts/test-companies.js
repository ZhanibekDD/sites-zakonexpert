'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const ejs = require('ejs');
const { DatabaseSync } = require('node:sqlite');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zakonexpert-companies-'));
const dbPath = path.join(tempDir, 'companies.sqlite');
process.env.COMPANIES_DB_PATH = dbPath;

const { createSchema, rebuildSearch } = require('../modules/companies-schema');
const { insertRows, normalizeCompanyRow } = require('./import-companies-egov');

const sample = {
  id: 7137221,
  registerdate: '1997-05-26',
  nameru: 'Товарищество с ограниченной ответственностью "Альфа Право"',
  namekz: '"Альфа Құқық" жауапкершілігі шектеулі серіктестігі',
  bin: '970540001234',
  fio: 'ИВАНОВ ИВАН ИВАНОВИЧ',
  addressru: 'г. Алматы, ул. Абая, 10',
  okedru: 'Юридическая деятельность',
  statusru: 'Зарегистрирован',
};

const normalized = normalizeCompanyRow(sample);
assert(normalized, 'row must normalize');
assert.strictEqual(normalized.id, 7137221);
assert.strictEqual(normalized.bin, '970540001234');
assert(normalized.slug.startsWith('7137221-'));

const database = new DatabaseSync(dbPath);
createSchema(database);
assert.strictEqual(insertRows(database, [sample], '2026-07-16T00:00:00.000Z'), 1);
database.prepare('INSERT INTO company_meta(key, value) VALUES(?, ?)').run('source_updated_at', '2026-07-16');
database.prepare('INSERT INTO company_meta(key, value) VALUES(?, ?)').run('source_url', 'https://data.egov.kz/datasets/view?index=gbd_ul');
database.prepare('INSERT INTO company_meta(key, value) VALUES(?, ?)').run('completed_at', '2026-07-16');
rebuildSearch(database);
database.close();

const companies = require('../modules/companies-db');
assert.strictEqual(companies.stats().count, 1);
assert.strictEqual(companies.findById(7137221).bin, '970540001234');
assert.strictEqual(companies.search('Альфа').items.length, 1);
assert.strictEqual(companies.search('970540001234').items.length, 1);
assert.strictEqual(companies.sitemapChunkCount(), 1);
assert.strictEqual(companies.sitemapChunk(1).length, 1);

const company = companies.findById(7137221);
const catalogData = {
  query: 'Альфа',
  results: companies.search('Альфа'),
  stats: companies.stats(),
};

Promise.all([
  ejs.renderFile(path.join(__dirname, '..', 'views', 'companies', 'catalog.ejs'), catalogData),
  ejs.renderFile(path.join(__dirname, '..', 'views', 'companies', 'item.ejs'), {
    company,
    sourceUpdatedAt: '2026-07-16',
  }),
]).then(([catalogHtml, itemHtml]) => {
  assert(catalogHtml.includes('Альфа Право'));
  assert(catalogHtml.includes('noindex'));
  assert(itemHtml.includes('БИН 970540001234'));
  assert(itemHtml.includes('application/ld+json'));
  console.log('Company data OK: normalization, SQLite search, templates and sitemap chunks');
}).finally(() => {
  companies.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
}).catch(error => {
  console.error(error);
  process.exitCode = 1;
});
