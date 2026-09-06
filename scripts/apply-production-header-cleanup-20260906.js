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

  // Company metadata must not advertise the retired individual advocate profile.
  updated = updated.replace(/\s*Адвокат РК №24018569\.?/g, '');

  // Retired specialist profile URLs must not be discoverable in the sitemap.
  if (relative === 'app/routes/sitemaps.js') {
    updated = updated.replace(/^\s*\{ url: '\/(?:advocate|mediator)'[^\n]*\n/gm, '');
  }

  // Cache-bust the shared assets changed by this release.
  updated = updated.replace(/((?:^|\/)css\/landing\.css)\?v=[0-9A-Za-z._-]+/g, '$1?v=20260906-1');
  updated = updated.replace(/((?:^|\/)js\/site\.js)\?v=[0-9A-Za-z._-]+/g, '$1?v=20260906-1');
  updated = updated.replace(/((?:^|\/)js\/chatbot\.js)\?v=[0-9A-Za-z._-]+/g, '$1?v=20260906-1');

  if (relative === 'public/css/landing.css') {
    // The white strip under the header is the shared global search shell.
    updated = updated.replace(
      /(\.global-site-search\s*\{[\s\S]*?border-bottom:\s*)1px solid #dbe4f0;([\s\S]*?background:\s*)#f6f8fb;/,
      '$1 1px solid rgba(255,255,255,0.08);$2#0f2a4e;'
    );

    // Hide retired navigation before JS runs, avoiding any flash of old entries.
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
    const anchor = '  onReady(function initializeSiteControls() {\n    initializeGlobalSearch();';
    const replacement =
      `  // ${NAV_CLEANUP_MARKER}\n` +
      `  function removeRetiredNavigationEntries() {\n` +
      `    var selectors = ['a[href^="/advocate"]', 'a[href^="/mediator"]', 'a[href^="/otkrytye-dannye"]'];\n` +
      `    document.querySelectorAll(selectors.join(',')).forEach(function(link) {\n` +
      `      var item = link.closest('li');\n` +
      `      if (item) item.remove(); else link.remove();\n` +
      `    });\n` +
      `  }\n\n` +
      `  onReady(function initializeSiteControls() {\n` +
      `    removeRetiredNavigationEntries();\n` +
      `    initializeGlobalSearch();`;
    if (!updated.includes(anchor)) throw new Error('site.js ready lifecycle anchor not found');
    updated = updated.replace(anchor, replacement);
  }

  if (relative === 'views/laws/article.ejs') {
    updated = updated.replace(
      /const waMessage = `Здравствуйте\. Вопрос по статье \$\{art\.num\} \$\{art\.codeName\}: \$\{art\.title\}\. Нужна консультация адвоката\.`;/,
      "const waMessage = `Здравствуйте. Вопрос по статье ${art.num} ${art.codeName}: ${art.title}. Нужен разбор нормы.`;"
    );
    updated = updated.replace('Консультация адвоката.`;', 'Разбор нормы.`;');
    updated = updated.replace(/\n  reviewedBy: \{[\s\S]*?\n  \},/, '');
    updated = updated.replace('aria-label="Консультация адвоката"', 'aria-label="Помощь ZakonExpert"');

    const cardStart = '        <div class="law-cta-card">';
    const cardEnd = '\n        <div class="law-nav-card">';
    const startIndex = updated.indexOf(cardStart);
    const endIndex = updated.indexOf(cardEnd, startIndex);
    if (startIndex === -1 || endIndex === -1) throw new Error('law article CTA anchors not found');
    const genericCard = `        <div class="law-cta-card">\n` +
      `          <div class="law-cta-title">Вопрос по статье ${'${esc(art.num)}'} ${'${esc(art.codeName)}'}?</div>\n` +
      `          <div class="law-cta-sub">${'${esc(codeConsult[art.code] || \'Получите разбор по применению этой нормы.\')}'}</div>\n` +
      `          <a href="https://wa.me/${NEW_RAW}?text=${'${encodeURIComponent(waMessage)}'}" class="law-cta-btn" target="_blank" rel="noopener"><i class="bi bi-whatsapp"></i> Написать в ZakonExpert</a>\n` +
      `          <a href="tel:+${NEW_RAW}" class="law-cta-btn law-cta-btn--phone"><i class="bi bi-telephone"></i> ${NEW_DISPLAY}</a>\n` +
      `        </div>`;
    updated = updated.slice(0, startIndex) + genericCard + updated.slice(endIndex);

    updated = updated.replace(
      /<div class="law-mobile-advocate"[\s\S]*?<\/div>`;/,
      `<div class="law-mobile-advocate" aria-label="Связаться с ZakonExpert">\n  <a href="https://wa.me/${NEW_RAW}?text=${'${encodeURIComponent(waMessage)}'}" target="_blank" rel="noopener"><i class="bi bi-whatsapp"></i> WhatsApp</a>\n  <a href="tel:+${NEW_RAW}"><i class="bi bi-telephone"></i> Позвонить</a>\n</div>` + ';'
    );
  }

  if (relative === 'views/news/detail.ejs') {
    // Keep advocate-category articles readable, but remove all live profile/CTA surfaces.
    updated = updated.replace(
      /\$\{isAdvokat\n\s*\? `<a href="\/advocate">Адвокат Маулен Ержанов<\/a>`\n\s*: `<a href="\/news">Новости<\/a>`\}/,
      '<a href="/news">Новости</a>'
    );
    updated = updated.replace('${isAdvokat ? `\n        <!-- ADVOAT CTA', '${false ? `\n        <!-- ADVOAT CTA');
    updated = updated.replace('${isAdvokat ? `\n        <div class="news-sidebar-widget" style="background:#0d1f3c', '${false ? `\n        <div class="news-sidebar-widget" style="background:#0d1f3c');
    updated = updated.replace('${isAdvokat ? `\n        <div class="news-sidebar-widget">\n          <h3>Нормативная база', '${false ? `\n        <div class="news-sidebar-widget">\n          <h3>Нормативная база');
    updated = updated.replace("${isAdvokat ? 'Направления работы' : 'Темы'}", "${false ? 'Направления работы' : 'Темы'}");
    updated = updated.replace('${isAdvokat ? `\n            <a href="/advocate#adv-practice">', '${false ? `\n            <a href="/advocate#adv-practice">');
  }

  // Intercept retired profile URLs BEFORE static middleware can serve the legacy files.
  if (relative === 'app/create-app.js' && !updated.includes('REMOVED_SPECIALIST_PROFILE_PATHS')) {
    updated = updated.replace(
      '  // Canonical redirects, private-data guard and static assets always run first.\n  installMiddleware(app, dependencies);',
      `  const REMOVED_SPECIALIST_PROFILE_PATHS = new Set(['/advocate', '/mediator']);\n` +
      `  app.use((req, res, next) => {\n` +
      `    if (req.method === 'GET' && REMOVED_SPECIALIST_PROFILE_PATHS.has(req.path)) {\n` +
      `      return res.status(410).type('text/plain; charset=utf-8').send('Страница удалена.');\n` +
      `    }\n` +
      `    return next();\n` +
      `  });\n\n` +
      `  // Canonical redirects, private-data guard and static assets always run first.\n` +
      `  installMiddleware(app, dependencies);`
    );
  }

  if (updated !== original) {
    fs.writeFileSync(absolute, updated, 'utf8');
    changed.push(relative);
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
if (!siteJs.includes(NAV_CLEANUP_MARKER) || !siteJs.includes('removeRetiredNavigationEntries();')) throw new Error('Retired navigation cleanup is not integrated into the shared ready lifecycle');

const appSource = fs.readFileSync(path.join(ROOT, 'app', 'create-app.js'), 'utf8');
const goneIndex = appSource.indexOf("new Set(['/advocate', '/mediator'])");
const staticIndex = appSource.indexOf('installMiddleware(app, dependencies);');
if (goneIndex === -1 || staticIndex === -1 || goneIndex > staticIndex) throw new Error('Removed profile URLs must be intercepted before static middleware');

const sitemapSource = fs.readFileSync(path.join(ROOT, 'app', 'routes', 'sitemaps.js'), 'utf8');
if (/\{ url: '\/(?:advocate|mediator)'/.test(sitemapSource)) throw new Error('Removed specialist profiles remain in sitemap');

const lawArticle = fs.readFileSync(path.join(ROOT, 'views', 'laws', 'article.ejs'), 'utf8');
if (/77777457577|\/advocate/.test(lawArticle)) throw new Error('Personal advocate CTA remains in law article template');
if (!lawArticle.includes(`tel:+${NEW_RAW}`)) throw new Error('Law article template does not use the company phone');

console.log(`PRODUCTION_CLEANUP_CHANGED_FILES=${new Set(changed).size}`);
console.log(`PHONE_REPLACEMENTS=${replacements}`);
console.log(`NEW_PHONE_OCCURRENCES=${newPhoneOccurrences}`);
for (const name of [...new Set(changed)].sort()) console.log(name);
