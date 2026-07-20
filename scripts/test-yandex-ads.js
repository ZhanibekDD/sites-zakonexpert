'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');
const PAGE_ID = '19621793';
const CONTEXT_URL = 'https://yandex.ru/ads/system/context.js';
const LOADER_URL = 'https://yandex.ru/ads/system/ap-loader.js';
const EXCLUDED = new Set(['404.html', 'privacy.html']);

const publicPages = fs.readdirSync(PUBLIC)
  .filter((name) => name.endsWith('.html'))
  .filter((name) => !EXCLUDED.has(name))
  .filter((name) => !/^(?:yandex_|google)[a-z0-9]+\.html$/i.test(name));
const templates = ['views/news/layout.ejs', 'views/laws/layout.ejs'];
const failures = [];

for (const relativePath of publicPages.map((name) => `public/${name}`).concat(templates)) {
  const source = fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
  const contextCount = source.split(CONTEXT_URL).length - 1;
  const loaderCount = source.split(LOADER_URL).length - 1;
  const pageIdCount = source.split(`data-page-id="${PAGE_ID}"`).length - 1;
  if (contextCount !== 1 || loaderCount !== 1 || pageIdCount !== 1) {
    failures.push(`${relativePath}: context=${contextCount}, loader=${loaderCount}, page-id=${pageIdCount}`);
  }
  if (source.indexOf(LOADER_URL) > source.indexOf('</head>')) failures.push(`${relativePath}: loader is outside <head>`);
}

for (const name of EXCLUDED) {
  const source = fs.readFileSync(path.join(PUBLIC, name), 'utf8');
  if (source.includes(LOADER_URL)) failures.push(`public/${name}: Yandex ads must stay disabled`);
}

const server = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
for (const origin of ['https://yandex.ru', 'https://an.yandex.ru', 'https://yastatic.net']) {
  if (!server.includes(origin)) failures.push(`server.js: CSP is missing ${origin}`);
}

if (failures.length) throw new Error(failures.join('\n'));
console.log(`Yandex Autoplacement OK: ${publicPages.length} static pages and ${templates.length} dynamic layouts.`);
