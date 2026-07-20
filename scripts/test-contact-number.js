'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SEARCH_ROOTS = ['public', 'views', 'modules', 'docs'];
const TEXT_EXTENSIONS = new Set(['.css', '.ejs', '.html', '.js', '.json', '.md', '.svg', '.txt', '.xml']);
const EXPECTED_RAW = '77479957635';
const EXPECTED_DISPLAY = '+7 (747) 995-76-35';
const OLD_NUMBER = /(?:\+?7[ ()-]*)?(?:775[ ()-]*299[ ()-]*87[ ()-]*38|700[ ()-]*311[ ()-]*06[ ()-]*38)/g;

function listTextFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return listTextFiles(fullPath);
    return TEXT_EXTENSIONS.has(path.extname(entry.name).toLowerCase()) ? [fullPath] : [];
  });
}

const files = SEARCH_ROOTS.flatMap((directory) => listTextFiles(path.join(ROOT, directory)));
let rawCount = 0;
let displayCount = 0;
const staleFiles = [];

for (const file of files) {
  const source = fs.readFileSync(file, 'utf8');
  if (OLD_NUMBER.test(source)) staleFiles.push(path.relative(ROOT, file));
  OLD_NUMBER.lastIndex = 0;
  rawCount += source.split(EXPECTED_RAW).length - 1;
  displayCount += source.split(EXPECTED_DISPLAY).length - 1;
}

if (staleFiles.length) {
  throw new Error(`Old contact number remains in: ${staleFiles.join(', ')}`);
}
if (rawCount < 1 || displayCount < 1) {
  throw new Error('The current contact number is missing from public source files.');
}

console.log(`Contact number OK: ${rawCount} links/values and ${displayCount} formatted labels.`);
