'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');
const FORBIDDEN_GOOGLE_AD_MARKERS = [
  'ca-pub-8638191147118359',
  'pagead2.googlesyndication.com',
  'adsbygoogle',
  'googleads.g.doubleclick.net',
  'tpc.googlesyndication.com',
  'partner.googleadservices.com',
  'googletagservices.com',
  'adtrafficquality.google',
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
  const matches = FORBIDDEN_GOOGLE_AD_MARKERS.filter(marker => source.includes(marker));
  if (matches.length) failures.push(`${path.relative(ROOT, filename)}: ${matches.join(', ')}`);
}

const adsTxt = fs.readFileSync(path.join(PUBLIC, 'ads.txt'), 'utf8');
if (/google\.com\s*,\s*pub-/i.test(adsTxt)) {
  failures.push('public/ads.txt: Google advertising seller must stay disabled');
}

if (failures.length) throw new Error(failures.join('\n'));
console.log(`Google advertising disabled: ${runtimeFiles.length} runtime files and ads.txt checked.`);
