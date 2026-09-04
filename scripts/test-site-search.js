'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ejs = require('ejs');
const {
  normalizeSearchQuery,
  searchItems,
  searchStaticPages,
} = require('../modules/site-search');

assert.strictEqual(normalizeSearchQuery('  банк   Казахстана  '), 'банк Казахстана');
assert.strictEqual(normalizeSearchQuery('x'.repeat(150)).length, 120);

const bankPages = searchStaticPages('банк');
assert.ok(bankPages.some(item => item.url === '/banks'), 'bank query must find the bank catalogue');
assert.ok(searchStaticPages('счёт').some(item => item.url === '/snyatie-aresta-so-scheta'),
  'search must normalize spelling while matching legal pages');
assert.deepStrictEqual(searchStaticPages('я'), [], 'one-character searches must not scan the full index');

const registryResults = searchItems([
  { name: 'ТОО Альфа', bin: '970540001234', address: 'Алматы', slug: 'alfa' },
  { name: 'ТОО Бета', bin: '010140000001', address: 'Астана', slug: 'beta' },
], '970540001234', {
  title: item => item.name,
  description: item => item.address,
  url: item => `/company/${item.slug}`,
  keywords: item => item.bin,
});
assert.deepStrictEqual(registryResults.map(item => item.url), ['/company/alfa']);

const root = path.join(__dirname, '..');
const siteSource = fs.readFileSync(path.join(root, 'public', 'js', 'site.js'), 'utf8');
assert.ok(siteSource.includes("searchRegion.dataset.globalSiteSearch = ''"),
  'shared JavaScript must insert exactly one global search region');
assert.ok(siteSource.includes("header.insertAdjacentElement('afterend', searchRegion)"),
  'global search must appear directly below the page header');

const exemptHtml = new Set([
  'arest-scheta-v-banke.html',
  'googlerGbK9GM3kA42xzTzGMQs4VZju46dDdZjQdmOigQjnKY.html',
  'yandex_decc99fa3bf371ce.html',
]);
for (const filename of fs.readdirSync(path.join(root, 'public')).filter(name => name.endsWith('.html'))) {
  if (exemptHtml.has(filename)) continue;
  const source = fs.readFileSync(path.join(root, 'public', filename), 'utf8');
  assert.ok(source.includes('/js/site.js') || source.includes('data-global-site-search'),
    `${filename} must expose the global site search`);
}

const serverSource = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
assert.ok(serverSource.includes("app.get('/poisk'"), 'global search results route is missing');
for (const source of ['companiesDb.search', 'notariesDb.search', 'bailiffsDb.search', 'lawsDb.search', 'newsDb.searchPublished']) {
  assert.ok(serverSource.includes(source), `global search must include ${source}`);
}

ejs.renderFile(path.join(root, 'views', 'search', 'global.ejs'), {
  query: '<script>alert(1)</script>',
  total: 1,
  groups: [{
    key: 'test',
    title: 'Результаты',
    icon: 'bi-search',
    items: [{ title: '<Тест>', description: 'Описание', url: '/company/test' }],
  }],
}).then(html => {
  assert.ok(html.includes('data-global-site-search'));
  assert.ok(html.includes('action="/poisk"'));
  assert.ok(html.includes('noindex,follow'));
  assert.ok(html.includes('&lt;Тест&gt;'));
  assert.ok(!html.includes('<script>alert(1)</script>'));
  console.log('Global site search OK: shared form, sources, ranking and safe results page');
}).catch(error => {
  console.error(error);
  process.exitCode = 1;
});
