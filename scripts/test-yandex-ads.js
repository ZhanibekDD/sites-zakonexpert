'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');
const FORBIDDEN_YANDEX_AD_MARKERS = [
  'yandex.ru/ads/system',
  'an.yandex.ru',
  'yastatic.net',
  'data-page-id="19621793"',
];
const failures = [];

function collectFiles(directory) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...collectFiles(absolute));
    else if (/\.(?:html|ejs|js|css|svg|txt)$/i.test(entry.name)) files.push(absolute);
  }
  return files;
}

const runtimeFiles = collectFiles(PUBLIC).concat(collectFiles(path.join(ROOT, 'views')), require('./lib/source-files').listServerFiles());
for (const filename of runtimeFiles) {
  const source = fs.readFileSync(filename, 'utf8');
  const matches = FORBIDDEN_YANDEX_AD_MARKERS.filter(marker => source.includes(marker));
  if (matches.length) failures.push(`${path.relative(ROOT, filename)}: ${matches.join(', ')}`);
}

if (failures.length) throw new Error(failures.join('\n'));
console.log(`Yandex advertising disabled: ${runtimeFiles.length} runtime files checked; Metrika remains consent-only.`);
