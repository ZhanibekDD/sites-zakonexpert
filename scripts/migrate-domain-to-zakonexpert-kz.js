'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OLD_STEM = 'zakonexpertt';
const NEW_STEM = 'zakonexpert';
const APPLY = process.argv.includes('--apply');

const SKIP_DIRS = new Set([
  '.git',
  'node_modules',
  'data',
  'logs',
  'recon-out',
  'screenshots',
]);

const TEXT_EXTENSIONS = new Set([
  '', '.js', '.cjs', '.mjs', '.json', '.html', '.htm', '.ejs', '.md', '.txt',
  '.xml', '.css', '.scss', '.yml', '.yaml', '.csv', '.svg', '.webmanifest',
  '.example', '.conf', '.ini', '.toml', '.env', '.htaccess', '.mdc',
]);

function isTextCandidate(filePath) {
  const base = path.basename(filePath);
  if (base === '.htaccess' || base === '.env.example' || base === '.windsurfrules') return true;
  return TEXT_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory() && SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.isFile() && isTextCandidate(full)) out.push(full);
  }
  return out;
}

const changed = [];
const remaining = [];

for (const filePath of walk(ROOT)) {
  if (filePath === __filename) continue;
  let source;
  try {
    source = fs.readFileSync(filePath, 'utf8');
  } catch (_) {
    continue;
  }
  if (!source.includes(OLD_STEM)) continue;

  const relative = path.relative(ROOT, filePath).replace(/\\/g, '/');
  if (!APPLY) {
    remaining.push(relative);
    continue;
  }

  const next = source.split(OLD_STEM).join(NEW_STEM);
  fs.writeFileSync(filePath, next, 'utf8');
  changed.push(relative);
}

if (APPLY) {
  for (const filePath of walk(ROOT)) {
    if (filePath === __filename) continue;
    try {
      if (fs.readFileSync(filePath, 'utf8').includes(OLD_STEM)) {
        remaining.push(path.relative(ROOT, filePath).replace(/\\/g, '/'));
      }
    } catch (_) {}
  }
}

console.log(JSON.stringify({
  mode: APPLY ? 'apply' : 'check',
  from: OLD_STEM,
  to: NEW_STEM,
  changedCount: changed.length,
  changed,
  remainingCount: remaining.length,
  remaining,
}, null, 2));

if (remaining.length) process.exitCode = 2;
