'use strict';

const path = require('path');
const fs = require('fs');
const { TOOLS } = require('../../modules/tools-catalog');
const openDataPages = require('../../modules/open-data-pages');
const { BANK_ARREST_HUB_PATH, BANK_ARREST_PAGES } = require('../../modules/bank-arrest-pages');
const { LEGAL_INTENT_PAGES } = require('../../modules/legal-intent-pages');
const { ROOT_DIR } = require('../paths');

function registerSitemapRoutes(app, dependencies) {
  const {
    newsDb,
    companiesDb,
    asyncHandler,
    getBanksData,
    getCourtsData,
    getChambersData,
    getGsiData,
    getInsuranceData,
    getCollectors,
    getMfoData,
    xmlEscape,
    NEWS_CATEGORY_SLUGS,
    newsCategoryPath,
  } = dependencies;

  // SITEMAP-PAGES.XML
  function getCorePages() {
    const pages = [
      { url: '/', priority: '1.0', freq: 'weekly' },
      { url: '/services', priority: '0.9', freq: 'monthly' },
      { url: '/contact', priority: '0.8', freq: 'monthly' },
      { url: '/news', priority: '0.9', freq: 'daily' },
      { url: '/notaries', priority: '0.85', freq: 'weekly' },
      { url: '/zamena-notariusa', priority: '0.85', freq: 'daily' },
      { url: '/bailiffs', priority: '0.85', freq: 'weekly' },
      { url: '/notary-search', priority: '0.8', freq: 'weekly' },
      { url: '/bailiff-search', priority: '0.8', freq: 'weekly' },
      { url: '/snyatie-aresta-so-scheta', priority: '0.9', freq: 'monthly' },
      { url: '/otmena-ispolnitelnoi-nadpisi', priority: '0.9', freq: 'monthly' },
      { url: '/vozrazhenie-na-ispolnitelnuyu-nadpis', priority: '0.85', freq: 'monthly' },
      { url: '/snyatie-ogranichenii-chsi', priority: '0.85', freq: 'monthly' },
      { url: '/snyatie-zapreta-na-avto', priority: '0.8', freq: 'monthly' },
      { url: '/snyatie-ogranicheniya-na-imushchestvo', priority: '0.8', freq: 'monthly' },
      { url: '/snyatie-zapreta-registracionnyh-deistvii', priority: '0.8', freq: 'monthly' },
      { url: '/snyatie-ogranichenii-u-notariusa', priority: '0.8', freq: 'monthly' },
      { url: '/grafik-oplaty-zadolzhennosti', priority: '0.8', freq: 'monthly' },
      { url: '/ubrat-procenty-i-rashody-chsi', priority: '0.8', freq: 'monthly' },
      { url: '/arest-kaspi', priority: '0.85', freq: 'monthly' },
      { url: '/arest-halyk-bank', priority: '0.85', freq: 'monthly' },
      { url: '/arest-freedom-bank', priority: '0.85', freq: 'monthly' },
      // Региональные страницы
      { url: '/snyatie-aresta-almaty', priority: '0.8', freq: 'monthly' },
      { url: '/snyatie-aresta-astana', priority: '0.8', freq: 'monthly' },
      { url: '/snyatie-aresta-shymkent', priority: '0.8', freq: 'monthly' },
      { url: '/snyatie-aresta-taldykorgan', priority: '0.75', freq: 'monthly' },
      { url: '/snyatie-aresta-karaganda', priority: '0.75', freq: 'monthly' },
      // Дополнительные сервисные страницы
      { url: '/besspornost-dolga', priority: '0.8', freq: 'monthly' },
      { url: '/alimenty-i-aresty', priority: '0.8', freq: 'monthly' },
      { url: '/shtrafy-i-aresty', priority: '0.8', freq: 'monthly' },
      { url: '/zakony', priority: '0.85', freq: 'weekly' },
      { url: '/chsi-refinansirovanie',   priority: '0.8', freq: 'monthly' },
      { url: '/otmena-resheniya-suda',   priority: '0.8', freq: 'monthly' },
      { url: '/dokumenty',               priority: '0.8', freq: 'monthly' },
      { url: '/reviews',                  priority: '0.85', freq: 'weekly' },
      { url: '/rezultaty',             priority: '0.7', freq: 'monthly' },
      { url: '/privacy', priority: '0.3', freq: 'yearly' },
      // Законы — разделы
      { url: '/statyi', priority: '0.85', freq: 'weekly' },
      { url: '/statyi?code=uk', priority: '0.8', freq: 'monthly' },
      { url: '/statyi?code=koap', priority: '0.8', freq: 'monthly' },
      { url: '/statyi?code=gk', priority: '0.8', freq: 'monthly' },
      { url: '/statyi?code=tk', priority: '0.8', freq: 'monthly' },
      { url: '/statyi?code=sk', priority: '0.8', freq: 'monthly' },
      { url: '/statyi?code=upk', priority: '0.75', freq: 'monthly' },
      // Каталоги финансовых организаций
      { url: '/banks',          priority: '0.85', freq: 'weekly' },
      { url: '/mfo',            priority: '0.85', freq: 'weekly' },
      { url: '/lombards',       priority: '0.8',  freq: 'weekly' },
      { url: '/courts',         priority: '0.8',  freq: 'weekly' },
      { url: '/chambers',       priority: '0.8',  freq: 'weekly' },
      { url: '/collectors',     priority: '0.8',  freq: 'weekly' },
      { url: '/companies',      priority: '0.9',  freq: 'weekly' },
      { url: '/proverka-kontragenta', priority: '0.95', freq: 'weekly' },
      { url: '/proverka-bankrotstva', priority: '0.95', freq: 'weekly' },
      { url: '/kk/companies',   priority: '0.75', freq: 'weekly' },
      { url: '/en/companies',   priority: '0.75', freq: 'weekly' },
      { url: '/zh/companies',   priority: '0.7',  freq: 'weekly' },
      { url: '/tr/companies',   priority: '0.7',  freq: 'weekly' },
      { url: '/companies/regions', priority: '0.8', freq: 'weekly' },
      { url: '/gsi',            priority: '0.8',  freq: 'weekly' },
      { url: '/insurance',      priority: '0.75', freq: 'weekly' },
      { url: '/credit-bureaus', priority: '0.7',  freq: 'monthly' },
      { url: '/regulators',     priority: '0.65', freq: 'monthly' },
      { url: '/emergency',      priority: '0.6',  freq: 'monthly' },
      // Инструменты
      { url: '/calculator',     priority: '0.85', freq: 'monthly' },
      { url: '/marshrut-dolzhnika', priority: '0.9', freq: 'monthly' },
      { url: '/diagnostika-aresta', priority: '0.95', freq: 'monthly', lastmod: '2026-08-24' },
      { url: '/bin-search',     priority: '0.8',  freq: 'monthly' },
      { url: '/gallery',        priority: '0.85', freq: 'monthly' },
      { url: '/press',          priority: '0.7',  freq: 'monthly' },
      { url: '/sms-1414',       priority: '0.9',  freq: 'monthly' },
      // Новые страницы из плана x1000
      { url: '/zapret-na-vyezd-iz-kazahstana',    priority: '0.85', freq: 'monthly' },
      { url: '/zhaloba-na-chsi',                  priority: '0.85', freq: 'monthly' },
      { url: '/chsi-ne-snimaet-arest-posle-oplaty', priority: '0.85', freq: 'monthly' },
      { url: '/arest-zarplatnoy-karty',           priority: '0.85', freq: 'monthly' },
      { url: '/snyat-arest-s-nedvizhimosti',      priority: '0.85', freq: 'monthly' },
      { url: '/nadpis-ili-list',                  priority: '0.9',  freq: 'monthly' },
    ];
    const growthPages = [
      { url: BANK_ARREST_HUB_PATH, priority: '0.95', freq: 'weekly', lastmod: '2026-08-24' },
      ...BANK_ARREST_PAGES.map(page => ({ url: page.path, priority: page.priority >= 95 ? '0.9' : '0.82', freq: 'monthly', lastmod: page.reviewedAt })),
      ...LEGAL_INTENT_PAGES.map(page => ({ url: page.path, priority: page.priority >= 94 ? '0.9' : '0.85', freq: 'monthly', lastmod: page.reviewedAt })),
    ];
    NEWS_CATEGORY_SLUGS.forEach(category => pages.push({
      url: newsCategoryPath(category), priority: '0.75', freq: 'daily',
    }));
    growthPages.forEach(growthPage => {
      const existing = pages.find(page => page.url === growthPage.url);
      if (existing) Object.assign(existing, growthPage);
      else pages.push(growthPage);
    });
    TOOLS.forEach(tool => {
      if (!pages.some(page => page.url === tool.href)) {
        pages.push({ url: tool.href, priority: '0.82', freq: 'monthly' });
      }
    });
    if (companiesDb) {
      companiesDb.regionStats().forEach(region => {
        pages.push({ url: `/companies/region/${region.slug}`, priority: '0.6', freq: 'weekly' });
      });
    }
    return pages;
  }

  function latestFileLastmod(relativePaths) {
    const timestamps = (Array.isArray(relativePaths) ? relativePaths : [relativePaths])
      .map(relativePath => {
        try { return fs.statSync(path.join(ROOT_DIR, relativePath)).mtime; }
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
      return `
  <url>
    <loc>https://zakonexpert.kz${xmlEscape(page.url)}</loc>${lastmod ? `
    <lastmod>${lastmod}</lastmod>` : ''}
    <changefreq>${page.freq}</changefreq>
    <priority>${page.priority}</priority>
  </url>`;
    }).join('');

    res.set('Content-Type', 'application/xml');
    res.send(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  ${urls}
</urlset>`);
  });

  // SITEMAP.TXT — plain URL list for AI crawlers (GPTBot, PerplexityBot, ClaudeBot, etc.)
  // that prefer a lightweight format over parsing XML.
  app.get('/sitemap.txt', asyncHandler(async (req, res) => {
    const urls = getCorePages().map(p => `https://zakonexpert.kz${p.url}`);
    openDataPages.sitemapEntries().forEach(entry => urls.push(`https://zakonexpert.kz${entry.path}`));
    if (newsDb) {
      const articles = await newsDb.getAllForSitemap();
      articles.forEach(a => urls.push(`https://zakonexpert.kz/news/${a.slug}`));
    }
    res.set('Content-Type', 'text/plain; charset=utf-8');
    res.send(urls.join('\n'));
  }));

  // SITEMAPS: CSV-backed catalogs (banks, courts, mfo, lombards, gsi, insurance, collectors, chambers)
  function csvSitemap(res, items, prefix, sourceFiles) {
    const lastmod = latestFileLastmod(sourceFiles || []);
    const urls = items.filter(item => item.slug).map(item => `
  <url>
    <loc>https://zakonexpert.kz/${prefix}/${item.slug}</loc>${lastmod ? `
    <lastmod>${lastmod}</lastmod>` : ''}
    <changefreq>monthly</changefreq>
    <priority>0.6</priority>
  </url>`).join('');
    res.set('Content-Type', 'application/xml');
    res.send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}\n</urlset>`);
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

  app.get('/sitemap-open-data.xml', (req, res) => {
    const urls = openDataPages.sitemapEntries().map(entry => `
  <url>
    <loc>https://zakonexpert.kz${xmlEscape(entry.path)}</loc>${entry.lastmod ? `
    <lastmod>${xmlEscape(entry.lastmod)}</lastmod>` : ''}
    <changefreq>weekly</changefreq>
    <priority>${entry.priority}</priority>
  </url>`).join('');
    res.set('Content-Type', 'application/xml');
    res.set('Cache-Control', 'public, max-age=3600, stale-while-revalidate=86400');
    res.send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}\n</urlset>`);
  });

  // COMPANY SITEMAPS — bounded LRU cache. Caching every company sitemap caused a
  // memory leak: 81 chunks × ~2.4 MB could retain roughly 190 MB in a 1 GB hosting
  // account. Two recent chunks are enough to absorb crawler retries.
  const _companiesSitemapCache = new Map();
  const COMPANIES_SITEMAP_CACHE_MAX = 2;
  function buildCompaniesSitemapChunk(chunk) {
    let xml = _companiesSitemapCache.get(chunk);
    if (xml) {
      _companiesSitemapCache.delete(chunk);
      _companiesSitemapCache.set(chunk, xml);
      return xml;
    }
    const sourceDate = String(companiesDb.stats().qualityUpdatedAt || companiesDb.stats().updatedAt || new Date().toISOString()).substring(0, 10);
    const urls = companiesDb.sitemapChunk(chunk).map(company => `
  <url>
    <loc>https://zakonexpert.kz/company/${company.slug}</loc>
    <lastmod>${sourceDate}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.55</priority>
  </url>`).join('');
    xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}
</urlset>`;
    _companiesSitemapCache.set(chunk, xml);
    while (_companiesSitemapCache.size > COMPANIES_SITEMAP_CACHE_MAX) {
      _companiesSitemapCache.delete(_companiesSitemapCache.keys().next().value);
    }
    return xml;
  }
  app.get(/^\/sitemap-companies-(\d+)\.xml$/, (req, res) => {
    const chunk = Number.parseInt(req.params[0], 10);
    const totalChunks = companiesDb ? companiesDb.sitemapChunkCount() : 0;
    if (!chunk || chunk > totalChunks) return res.status(404).send('Sitemap chunk not found');

    res.set('Content-Type', 'application/xml');
    res.set('Cache-Control', 'public, max-age=3600, stale-while-revalidate=86400');
    res.send(buildCompaniesSitemapChunk(chunk));
  });

  // IMAGE SITEMAP — key SEO images (gallery + hero images on money pages)
  app.get('/sitemap-image.xml', (req, res) => {
    const galleryImages = [
      ['snyatie-aresta-scheta-zakonexpert.svg', 'Снятие ареста со счёта Казахстан — ZakonExpert юридическая помощь'],
      ['kak-snyat-arest-scheta-kazakhstan.svg', 'Как снять арест со счёта в Казахстане — пошаговая инструкция ZakonExpert'],
      ['snyt-arest-kazakhstan-zakonexpert.svg', 'Снять арест Казахстан — Kaspi Halyk МФО ЧСИ ZakonExpert'],
      ['arest-kaspi-halyk-bank-kazakhstan.svg', 'Арест Kaspi и Halyk Bank Казахстан — снятие ареста ZakonExpert'],
      ['snyatie-aresta-zarplaty-chsi.svg', 'Снятие ареста с зарплаты ЧСИ Казахстан — ZakonExpert'],
      ['mfo-arest-scheta-dolg-kazakhstan.svg', 'МФО арест счёта за долг Казахстан — ZakonExpert'],
      ['otmena-ispolnitelnoy-nadpisi-notariusa.svg', 'Отмена исполнительной надписи нотариуса — ZakonExpert'],
      ['besporno-dolg-mfo-bank-osporit.svg', 'Спорность долга МФО и банка — как оспорить — ZakonExpert'],
      ['snyatie-zapreta-na-avto-kazakhstan.svg', 'Снятие запрета на авто Казахстан — ZakonExpert'],
      ['snyatie-zapreta-vyezd-rubezh-kazakhstan.svg', 'Снятие запрета на выезд за рубеж Казахстан — ZakonExpert'],
      ['snyatie-aresta-imushchestvo-kazakhstan.svg', 'Снятие ареста с имущества Казахстан — ZakonExpert'],
      ['pomosh-chsi-aresty-schetov-kazakhstan.svg', 'Помощь при аресте счетов ЧСИ Казахстан — ZakonExpert'],
      ['grafik-platezhey-chsi-mfo-bank.svg', 'График платежей ЧСИ, МФО, банк — ZakonExpert'],
      ['snyatie-ogranicheniy-chsi-notarius.svg', 'Снятие ограничений ЧСИ и нотариуса — ZakonExpert'],
      ['yurist-snyatie-arestov-almaty-kazakhstan.svg', 'Юрист по снятию арестов в Алматы — ZakonExpert'],
      ['uslugi-zakonexpert-kazakhstan.svg', 'Услуги ZakonExpert Казахстан — снятие арестов, ЧСИ, МФО, адвокат'],
    ];
    const heroImages = [
      ['/arest-kaspi', 'arest-kaspi-halyk-bank-kazakhstan.svg', 'Арест карты Kaspi Bank Казахстан — снятие ареста ZakonExpert'],
      ['/arest-halyk-bank', 'arest-kaspi-halyk-bank-kazakhstan.svg', 'Арест счёта Halyk Bank Казахстан — снятие ареста ZakonExpert'],
      ['/snyatie-aresta-so-scheta', 'snyatie-aresta-scheta-zakonexpert.svg', 'Снятие ареста со счёта Казахстан — помощь юриста ZakonExpert'],
      ['/snyatie-zapreta-na-avto', 'snyatie-zapreta-na-avto-kazakhstan.svg', 'Снятие запрета на автомобиль Казахстан — юридическая помощь ZakonExpert'],
      ['/snyatie-ogranichenii-chsi', 'pomosh-chsi-aresty-schetov-kazakhstan.svg', 'ЧСИ наложил арест на счёт — снятие ограничений ZakonExpert Казахстан'],
      ['/otmena-ispolnitelnoi-nadpisi', 'otmena-ispolnitelnoy-nadpisi-notariusa.svg', 'Отмена исполнительной надписи нотариуса о взыскании задолженности — ZakonExpert'],
      ['/vozrazhenie-na-ispolnitelnuyu-nadpis', 'infographic-spornost-dolga.svg', 'Спорность долга и отмена исполнительной надписи'],
      ['/zakony', 'infographic-osnovanie-aresta.svg', 'Основание ареста счёта через исполнительное производство'],
      ['/services', 'uslugi-zakonexpert-kazakhstan.svg', 'Услуги ZakonExpert Казахстан — снятие арестов, отмена надписи, ЧСИ, МФО, адвокат'],
    ];

    let urls = `  <url>
    <loc>https://zakonexpert.kz/gallery</loc>
  ${galleryImages.map(([file, caption]) => `    <image:image>
      <image:loc>https://zakonexpert.kz/img/seo/${file}</image:loc>
      <image:caption>${caption.replace(/&/g, '&amp;')}</image:caption>
    </image:image>`).join('\n')}
  </url>`;

    urls += heroImages.map(([page, file, caption]) => `
  <url>
    <loc>https://zakonexpert.kz${page}</loc>
    <image:image>
      <image:loc>https://zakonexpert.kz/img/seo/${file}</image:loc>
      <image:caption>${caption.replace(/&/g, '&amp;')}</image:caption>
    </image:image>
  </url>`).join('');

    res.set('Content-Type', 'application/xml');
    res.send(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
  ${urls}
</urlset>`);
  });

  // Legacy static index (frozen 2026-06-19, only 6 of the current 32 sitemaps)
  // — redirect so it doesn't sit in Search Console as a separate stale entry.
  app.get('/sitemap.xml', (req, res) => res.redirect(301, '/sitemap-index.xml'));

  // SITEMAP INDEX
  function sitemapIndexEntry(sitemapPath, lastmod) {
    return `  <sitemap>
    <loc>https://zakonexpert.kz${sitemapPath}</loc>${lastmod ? `
    <lastmod>${lastmod}</lastmod>` : ''}
  </sitemap>`;
  }

  app.get('/sitemap-index.xml', (req, res) => {
    const companyLastmod = companiesDb
      ? String(companiesDb.stats().qualityUpdatedAt || companiesDb.stats().updatedAt || '').substring(0, 10)
      : '';
    const entries = [
      ['/sitemap-pages.xml', latestFileLastmod(['app/routes/sitemaps.js', 'modules/bank-arrest-pages.js', 'modules/legal-intent-pages.js'])],
      ['/sitemap-open-data.xml', latestFileLastmod(['data/open-data-inventory.json.br', 'data/open-data-snapshots.json', 'modules/open-data-config.js'])],
      ['/sitemap-news.xml', ''],
      ['/sitemap-notaries.xml', latestFileLastmod(['Нотариусы.csv', 'notaries.csv'])],
      ['/sitemap-bailiffs.xml', latestFileLastmod(['ЧСИ.csv', 'bailiffs.csv'])],
      ['/sitemap-laws.xml', ''],
      ['/sitemap-banks.xml', latestFileLastmod('Банки_Казахстана.csv')],
      ['/sitemap-courts.xml', latestFileLastmod('Суды_Казахстана.csv')],
      ['/sitemap-chambers.xml', latestFileLastmod(['Нотариальные_палаты_Казахстана.csv', 'Палаты_ЧСИ_Казахстана.csv'])],
      ['/sitemap-collectors.xml', latestFileLastmod('Коллекторские_агентства_Казахстана.csv')],
      ['/sitemap-gsi.xml', latestFileLastmod('Государственные_судебные_исполнители_Департаменты_юстиции.csv')],
      ['/sitemap-insurance.xml', latestFileLastmod('Страховые_компании_Казахстана.csv')],
      ['/sitemap-mfo.xml', latestFileLastmod('МФО_Ломбарды_КредТоварищества_Казахстана.csv')],
      ['/sitemap-image.xml', latestFileLastmod(['app/routes/sitemaps.js', 'public/img/seo'])],
      ['/sitemap-lombards.xml', latestFileLastmod('МФО_Ломбарды_КредТоварищества_Казахстана.csv')],
    ];
    const companyEntries = companiesDb
      ? Array.from({ length: companiesDb.sitemapChunkCount() }, (_, index) => [`/sitemap-companies-${index + 1}.xml`, companyLastmod])
      : [];
    res.set('Content-Type', 'application/xml');
    res.set('Cache-Control', 'public, max-age=3600, stale-while-revalidate=86400');
    res.send(`<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  ${entries.concat(companyEntries).map(([sitemapPath, lastmod]) => sitemapIndexEntry(sitemapPath, lastmod)).join('\n')}
</sitemapindex>`);
  });

}

module.exports = { registerSitemapRoutes };
