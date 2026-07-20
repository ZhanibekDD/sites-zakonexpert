'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');
const PUBLISHER = 'ca-pub-8638191147118359';
const SCRIPT_URL = 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=' + PUBLISHER;
const EXCLUDED = new Set(['404.html', 'privacy.html']);

const publicPages = fs.readdirSync(PUBLIC)
  .filter((name) => name.endsWith('.html'))
  .filter((name) => !EXCLUDED.has(name))
  .filter((name) => !/^(?:yandex_|google)[a-z0-9]+\.html$/i.test(name));
const templates = ['views/news/layout.ejs', 'views/laws/layout.ejs'];
const failures = [];

for (const relativePath of publicPages.map((name) => `public/${name}`).concat(templates)) {
  const source = fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
  const occurrences = source.split(SCRIPT_URL).length - 1;
  if (occurrences !== 1) failures.push(`${relativePath}: expected one AdSense script, found ${occurrences}`);
  if (source.indexOf(SCRIPT_URL) > source.indexOf('</head>')) failures.push(`${relativePath}: script is outside <head>`);
}

for (const name of EXCLUDED) {
  const source = fs.readFileSync(path.join(PUBLIC, name), 'utf8');
  if (source.includes(PUBLISHER)) failures.push(`public/${name}: AdSense must stay disabled`);
}

const adsTxt = fs.readFileSync(path.join(PUBLIC, 'ads.txt'), 'utf8').trim();
if (adsTxt !== 'google.com, pub-8638191147118359, DIRECT, f08c47fec0942fa0') {
  failures.push('public/ads.txt: publisher record is incorrect');
}

const server = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
for (const origin of ['pagead2.googlesyndication.com', 'googleads.g.doubleclick.net', 'tpc.googlesyndication.com']) {
  if (!server.includes(origin)) failures.push(`server.js: CSP is missing ${origin}`);
}

if (failures.length) throw new Error(failures.join('\n'));
console.log(`AdSense OK: ${publicPages.length} static pages, ${templates.length} dynamic layouts and ads.txt.`);
