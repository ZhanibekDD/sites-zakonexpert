'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

function filePath(relativePath) {
  return path.join(ROOT, relativePath);
}

function read(relativePath) {
  return fs.readFileSync(filePath(relativePath), 'utf8');
}

function write(relativePath, content) {
  const target = filePath(relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const current = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : null;
  if (current === content) return false;
  fs.writeFileSync(target, content, 'utf8');
  console.log('updated', relativePath);
  return true;
}

function replaceOnce(content, needle, replacement, label) {
  if (content.includes(replacement)) return content;
  const index = content.indexOf(needle);
  if (index === -1) throw new Error('Marker not found: ' + label);
  return content.slice(0, index) + replacement + content.slice(index + needle.length);
}

function replaceRegexOnce(content, expression, replacement, label) {
  if (!expression.test(content)) throw new Error('Pattern not found: ' + label);
  expression.lastIndex = 0;
  return content.replace(expression, replacement);
}

function addStylesheet(html) {
  const asset = '  <link rel="stylesheet" href="/css/bank-arrest-cluster.css?v=20260823-1">\n';
  if (html.includes('/css/bank-arrest-cluster.css')) return html;
  return replaceOnce(html, '</head>', asset + '</head>', 'cluster stylesheet');
}

function insertBeforeMainClose(html, block, label) {
  if (html.includes('data-bank-cluster-entry')) return html;
  return replaceOnce(html, '</main>', block + '\n</main>', label);
}

let server = read('server.js');

server = replaceOnce(
  server,
  "const { applyRegistryPrivacyOverride } = require('./modules/registry-privacy');",
  "const { applyRegistryPrivacyOverride } = require('./modules/registry-privacy');\nconst {\n  BANK_ARREST_HUB_PATH,\n  BANK_ARREST_PAGES,\n  BANK_ARREST_PATH_SET,\n  getBankArrestPageByPath,\n  findBankRecord,\n  getRelatedBankArrestPages,\n  getBankArrestPathForBank,\n} = require('./modules/bank-arrest-pages');\nconst {\n  LEGAL_INTENT_PAGES,\n  LEGAL_INTENT_PATH_SET,\n  getLegalIntentPage,\n} = require('./modules/legal-intent-pages');",
  'growth module imports'
);

server = replaceRegexOnce(
  server,
  /const RELEASE_ID = '[^']+';/,
  "const RELEASE_ID = '2026-08-23-bank-arrest-cluster-v1';",
  'release id'
);

server = server.replace(
  "shortName:'Halyk Bank', tag:'Государственный'",
  "shortName:'Halyk Bank', tag:''"
);

if (!server.includes("slug:'kzi-bank'")) {
  const marker = "  { slug:'citibank-kazakhstan'";
  const additions = "  { slug:'kzi-bank', name:'Казахстан-Зираат Интернешнл Банк', shortName:'KZI Bank', tag:'Иностранный', city:'г. Алматы', address:'ул. Наурызбай батыра, 17А', phone:'+7 (727) 244-19-93', phoneRaw:'+77272441993', phoneShort:'9193 · +7 (727) 244-40-00', email:'kzibank@kzibank.kz', web:'kzibank.kz', bin:'930140000323', chairman:'', note:'Дочерний банк Ziraat Bankası. Обслуживает физических и юридических лиц' },\n"
    + "  { slug:'bnk-commercial-bank', name:'Коммерческий Банк БиЭнКей', shortName:'BNK Commercial Bank', tag:'Иностранный', city:'г. Алматы', address:'ул. Ауэзова, 60', phone:'5210', phoneRaw:'', phoneShort:'Бесплатный звонок по Казахстану', email:'info@bnkcommercialbank.kz', web:'bnkcommercialbank.kz', bin:'180640000680', chairman:'Ким Сонгхён', note:'Банковская лицензия № 1.1.118 от 25.06.2025' },\n";
  server = replaceOnce(server, marker, additions + marker, 'KZI and BNK static bank records');
}

server = replaceOnce(
  server,
  "  if (notifyVisits && req.method === 'GET' && TRACKED_PATHS.has(req.path)) {",
  "  const growthTracked = req.path === BANK_ARREST_HUB_PATH\n    || BANK_ARREST_PATH_SET.has(req.path)\n    || LEGAL_INTENT_PATH_SET.has(req.path);\n  if (notifyVisits && req.method === 'GET' && (TRACKED_PATHS.has(req.path) || growthTracked)) {",
  'growth visitor tracking'
);

const oldBankRoute = `app.get('/banks/:slug', (req, res) => {
  const bank = getBanksData().find(b => b.slug === req.params.slug);
  if (!bank) return sendNotFound(res);
  res.render('banks/item', { bank, lowContentBoost });
});

`;
const newBankRoute = `app.get('/banks/:slug', (req, res) => {
  const bank = getBanksData().find(b => b.slug === req.params.slug);
  if (!bank) return sendNotFound(res);
  res.render('banks/item', {
    bank,
    lowContentBoost,
    bankArrestPath: getBankArrestPathForBank(bank),
  });
});

app.get(BANK_ARREST_HUB_PATH, (req, res) => {
  res.render('bank-arrest/hub', {
    pages: BANK_ARREST_PAGES,
    legalPages: LEGAL_INTENT_PAGES,
    reviewedAt: BANK_ARREST_PAGES[0]?.reviewedAt || '2026-08-23',
  });
});

BANK_ARREST_PAGES.filter(page => !page.legacyStatic).forEach(page => {
  app.get(page.path, (req, res) => {
    const bank = findBankRecord(page, getBanksData());
    res.render('bank-arrest/page', {
      page,
      bank,
      relatedPages: getRelatedBankArrestPages(page),
    });
  });
});

const RELATED_GROWTH_LABELS = Object.freeze({
  '/snyatie-aresta-so-scheta': 'Как снять арест со счёта или карты',
  '/snyatie-ogranichenii-chsi': 'Что делать с ограничениями ЧСИ',
  '/chsi-ne-snimaet-arest-posle-oplaty': 'ЧСИ не снимает арест после оплаты',
  '/arest-zarplatnoy-karty': 'Арест зарплатной карты',
});

LEGAL_INTENT_PAGES.forEach(page => {
  app.get(page.path, (req, res) => {
    const relatedPages = (page.related || []).map(relatedPath => {
      const configured = getLegalIntentPage(relatedPath);
      return configured || {
        path: relatedPath,
        h1: RELATED_GROWTH_LABELS[relatedPath] || 'Связанный правовой маршрут',
      };
    });
    res.render('legal-intent/page', { page, relatedPages });
  });
});

`;
server = replaceOnce(server, oldBankRoute, newBankRoute, 'bank and growth routes');

const coreGrowthBlock = `  const growthPages = [
    { url: BANK_ARREST_HUB_PATH, priority: '0.95', freq: 'weekly', lastmod: '2026-08-23' },
    ...BANK_ARREST_PAGES.map(page => ({ url: page.path, priority: page.priority >= 95 ? '0.9' : '0.82', freq: 'monthly', lastmod: page.reviewedAt })),
    ...LEGAL_INTENT_PAGES.map(page => ({ url: page.path, priority: page.priority >= 94 ? '0.9' : '0.85', freq: 'monthly', lastmod: page.reviewedAt })),
  ];
  growthPages.forEach(growthPage => {
    const existing = pages.find(page => page.url === growthPage.url);
    if (existing) Object.assign(existing, growthPage);
    else pages.push(growthPage);
  });
`;
if (!server.includes('const growthPages = [')) {
  server = replaceOnce(server, '  TOOLS.forEach(tool => {', coreGrowthBlock + '  TOOLS.forEach(tool => {', 'growth core sitemap pages');
}

const oldPagesSitemap = `app.get('/sitemap-pages.xml', (req, res) => {
  const pages = getCorePages();
  const today = new Date().toISOString().substring(0, 10);
  const urls = pages.map(p => \\`
  <url>
    <loc>https://zakonexpertt.kz\${p.url}</loc>
    <lastmod>\${today}</lastmod>
    <changefreq>\${p.freq}</changefreq>
    <priority>\${p.priority}</priority>
  </url>\\`).join('');

  res.set('Content-Type', 'application/xml');
  res.send(\\`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  \${urls}
</urlset>\\`);
});
`;
const newPagesSitemap = `function latestFileLastmod(relativePaths) {
  const timestamps = (Array.isArray(relativePaths) ? relativePaths : [relativePaths])
    .map(relativePath => {
      try { return fs.statSync(path.join(__dirname, relativePath)).mtime; }
      catch (_) { return null; }
    })
    .filter(Boolean)
    .sort((a, b) => b.getTime() - a.getTime());
  return timestamps.length ? timestamps[0].toISOString().substring(0, 10) : '';
}

function corePageLastmod(page) {
  if (page.lastmod) return String(page.lastmod).substring(0, 10);
  const cleanPath = String(page.url || '').split('?', 1)[0];
  if (!cleanPath || cleanPath === '/') return latestFileLastmod('public/index.html');
  const candidates = [
    'public' + cleanPath + '.html',
    'public' + cleanPath + '/index.html',
  ];
  return latestFileLastmod(candidates);
}

app.get('/sitemap-pages.xml', (req, res) => {
  const pages = getCorePages();
  const urls = pages.map(page => {
    const lastmod = corePageLastmod(page);
    return \\`
  <url>
    <loc>https://zakonexpertt.kz\${xmlEscape(page.url)}</loc>\${lastmod ? \\`\n    <lastmod>\${lastmod}</lastmod>\\` : ''}
    <changefreq>\${page.freq}</changefreq>
    <priority>\${page.priority}</priority>
  </url>\\`;
  }).join('');

  res.set('Content-Type', 'application/xml');
  res.send(\\`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  \${urls}
</urlset>\\`);
});
`;
server = replaceOnce(server, oldPagesSitemap, newPagesSitemap, 'accurate core sitemap lastmod');

const oldCsvSitemap = `function csvSitemap(res, items, prefix) {
  const today = new Date().toISOString().substring(0, 10);
  const urls = items.filter(i => i.slug).map(i => \\`
  <url>
    <loc>https://zakonexpertt.kz/\${prefix}/\${i.slug}</loc>
    <lastmod>\${today}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.6</priority>
  </url>\\`).join('');
  res.set('Content-Type', 'application/xml');
  res.send(\\`<?xml version="1.0" encoding="UTF-8"?>\\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\${urls}\\n</urlset>\\`);
}

app.get('/sitemap-banks.xml',      (req, res) => csvSitemap(res, getBanksData(),      'banks'));
app.get('/sitemap-courts.xml',     (req, res) => csvSitemap(res, getCourtsData(),     'courts'));
app.get('/sitemap-chambers.xml',   (req, res) => csvSitemap(res, getChambersData(),   'chambers'));
app.get('/sitemap-collectors.xml', (req, res) => csvSitemap(res, getCollectors(),     'collectors'));
app.get('/sitemap-gsi.xml',        (req, res) => csvSitemap(res, getGsiData(),        'gsi'));
app.get('/sitemap-insurance.xml',  (req, res) => csvSitemap(res, getInsuranceData(),  'insurance'));
app.get('/sitemap-mfo.xml', (req, res) => {
  const { mfo } = getMfoData();
  csvSitemap(res, mfo, 'mfo');
});
app.get('/sitemap-lombards.xml', (req, res) => {
  const { lombards } = getMfoData();
  csvSitemap(res, lombards, 'lombards');
});
`;
const newCsvSitemap = `function csvSitemap(res, items, prefix, sourceFiles) {
  const lastmod = latestFileLastmod(sourceFiles || []);
  const urls = items.filter(item => item.slug).map(item => \\`
  <url>
    <loc>https://zakonexpertt.kz/\${prefix}/\${item.slug}</loc>\${lastmod ? \\`\n    <lastmod>\${lastmod}</lastmod>\\` : ''}
    <changefreq>monthly</changefreq>
    <priority>0.6</priority>
  </url>\\`).join('');
  res.set('Content-Type', 'application/xml');
  res.send(\\`<?xml version="1.0" encoding="UTF-8"?>\\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\${urls}\\n</urlset>\\`);
}

app.get('/sitemap-banks.xml',      (req, res) => csvSitemap(res, getBanksData(),      'banks', 'Банки_Казахстана.csv'));
app.get('/sitemap-courts.xml',     (req, res) => csvSitemap(res, getCourtsData(),     'courts', 'Суды_Казахстана.csv'));
app.get('/sitemap-chambers.xml',   (req, res) => csvSitemap(res, getChambersData(),   'chambers', ['Нотариальные_палаты_Казахстана.csv', 'Палаты_ЧСИ_Казахстана.csv']));
app.get('/sitemap-collectors.xml', (req, res) => csvSitemap(res, getCollectors(),     'collectors', 'Коллекторские_агентства_Казахстана.csv'));
app.get('/sitemap-gsi.xml',        (req, res) => csvSitemap(res, getGsiData(),        'gsi', 'Государственные_судебные_исполнители_Департаменты_юстиции.csv'));
app.get('/sitemap-insurance.xml',  (req, res) => csvSitemap(res, getInsuranceData(),  'insurance', 'Страховые_компании_Казахстана.csv'));
app.get('/sitemap-mfo.xml', (req, res) => {
  const { mfo } = getMfoData();
  csvSitemap(res, mfo, 'mfo', 'МФО_Ломбарды_КредТоварищества_Казахстана.csv');
});
app.get('/sitemap-lombards.xml', (req, res) => {
  const { lombards } = getMfoData();
  csvSitemap(res, lombards, 'lombards', 'МФО_Ломбарды_КредТоварищества_Казахстана.csv');
});
`;
server = replaceOnce(server, oldCsvSitemap, newCsvSitemap, 'accurate CSV sitemap lastmod');

const sitemapIndexExpression = /\/\/ SITEMAP INDEX[\s\S]*?(?=\/\/ Unique, lightweight editorial cover)/;
const newSitemapIndex = `// SITEMAP INDEX
function sitemapIndexEntry(sitemapPath, lastmod) {
  return \\`  <sitemap>\n    <loc>https://zakonexpertt.kz\${sitemapPath}</loc>\${lastmod ? \\`\n    <lastmod>\${lastmod}</lastmod>\\` : ''}\n  </sitemap>\\`;
}

app.get('/sitemap-index.xml', (req, res) => {
  const companyLastmod = companiesDb
    ? String(companiesDb.stats().qualityUpdatedAt || companiesDb.stats().updatedAt || '').substring(0, 10)
    : '';
  const entries = [
    ['/sitemap-pages.xml', latestFileLastmod(['server.js', 'modules/bank-arrest-pages.js', 'modules/legal-intent-pages.js'])],
    ['/sitemap-news.xml', ''],
    ['/sitemap-notaries.xml', latestFileLastmod(['Нотариусы.csv', 'notaries.csv'])],
    ['/sitemap-bailiffs.xml', latestFileLastmod(['ЧСИ.csv', 'bailiffs.csv'])],
    ['/sitemap-lawyers.xml', latestFileLastmod(['Адвокаты.csv', 'lawyers.csv'])],
    ['/sitemap-laws.xml', ''],
    ['/sitemap-banks.xml', latestFileLastmod('Банки_Казахстана.csv')],
    ['/sitemap-courts.xml', latestFileLastmod('Суды_Казахстана.csv')],
    ['/sitemap-chambers.xml', latestFileLastmod(['Нотариальные_палаты_Казахстана.csv', 'Палаты_ЧСИ_Казахстана.csv'])],
    ['/sitemap-collectors.xml', latestFileLastmod('Коллекторские_агентства_Казахстана.csv')],
    ['/sitemap-gsi.xml', latestFileLastmod('Государственные_судебные_исполнители_Департаменты_юстиции.csv')],
    ['/sitemap-insurance.xml', latestFileLastmod('Страховые_компании_Казахстана.csv')],
    ['/sitemap-mfo.xml', latestFileLastmod('МФО_Ломбарды_КредТоварищества_Казахстана.csv')],
    ['/sitemap-image.xml', latestFileLastmod(['server.js', 'public/img/seo'])],
    ['/sitemap-lombards.xml', latestFileLastmod('МФО_Ломбарды_КредТоварищества_Казахстана.csv')],
  ];
  const companyEntries = companiesDb
    ? Array.from({ length: companiesDb.sitemapChunkCount() }, (_, index) => [\\`/sitemap-companies-\${index + 1}.xml\\`, companyLastmod])
    : [];
  res.set('Content-Type', 'application/xml');
  res.set('Cache-Control', 'public, max-age=3600, stale-while-revalidate=86400');
  res.send(\\`<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
\${entries.concat(companyEntries).map(([sitemapPath, lastmod]) => sitemapIndexEntry(sitemapPath, lastmod)).join('\\n')}
</sitemapindex>\\`);
});

`;
server = replaceRegexOnce(server, sitemapIndexExpression, newSitemapIndex, 'stable sitemap index lastmod');

server = replaceOnce(
  server,
  "  'company_check_shared', 'click_cta_company_check',\n]);",
  "  'company_check_shared', 'click_cta_company_check',\n  'view_bank_arrest_page', 'click_cta_bank_arrest',\n  'view_legal_intent_page', 'click_cta_legal_intent',\n]);",
  'growth analytics allowlist'
);

server = replaceOnce(
  server,
  "  if (page === '/' ) return 'home';",
  "  if (page === '/' ) return 'home';\n  if (page === BANK_ARREST_HUB_PATH || BANK_ARREST_PATH_SET.has(page)) return 'bank_arrest';\n  if (LEGAL_INTENT_PATH_SET.has(page)) return 'legal_intent';",
  'growth analytics classifier'
);

write('server.js', server);

let bankCsv = read('Банки_Казахстана.csv').replace(/\s+$/, '') + '\n';
if (!bankCsv.includes(';930140000323;')) {
  bankCsv += 'АО ДБ "Казахстан-Зираат Интернешнл Банк" (KZI Bank);930140000323;kzibank.kz;9193, +7 727 244-40-00, +7 727 244-19-93;kzibank@kzibank.kz;г. Алматы, ул. Наурызбай батыра, 17А;не опубликовано в официальном источнике;действующий банк второго уровня, БИН и контакты проверены по официальному сайту банка\n';
}
if (!bankCsv.includes(';180640000680;')) {
  bankCsv += 'АО "Коммерческий Банк БиЭнКей" (BNK Commercial Bank);180640000680;bnkcommercialbank.kz;5210;info@bnkcommercialbank.kz;г. Алматы, ул. Ауэзова, 60;Ким Сонгхён;банковская лицензия № 1.1.118 от 25.06.2025\n';
}
write('Банки_Казахстана.csv', bankCsv);

let bankItem = read('views/banks/item.ejs');
if (!bankItem.includes('const arrestGuidePath')) {
  bankItem = replaceOnce(
    bankItem,
    "const canonical = 'https://zakonexpertt.kz/banks/' + bank.slug;",
    "const canonical = 'https://zakonexpertt.kz/banks/' + bank.slug;\nconst arrestGuidePath = typeof bankArrestPath === 'string' && bankArrestPath ? bankArrestPath : '/arest-scheta-v-bankah-kazahstana';",
    'bank item arrest path'
  );
  bankItem = replaceOnce(
    bankItem,
    "  moreHtml: lowContentBoost({ entityLabel: bank.shortName }),",
    "  moreHtml: '<section style=\"margin:20px 0;padding:22px;border:1px solid #dbe4ed;border-radius:16px;background:#f8fafc;\">'\n    + '<span style=\"color:#a17624;font-size:.72rem;font-weight:800;letter-spacing:.08em;text-transform:uppercase;\">Арест или блокировка счёта</span>'\n    + '<h2 style=\"margin:7px 0 9px;color:#071426;font-size:1.2rem;\">Что делать именно в ' + esc(bank.shortName) + '</h2>'\n    + '<p style=\"margin:0 0 14px;color:#5b6e82;font-size:.86rem;line-height:1.6;\">Отдельная инструкция: как запросить документ банка, отличить постановление ЧСИ от налоговой или внутренней проверки и выбрать правильный маршрут.</p>'\n    + '<a href=\"' + esc(arrestGuidePath) + '\" style=\"display:inline-flex;align-items:center;gap:8px;color:#18558f;font-weight:800;text-decoration:none;\">Открыть инструкцию →</a>'\n    + '</section>' + lowContentBoost({ entityLabel: bank.shortName }),",
    'bank item contextual money link'
  );
}
write('views/banks/item.ejs', bankItem);

let layout = read('views/news/layout.ejs');
if (!layout.includes('Аресты во всех банках')) {
  layout = replaceOnce(
    layout,
    '          <a href="/arest-kaspi">Kaspi арест</a>',
    '          <a href="/arest-kaspi">Kaspi арест</a>\n          <a href="/arest-scheta-v-bankah-kazahstana">Аресты во всех банках</a>',
    'footer bank cluster link'
  );
}
write('views/news/layout.ejs', layout);

const legacyClusterBlock = `
<section class="zg-legacy-cluster" data-bank-cluster-entry>
  <div class="legal-container">
    <span>Новая база по банкам</span>
    <h2>Выберите свой банк и получите точный порядок действий</h2>
    <p>Мы подготовили отдельные страницы по 23 банкам второго уровня Казахстана и разделили арест ЧСИ, налоговое ограничение, судебную меру и финмониторинг банка.</p>
    <div>
      <a href="/arest-scheta-v-bankah-kazahstana"><i class="bi bi-bank"></i> Все банки Казахстана</a>
      <a href="/kak-uznat-kto-nalozhil-arest-na-schet"><i class="bi bi-search"></i> Узнать, кто наложил арест</a>
      <a href="/blokirovka-scheta-po-finmonitoringu"><i class="bi bi-shield-lock"></i> Блокировка финмониторингом</a>
    </div>
  </div>
</section>`;

['public/arest-kaspi.html', 'public/arest-halyk-bank.html', 'public/arest-freedom-bank.html'].forEach(relativePath => {
  let html = addStylesheet(read(relativePath));
  html = insertBeforeMainClose(html, legacyClusterBlock, relativePath + ' cluster entry');
  write(relativePath, html);
});

let accountPage = addStylesheet(read('public/snyatie-aresta-so-scheta.html'));
const accountClusterBlock = `
<section class="zg-legacy-cluster zg-legacy-cluster--wide" data-bank-cluster-entry>
  <div class="legal-container">
    <span>Диагностика проблемы</span>
    <h2>Один симптом — разные юридические причины</h2>
    <p>Выберите банк или тип ограничения. Так вы попадёте не на общую статью, а на маршрут с нужными документами и адресатом.</p>
    <div>
      <a href="/arest-scheta-v-bankah-kazahstana"><i class="bi bi-bank"></i> Все банки</a>
      <a href="/kak-uznat-kto-nalozhil-arest-na-schet"><i class="bi bi-search"></i> Кто наложил арест</a>
      <a href="/bank-spisal-dengi-po-ispolnitelnomu-proizvodstvu"><i class="bi bi-cash-stack"></i> Деньги уже списали</a>
      <a href="/arest-sotsialnogo-scheta"><i class="bi bi-heart-pulse"></i> Социальные выплаты</a>
      <a href="/arest-scheta-nalogovoy"><i class="bi bi-receipt"></i> Налоговая</a>
      <a href="/blokirovka-scheta-po-finmonitoringu"><i class="bi bi-shield-lock"></i> Финмониторинг</a>
      <a href="/kak-poluchit-postanovlenie-chsi"><i class="bi bi-file-earmark-text"></i> Получить документы ЧСИ</a>
      <a href="/arest-ip-scheta"><i class="bi bi-briefcase"></i> Счёт ИП</a>
    </div>
  </div>
</section>`;
accountPage = insertBeforeMainClose(accountPage, accountClusterBlock, 'account hub cluster entry');
write('public/snyatie-aresta-so-scheta.html', accountPage);

let css = read('public/css/bank-arrest-cluster.css');
if (!css.includes('.zg-legacy-cluster')) {
  css += `

.zg-legacy-cluster {
  padding: 48px 0;
  border-top: 1px solid #dbe4ed;
  border-bottom: 1px solid #dbe4ed;
  background: linear-gradient(135deg, #071426, #12375f);
}

.zg-legacy-cluster span {
  color: #f2cf78;
  font-size: 0.74rem;
  font-weight: 850;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.zg-legacy-cluster h2 {
  max-width: 780px;
  margin: 8px 0 12px;
  color: #fff;
  font-size: clamp(1.55rem, 3vw, 2.45rem);
  font-weight: 850;
  letter-spacing: -0.03em;
}

.zg-legacy-cluster p {
  max-width: 860px;
  color: rgba(255, 255, 255, 0.72);
  line-height: 1.65;
}

.zg-legacy-cluster > div > div {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 22px;
}

.zg-legacy-cluster a {
  display: inline-flex;
  gap: 8px;
  align-items: center;
  padding: 11px 14px;
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 11px;
  color: #fff;
  background: rgba(255, 255, 255, 0.07);
  font-size: 0.82rem;
  font-weight: 800;
  text-decoration: none;
}

.zg-legacy-cluster a:hover {
  border-color: rgba(242, 207, 120, 0.7);
  color: #f2cf78;
}
`;
}
write('public/css/bank-arrest-cluster.css', css);

let analytics = read('public/js/analytics-events.js');
analytics = analytics.replace(
  "    'click_cta_company', 'company_check_completed', 'click_cta_company_check',\n",
  "    'click_cta_company', 'company_check_completed', 'click_cta_company_check',\n    'click_cta_bank_arrest', 'click_cta_legal_intent',\n"
);
write('public/js/analytics-events.js', analytics);

let llms = read('public/llms.txt');
llms = llms.replace('https://zakonexpertt.kz/snyatie-aresta-so-scheta.html', 'https://zakonexpertt.kz/snyatie-aresta-so-scheta');
if (!llms.includes('Bank account arrest hub:')) {
  llms = llms.replace(
    '## Machine-readable public snapshot',
    `## High-intent legal guidance

- Bank account arrest hub: https://zakonexpertt.kz/arest-scheta-v-bankah-kazahstana
- Identify who imposed an account restriction: https://zakonexpertt.kz/kak-uznat-kto-nalozhil-arest-na-schet
- Money debited in enforcement proceedings: https://zakonexpertt.kz/bank-spisal-dengi-po-ispolnitelnomu-proizvodstvu
- Social-payment account restriction: https://zakonexpertt.kz/arest-sotsialnogo-scheta
- Tax authority account restriction: https://zakonexpertt.kz/arest-scheta-nalogovoy
- Bank AML/compliance restriction: https://zakonexpertt.kz/blokirovka-scheta-po-finmonitoringu
- Obtain a private enforcement officer decision: https://zakonexpertt.kz/kak-poluchit-postanovlenie-chsi
- Sole proprietor account restriction: https://zakonexpertt.kz/arest-ip-scheta

## Machine-readable public snapshot`
  );
}
llms = llms.replace(/Last updated: \d{4}-\d{2}-\d{2}/, 'Last updated: 2026-08-23');
write('public/llms.txt', llms);

const packagePath = 'package.json';
const pkg = JSON.parse(read(packagePath));
pkg.scripts['test:bank-growth'] = 'node scripts/test-bank-arrest-cluster.js';
const jsChecks = [
  'node --check modules/bank-arrest-pages.js',
  'node --check modules/legal-intent-pages.js',
  'node --check public/js/growth-pages.js',
  'node --check scripts/test-bank-arrest-cluster.js',
];
jsChecks.forEach(command => {
  if (!pkg.scripts['check:js'].includes(command)) pkg.scripts['check:js'] += ' && ' + command;
});
if (!pkg.scripts.test.includes('npm run test:bank-growth')) {
  pkg.scripts.test = pkg.scripts.test.replace(' && npm run test:smoke', ' && npm run test:bank-growth && npm run test:smoke');
}
write(packagePath, JSON.stringify(pkg, null, 2) + '\n');

console.log('Bank arrest cluster migration completed.');
