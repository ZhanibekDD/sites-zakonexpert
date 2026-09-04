'use strict';

const path = require('path');
const { ROOT_DIR } = require('../paths');

function registerLawRoutes(app, dependencies) {
  const { lawsDb, asyncHandler, sendNotFound, sendGone } = dependencies;

  let _lawsSitemapCache = null;
  let _lawsSitemapCacheAt = 0;
  app.get('/sitemap-laws.xml', asyncHandler(async (req, res) => {
    res.set('Content-Type', 'application/xml');
    res.set('Cache-Control', 'public, max-age=3600, stale-while-revalidate=86400');
    if (!lawsDb) {
      return res.send('<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>');
    }
    if (!_lawsSitemapCache || Date.now() - _lawsSitemapCacheAt > 15 * 60 * 1000) {
      const all = await lawsDb.getAllSlugs();
      const today = new Date().toISOString().substring(0, 10);
      const urls = all.map(a => `
  <url>
    <loc>https://zakonexpert.kz/statya/${a.slug}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.7</priority>
  </url>`).join('');
      _lawsSitemapCache = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  ${urls}
</urlset>`;
      _lawsSitemapCacheAt = Date.now();
    }
    res.send(_lawsSitemapCache);
  }));

  // The public lawyer registry was deliberately retired. Return 410 so crawlers
  // remove the former catalog, search and profile URLs instead of treating them
  // as temporary failures or redirecting visitors to an unrelated service.
  app.get(['/lawyers', '/lawyer-search', '/lawyer/:slug', '/sitemap-lawyers.xml'], (req, res) => {
    sendGone(res);
  });

  // ===== ADVOCATE PAGE =====
  app.get('/advocate', (req, res) => {
    res.sendFile(path.join(ROOT_DIR, 'public', 'advocate.html'));
  });

  // ===== LAWS PAGES =====

  // Search API (JSON)
  app.get('/api/statyi/search', asyncHandler(async (req, res) => {
    if (!lawsDb) return res.json({ results: [] });
    const q    = (req.query.q    || '').trim();
    const code = (req.query.code || '').trim();
    const results = await lawsDb.search(q, code, 30);
    res.json({ results });
  }));

  // List / search page
  app.get('/statyi', asyncHandler(async (req, res) => {
    if (!lawsDb) return res.redirect('/zakony.html');
    const q    = (req.query.q    || '').trim();
    const code = (req.query.code || '').trim();
    const requestedPage = Math.max(1, Math.min(10000, Number.parseInt(req.query.page, 10) || 1));
    const page = code && !q ? requestedPage : 1;
    const pageSize = 30;
    const [articles, codes, total] = await Promise.all([
      code && !q ? lawsDb.findByCodePage(code, pageSize, (page - 1) * pageSize)
      : q        ? lawsDb.search(q, code, 60)
      :            Promise.resolve([]),
      lawsDb.getCodes(),
      code && !q ? lawsDb.count({ code }) : Promise.resolve(0),
    ]);
    const pages = code && !q ? Math.max(1, Math.ceil(total / pageSize)) : 1;
    if (page > pages && code && !q) {
      return res.redirect(302, `/statyi?code=${encodeURIComponent(code)}&page=${pages}`);
    }
    res.render('laws/list', {
      q,
      code,
      articles,
      codes,
      total: code && !q ? total : articles.length,
      page,
      pages,
    });
  }));

  // Individual article page
  app.get('/statya/:slug', asyncHandler(async (req, res) => {
    if (!lawsDb) return res.redirect('/statyi');
    const article = await lawsDb.findBySlug(req.params.slug);
    if (!article) return sendNotFound(res);
    const [adjacent, related, codes] = await Promise.all([
      lawsDb.adjacent(article.code, article.numInt),
      lawsDb.findByCode(article.code, 6).then(all =>
        all.filter(a => a.slug !== article.slug && Math.abs(a.numInt - article.numInt) <= 5).slice(0, 4)
      ),
      lawsDb.getCodes(),
    ]);
    res.render('laws/article', { article, adjacent, related, codes });
  }));

}

module.exports = { registerLawRoutes };
