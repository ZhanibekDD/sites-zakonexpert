'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SELF = path.relative(ROOT, __filename).replace(/\\/g, '/');
const WORKFLOW = '.github/workflows/apply-production-header-cleanup-20260906.yml';
const ROOTS = ['public', 'views', 'modules', 'app', 'scripts', 'docs'];
const SKIP_DIRS = new Set(['.git', 'node_modules', 'data', 'backups', 'logs', 'coverage', 'dist', 'tmp']);
const TEXT_EXTENSIONS = new Set(['.css', '.ejs', '.html', '.js', '.json', '.md', '.svg', '.txt', '.xml', '.yml', '.yaml']);

const OLD_RAW = '77003097566';
const NEW_RAW = '77058762795';
const NEW_DISPLAY = '+7 (705) 876-27-95';

function walk(dir, files = []) {
  if (!fs.existsSync(dir)) return files;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory() && SKIP_DIRS.has(entry.name)) continue;
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(absolute, files);
    else if (entry.isFile() && TEXT_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) files.push(absolute);
  }
  return files;
}

function removeMarketingLinks(source) {
  let out = source;

  // Remove simple list items/anchors for the two company specialist profiles.
  out = out.replace(/\s*<li(?:\s[^>]*)?>\s*<a\b[^>]*href=["']\/(?:advocate|mediator)(?:[?#][^"']*)?["'][^>]*>[\s\S]*?<\/a>\s*<\/li>/gi, '');
  out = out.replace(/\s*<a\b[^>]*href=["']\/(?:advocate|mediator)(?:[?#][^"']*)?["'][^>]*>[\s\S]*?<\/a>/gi, '');

  // Remove the visible "all open data" entry but keep the underlying datasets/routes intact.
  out = out.replace(/\s*<li(?:\s[^>]*)?>\s*<a\b[^>]*href=["']\/otkrytye-dannye(?:[?#][^"']*)?["'][^>]*>[\s\S]*?Все открытые данные[\s\S]*?<\/a>\s*<\/li>/gi, '');
  out = out.replace(/\s*<a\b[^>]*href=["']\/otkrytye-dannye(?:[?#][^"']*)?["'][^>]*>[\s\S]*?Все открытые данные[\s\S]*?<\/a>/gi, '');

  // Remove specialist profile paths from simple sitemap/navigation arrays.
  out = out.replace(/^\s*['"]\/(?:advocate|mediator)['"]\s*,?\s*$/gm, '');
  out = out.replace(/^\s*['"]\/(?:advocate|mediator)['"]\s*:\s*['"][^'"]+['"]\s*,?\s*$/gm, '');

  // Remove person-specific credential from the company description.
  out = out.replace(/\s*Адвокат РК №24018569\.?/g, '');
  return out;
}

const files = ROOTS.flatMap(root => walk(path.join(ROOT, root)));
const changed = [];
let replacements = 0;

for (const absolute of files) {
  const relative = path.relative(ROOT, absolute).replace(/\\/g, '/');
  if (relative === SELF || relative === WORKFLOW) continue;

  const original = fs.readFileSync(absolute, 'utf8');
  let updated = original;

  const literalReplacements = [
    ['+7 (700) 309-75-66', NEW_DISPLAY],
    ['+7 700 309-75-66', '+7 705 876-27-95'],
    ['+7 700 309 75 66', '+7 705 876 27 95'],
    ['7 (700) 309-75-66', '7 (705) 876-27-95'],
    ['7 700 309-75-66', '7 705 876-27-95'],
    [OLD_RAW, NEW_RAW],
  ];
  for (const [from, to] of literalReplacements) {
    const parts = updated.split(from);
    if (parts.length > 1) {
      replacements += parts.length - 1;
      updated = parts.join(to);
    }
  }

  updated = removeMarketingLinks(updated);

  // Cache-bust assets changed by this migration, including test/release references.
  updated = updated.replace(/((?:^|\/)css\/landing\.css)\?v=[0-9A-Za-z._-]+/g, '$1?v=20260906-1');
  updated = updated.replace(/((?:^|\/)js\/site\.js)\?v=[0-9A-Za-z._-]+/g, '$1?v=20260906-1');
  updated = updated.replace(/((?:^|\/)js\/chatbot\.js)\?v=[0-9A-Za-z._-]+/g, '$1?v=20260906-1');

  // The white strip under the header is the shared global search shell.
  if (relative === 'public/css/landing.css') {
    updated = updated.replace(
      /(\.global-site-search\s*\{[\s\S]*?border-bottom:\s*)1px solid #dbe4f0;([\s\S]*?background:\s*)#f6f8fb;/,
      '$1 1px solid rgba(255,255,255,0.08);$2#0f2a4e;'
    );
  }

  if (updated !== original) {
    fs.writeFileSync(absolute, updated, 'utf8');
    changed.push(relative);
  }
}

// Remove the two company specialist profile pages themselves.
for (const relative of ['public/advocate.html', 'public/mediator.html']) {
  const absolute = path.join(ROOT, relative);
  if (fs.existsSync(absolute)) {
    fs.rmSync(absolute);
    changed.push(relative + ' [deleted]');
  }
}

// Strengthen the contact regression test: the former production number must never return.
const contactTest = path.join(ROOT, 'scripts', 'test-contact-number.js');
if (fs.existsSync(contactTest)) {
  let source = fs.readFileSync(contactTest, 'utf8');
  if (!source.includes('700[ ()-]*309[ ()-]*75[ ()-]*66')) {
    source = source.replace(
      /const RETIRED_NUMBER = \/(?:\(\?:\\\+\?7[\s\S]*?);\/g,
      match => match.replace(');/', '|700[ ()-]*309[ ()-]*75[ ()-]*66);/')
    );
  }
  fs.writeFileSync(contactTest, source, 'utf8');
}

// Verify the production-visible contract.
const checkFiles = ROOTS.flatMap(root => walk(path.join(ROOT, root)));
const stalePhone = [];
const staleUi = [];
let newPhoneOccurrences = 0;
for (const absolute of checkFiles) {
  const relative = path.relative(ROOT, absolute).replace(/\\/g, '/');
  if (relative === SELF || relative === WORKFLOW) continue;
  const source = fs.readFileSync(absolute, 'utf8');
  if (/77003097566|\+?7\s*\(?700\)?\s*309[-\s]*75[-\s]*66/.test(source)) stalePhone.push(relative);
  newPhoneOccurrences += (source.match(/77058762795/g) || []).length;
  if (/\.(?:html|ejs)$/i.test(relative)) {
    if (/href=["']\/(?:advocate|mediator)(?:[?#"'])/i.test(source)
      || /Все открытые данные\s*[—-]/i.test(source)
      || />\s*Наш адвокат\s*</i.test(source)
      || />\s*Медиатор\s*</i.test(source)) {
      staleUi.push(relative);
    }
  }
}

if (stalePhone.length) throw new Error('Old production phone remains in: ' + stalePhone.join(', '));
if (staleUi.length) throw new Error('Removed navigation/profile UI remains in: ' + staleUi.join(', '));
if (newPhoneOccurrences < 1) throw new Error('New company phone was not found after migration');

const landing = fs.readFileSync(path.join(ROOT, 'public', 'css', 'landing.css'), 'utf8');
if (!/\.global-site-search\s*\{[\s\S]*?background:\s*#0f2a4e;/.test(landing)) {
  throw new Error('Global search strip is not using the navy site background');
}
if (fs.existsSync(path.join(ROOT, 'public', 'advocate.html')) || fs.existsSync(path.join(ROOT, 'public', 'mediator.html'))) {
  throw new Error('Specialist profile pages still exist');
}

console.log(`PRODUCTION_CLEANUP_CHANGED_FILES=${new Set(changed).size}`);
console.log(`PHONE_REPLACEMENTS=${replacements}`);
console.log(`NEW_PHONE_OCCURRENCES=${newPhoneOccurrences}`);
for (const name of [...new Set(changed)].sort()) console.log(name);
