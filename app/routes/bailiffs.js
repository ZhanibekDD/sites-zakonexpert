'use strict';

const { getRegionEmblem } = require('../../modules/region-emblems');
const { getBailiffRegionBySlug, getBailiffRegionByName, withBailiffRegionPaths } = require('../../modules/bailiff-regions');

function registerBailiffRoutes(app, dependencies) {
  const { bailiffsDb, importBailiffs, commentsDb, asyncHandler, sendNotFound, checkAdminKey } = dependencies;

  // ===== BAILIFF SEARCH =====
  app.get('/bailiff-search', asyncHandler(async (req, res) => {
    const q = (req.query.q || '').trim();
    let results = null;
    let suggestion = null;
    if (q.length >= 2 && bailiffsDb) {
      results = await bailiffsDb.search(q);
      if (results.length === 0) {
        suggestion = await bailiffsDb.fuzzySearch(q);
      }
    } else if (q.length >= 2) {
      results = [];
    }
    res.render('bailiff/search', { query: q, results, suggestion });
  }));

  app.get('/bailiffs', asyncHandler(async (req, res) => {
    const region = (req.query.region || '').trim();
    if (!bailiffsDb) return res.status(503).send('Bailiff module not available');
    if (region) {
      const regionPage = getBailiffRegionByName(region);
      return res.redirect(301, regionPage ? regionPage.path : '/bailiffs');
    }
    const [allRegions, lastUpdated] = await Promise.all([
      bailiffsDb.getRegions(),
      bailiffsDb.getLastUpdated(),
    ]);
    res.render('bailiff/catalog', {
      selectedRegion: '', regionPage: null, allRegions: withBailiffRegionPaths(allRegions),
      regionItems: [], lastUpdated, getRegionEmblem,
    });
  }));

  app.get('/bailiffs/:regionSlug', asyncHandler(async (req, res) => {
    if (!bailiffsDb) return res.status(503).send('Bailiff module not available');
    const regionPage = getBailiffRegionBySlug(req.params.regionSlug);
    if (!regionPage) return sendNotFound(res);
    const [allRegions, regionItems, lastUpdated] = await Promise.all([
      bailiffsDb.getRegions(),
      bailiffsDb.findByRegion(regionPage.sourceName),
      bailiffsDb.getLastUpdated(),
    ]);
    res.render('bailiff/catalog', {
      selectedRegion: regionPage.sourceName,
      regionPage,
      allRegions: withBailiffRegionPaths(allRegions),
      regionItems,
      lastUpdated,
      getRegionEmblem,
    });
  }));

  // ===== BAILIFF SEO PAGES =====

  app.get('/bailiff/:slug', asyncHandler(async (req, res) => {
    if (!bailiffsDb) return res.status(503).send('Bailiff module not available');
    const bailiff = await bailiffsDb.findBySlug(req.params.slug);
    if (!bailiff) return sendNotFound(res);
    const [comments, commentStats] = commentsDb
      ? await Promise.all([commentsDb.getApproved('bailiff', req.params.slug), commentsDb.stats('bailiff', req.params.slug)])
      : [[], null];
    res.render('bailiff/page', { bailiff, comments, commentStats, commentSent: req.query.comment === 'sent' });
  }));

  app.get('/sitemap-bailiffs.xml', asyncHandler(async (req, res) => {
    res.set('Content-Type', 'application/xml');
    if (!bailiffsDb) {
      return res.send('<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>');
    }
    const [all, regions] = await Promise.all([bailiffsDb.getAllSlugs(), bailiffsDb.getRegions()]);
    const lastUpdated = await bailiffsDb.getLastUpdated();
    const lastmod = lastUpdated ? new Date(lastUpdated).toISOString().substring(0, 10) : new Date().toISOString().substring(0, 10);
    const regionUrls = regions.map(r => getBailiffRegionByName(r.region)).filter(Boolean).map(region => `
  <url>
    <loc>https://zakonexpertt.kz${region.path}</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.85</priority>
  </url>`).join('');
    const profileUrls = all.map(b => `
  <url>
    <loc>https://zakonexpertt.kz/bailiff/${b.slug}</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.6</priority>
  </url>`).join('');
    res.send(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  ${regionUrls}
  ${profileUrls}
</urlset>`);
  }));

  app.post('/api/bailiffs/import', asyncHandler(async (req, res) => {
    if (!checkAdminKey(req, res)) return;
    if (!importBailiffs) return res.status(503).json({ error: 'Bailiff module not available' });
    const count = await importBailiffs();
    res.json({ ok: true, imported: count });
  }));

}

module.exports = { registerBailiffRoutes };
