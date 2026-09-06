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
const NAV_CLEANUP_MARKER = 'ZE_RETIRED_NAV_CLEANUP_20260906';
const NAV_CSS_MARKER = 'ZE_RETIRED_NAV_CSS_20260906';

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

  const compactMatches = updated.match(/\+?7\s*\(?700\)?\s*309[\s-]*75[\s-]*66/g) || [];
  replacements += compactMatches.length;
  updated = updated.replace(/\+?7\s*\(?700\)?\s*309[\s-]*75[\s-]*66/g, NEW_DISPLAY);

  // Remove the person-specific credential from company meta copy without touching HTML structure.
  updated = updated.replace(/\s*Адвокат РК №24018569\.?/g, '');

  // Retired specialist profiles must not remain in the sitemap.
  if (relative === 'app/routes/sitemaps.js') {
    updated = updated.replace(/^\s*\{ url: '\/(?:advocate|mediator)'[^\n]*\n/gm, '');
  }

  // Cache-bust the assets changed by this release; update guards/tests that reference them too.
  updated = updated.replace(/((?:^|\/)css\/landing\.css)\?v=[0-9A-Za-z._-]+/g, '$1?v=20260906-1');
  updated = updated.replace(/((?:^|\/)js\/site\.js)\?v=[0-9A-Za-z._-]+/g, '$1?v=20260906-1');
  updated = updated.replace(/((?:^|\/)js\/chatbot\.js)\?v=[0-9A-Za-z._-]+/g, '$1?v=20260906-1');

  if (relative === 'public/css/landing.css') {
    // Replace the white strip under the header with the site's navy background.
    updated = updated.replace(
      /(\.global-site-search\s*\{[\s\S]*?border-bottom:\s*)1px solid #dbe4f0;([\s\S]*?background:\s*)#f6f8fb;/,
      '$1 1px solid rgba(255,255,255,0.08);$2#0f2a4e;'
    );

    // Hide retired entries before JavaScript runs, so there is no visible flash.
    if (!updated.includes(NAV_CSS_MARKER)) {
      updated += `\n\n/* ${NAV_CSS_MARKER} */\n` +
        `a[href^="/advocate"],\n` +
        `a[href^="/mediator"],\n` +
        `a[href^="/otkrytye-dannye"] { display: none !important; }\n` +
        `li:has(> a[href^="/advocate"]),\n` +
        `li:has(> a[href^="/mediator"]),\n` +
        `li:has(> a[href^="/otkrytye-dannye"]) { display: none !important; }\n`;
    }
  }

  if (relative === 'public/js/site.js' && !updated.includes(NAV_CLEANUP_MARKER)) {
    updated += `\n\n// ${NAV_CLEANUP_MARKER}\n` +
      `(function removeRetiredZakonExpertNavigation() {\n` +
      `  'use strict';\n` +
      `  function cleanup() {\n` +
      `    var selectors = ['a[href^="/advocate"]', 'a[href^="/mediator"]', 'a[href^="/otkrytye-dannye"]'];\n` +
      `    document.querySelectorAll(selectors.join(',')).forEach(function(link) {\n` +
      `      var item = link.closest('li');\n` +
      `      if (item) item.remove(); else link.remove();\n` +
      `    });\n` +
      `  }\n` +
      `  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', cleanup, { once: true });\n` +
      `  else cleanup();\n` +
      `})();\n`;
  }

  // Keep the historical URLs technically registered but return 410 Gone before their old handlers.
  if (relative === 'app/create-app.js' && !updated.includes('REMOVED_SPECIALIST_PROFILE_PATHS')) {
    updated = updated.replace(
      '  installMiddleware(app, dependencies);',
      `  installMiddleware(app, dependencies);\n\n  const REMOVED_SPECIALIST_PROFILE_PATHS = new Set(['/advocate', '/mediator']);\n  app.use((req, res, next) => {\n    if (req.method === 'GET' && REMOVED_SPECIALIST_PROFILE_PATHS.has(req.path)) {\n      return res.status(410).type('text/plain; charset=utf-8').send('Страница удалена.');\n    }\n    return next();\n  });`
    );
  }

  if (updated !== original) {
    fs.writeFileSync(absolute, updated, 'utf8');
    changed.push(relative);
  }
}

// Delete the actual public profile documents. Their legacy URLs are handled by 410 middleware.
for (const relative of ['public/advocate.html', 'public/mediator.html']) {
  const absolute = path.join(ROOT, relative);
  if (fs.existsSync(absolute)) {
    fs.rmSync(absolute);
    changed.push(relative + ' [deleted]');
  }
}

const checkFiles = ROOTS.flatMap(root => walk(path.join(ROOT, root)));
const stalePhone = [];
let newPhoneOccurrences = 0;
for (const absolute of checkFiles) {
  const relative = path.relative(ROOT, absolute).replace(/\\/g, '/');
  if (relative === SELF || relative === WORKFLOW) continue;
  const source = fs.readFileSync(absolute, 'utf8');
  if (/77003097566|\+?7\s*\(?700\)?\s*309[\s-]*75[\s-]*66/.test(source)) stalePhone.push(relative);
  newPhoneOccurrences += (source.match(/77058762795/g) || []).length;
}

if (stalePhone.length) throw new Error('Old production phone remains in: ' + stalePhone.join(', '));
if (newPhoneOccurrences < 1) throw new Error('New company phone was not found after migration');

const landing = fs.readFileSync(path.join(ROOT, 'public', 'css', 'landing.css'), 'utf8');
if (!/\.global-site-search\s*\{[\s\S]*?background:\s*#0f2a4e;/.test(landing)) throw new Error('Global search strip is not using the navy site background');
if (!landing.includes(NAV_CSS_MARKER)) throw new Error('Retired navigation CSS guard is missing');

const siteJs = fs.readFileSync(path.join(ROOT, 'public', 'js', 'site.js'), 'utf8');
if (!siteJs.includes(NAV_CLEANUP_MARKER)) throw new Error('Retired navigation DOM cleanup is missing');

if (fs.existsSync(path.join(ROOT, 'public', 'advocate.html')) || fs.existsSync(path.join(ROOT, 'public', 'mediator.html'))) throw new Error('Specialist profile pages still exist');

const appSource = fs.readFileSync(path.join(ROOT, 'app', 'create-app.js'), 'utf8');
if (!appSource.includes("new Set(['/advocate', '/mediator'])")) throw new Error('Removed profile URLs are not protected by 410 middleware');

const sitemapSource = fs.readFileSync(path.join(ROOT, 'app', 'routes', 'sitemaps.js'), 'utf8');
if (/\{ url: '\/(?:advocate|mediator)'/.test(sitemapSource)) throw new Error('Removed specialist profiles remain in sitemap');

console.log(`PRODUCTION_CLEANUP_CHANGED_FILES=${new Set(changed).size}`);
console.log(`PHONE_REPLACEMENTS=${replacements}`);
console.log(`NEW_PHONE_OCCURRENCES=${newPhoneOccurrences}`);
for (const name of [...new Set(changed)].sort()) console.log(name);
