'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SELF = path.relative(ROOT, __filename).replace(/\\/g, '/');
const WORKFLOW = '.github/workflows/migrate-company-phone-20260906.yml';
const SKIP_DIRS = new Set(['.git', 'node_modules', 'data', 'backups', 'logs', 'coverage', 'dist', 'tmp']);
const TEXT_EXTENSIONS = new Set([
  '.css', '.ejs', '.html', '.js', '.json', '.md', '.svg', '.txt', '.xml', '.yml', '.yaml',
]);

const replacements = [
  ['+7 (700) 309-75-66', '+7 (705) 876-27-95'],
  ['+7 700 309-75-66', '+7 705 876-27-95'],
  ['+7 700 309 75 66', '+7 705 876 27 95'],
  ['7 (700) 309-75-66', '7 (705) 876-27-95'],
  ['7 700 309-75-66', '7 705 876-27-95'],
  ['77003097566', '77058762795'],
];

const oldPhonePattern = /77003097566|\+?7\s*\(?700\)?\s*309(?:[-\s]*)75(?:[-\s]*)66/g;
const newPhonePattern = /77058762795|\+?7\s*\(?705\)?\s*876(?:[-\s]*)27(?:[-\s]*)95/g;

function isTextFile(filename) {
  return TEXT_EXTENSIONS.has(path.extname(filename).toLowerCase());
}

function walk(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory() && SKIP_DIRS.has(entry.name)) continue;
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(absolute, files);
    } else if (entry.isFile() && isTextFile(entry.name)) {
      files.push(absolute);
    }
  }
  return files;
}

const files = walk(ROOT);
const changed = [];
let totalReplacements = 0;

for (const absolute of files) {
  const relative = path.relative(ROOT, absolute).replace(/\\/g, '/');
  if (relative === SELF || relative === WORKFLOW) continue;

  const original = fs.readFileSync(absolute, 'utf8');
  let updated = original;
  let fileReplacements = 0;

  for (const [from, to] of replacements) {
    const parts = updated.split(from);
    if (parts.length > 1) {
      fileReplacements += parts.length - 1;
      updated = parts.join(to);
    }
  }

  if (updated !== original) {
    fs.writeFileSync(absolute, updated, 'utf8');
    changed.push(relative);
    totalReplacements += fileReplacements;
  }
}

const stale = [];
let newOccurrences = 0;
for (const absolute of files) {
  const relative = path.relative(ROOT, absolute).replace(/\\/g, '/');
  if (relative === SELF || relative === WORKFLOW) continue;
  const source = fs.readFileSync(absolute, 'utf8');
  if (oldPhonePattern.test(source)) stale.push(relative);
  oldPhonePattern.lastIndex = 0;
  const matches = source.match(newPhonePattern);
  if (matches) newOccurrences += matches.length;
}

if (stale.length) {
  console.error('STALE_COMPANY_PHONE_FOUND');
  for (const filename of stale) console.error(filename);
  process.exit(1);
}
if (newOccurrences === 0) {
  console.error('NEW_COMPANY_PHONE_NOT_FOUND');
  process.exit(1);
}

console.log(`PHONE_MIGRATION_CHANGED_FILES=${changed.length}`);
console.log(`PHONE_MIGRATION_REPLACEMENTS=${totalReplacements}`);
console.log(`NEW_PHONE_OCCURRENCES=${newOccurrences}`);
for (const filename of changed) console.log(filename);
