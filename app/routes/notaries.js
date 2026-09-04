'use strict';

const path = require('path');
const axios = require('axios');
const { getRegionEmblem } = require('../../modules/region-emblems');
const { getNotaryRegionBySlug, getNotaryRegionByName, withNotaryRegionPaths } = require('../../modules/notary-regions');
const { normalizeRegionKey } = require('../../modules/notary-archive');
const { notaryKey, readNotaryChanges } = require('../../modules/notary-changes');
const { ROOT_DIR } = require('../paths');

function registerNotaryRoutes(app, dependencies) {
  const {
    notariesDb,
    importNotaries,
    refreshNotariesRegistry,
    commentsDb,
    asyncHandler,
    sendNotFound,
    checkAdminKey,
    externalApiLimiter,
    getChambersData,
    logger,
  } = dependencies;

  // ===== NOTARY SEARCH =====
  app.get('/notary-search', (req, res) => {
    res.sendFile(path.join(ROOT_DIR, 'public', 'notary-search.html'));
  });

  app.get('/api/notary-search', externalApiLimiter, asyncHandler(async (req, res) => {
    const cheerio = require('cheerio');
    const { fio = '', phone = '', license = '', region = '0' } = req.query;
    if (!fio && !phone && !license) {
      return res.status(400).json({ error: 'Укажите ФИО, телефон или номер лицензии' });
    }
    const params = new URLSearchParams({ fio, region, city: '', phoneNumber: phone, licenseNumber: license });
    const url = `https://enis.kz/NotarySearch/Details/?${params}`;
    try {
      const resp = await axios.get(url, { timeout: 15000, headers: { 'User-Agent': 'Mozilla/5.0' } });
      const $ = cheerio.load(resp.data);
      const countText = $('b').filter((i, el) => $(el).text().includes('Найдено записей')).first().text();
      const total = parseInt(countText.match(/\d+/)?.[0] || '0');
      const notaries = [];
      $('font[face="Arial"]').each((i, el) => {
        const font = $(el);
        const nameEl = font.find('a').first();
        const name = nameEl.text().trim();
        if (!name) return;
        const href = nameEl.attr('href') || '';
        const id = href.match(/\/(\d+)$/)?.[1] || '';
        const inner = font.html() || '';
        const parts = inner.split(/<br\s*\/?>/i);
        let address = '', phone2 = '', workHours = '', email = '';
        for (const part of parts) {
          const clean = part.replace(/<[^>]+>/g, '').trim();
          if (clean.startsWith('Адрес:')) address = clean.replace('Адрес:', '').trim();
          else if (clean.startsWith('Телефон:')) phone2 = clean.replace('Телефон:', '').trim();
          else if (clean.startsWith('Режим работы:')) workHours = clean.replace('Режим работы:', '').trim();
          else if (clean.startsWith('Электронный адрес:')) email = clean.replace('Электронный адрес:', '').trim();
        }
        notaries.push({ id, name, address, phone: phone2, workHours, email,
          url: id ? `https://enis.kz/Notary/Details/${id}` : '' });
      });
      res.json({ total, notaries });
    } catch (e) {
      logger.error('Notary search error:', e.message);
      res.status(500).json({ error: 'Не удалось получить данные с enis.kz' });
    }
  }));

  // ===== NOTARY SEO PAGES =====

  app.get('/zamena-notariusa.html', (req, res) => {
    const qs = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
    res.redirect(301, '/zamena-notariusa' + qs);
  });

  app.get('/zamena-notariusa', asyncHandler(async (req, res) => {
    if (!notariesDb) return res.status(503).send('Notary module not available');
    const query = String(req.query.q || '').trim().slice(0, 160);
    const [directory, lastUpdated] = await Promise.all([
      notariesDb.getArchiveDirectory(query),
      notariesDb.getLastUpdated(),
    ]);
    const regions = new Set();
    directory.matchedNotaries.forEach(item => regions.add(normalizeRegionKey(item.region)));
    directory.transfers.forEach(item => regions.add(normalizeRegionKey(item.holder.region)));
    const chambers = getChambersData().filter(item => regions.has(normalizeRegionKey(item.region)));
    res.render('notary/archive-search', { query, directory, lastUpdated, chambers });
  }));

  // Individual notary page
  app.get('/notary/:slug', asyncHandler(async (req, res) => {
    if (!notariesDb) return res.status(503).send('Notary module not available');
    const notary = await notariesDb.findBySlug(req.params.slug);
    if (!notary) return sendNotFound(res);
    if (notary.slug !== req.params.slug) return res.redirect(301, `/notary/${notary.slug}`);
    const [comments, commentStats] = commentsDb
      ? await Promise.all([commentsDb.getApproved('notary', req.params.slug), commentsDb.stats('notary', req.params.slug)])
      : [[], null];
    res.render('notary/page', { notary, comments, commentStats, commentSent: req.query.comment === 'sent' });
  }));

  // Sitemap for notary pages
  app.get('/sitemap-notaries.xml', asyncHandler(async (req, res) => {
    res.set('Content-Type', 'application/xml');
    if (!notariesDb) {
      return res.send('<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>');
    }
    const [all, regions] = await Promise.all([notariesDb.getAllSlugs(), notariesDb.getRegions()]);
    const lastUpdated = await notariesDb.getLastUpdated();
    const lastmod = lastUpdated ? new Date(lastUpdated).toISOString().substring(0, 10) : new Date().toISOString().substring(0, 10);
    const changeHistory = readNotaryChanges();
    const changeDate = new Date(changeHistory.latestChangeAt || changeHistory.checkedAt || lastmod);
    const changeLastmod = Number.isNaN(changeDate.getTime()) ? lastmod : changeDate.toISOString().substring(0, 10);
    const changesUrl = changeHistory.changes.length ? `
  <url>
    <loc>https://zakonexpert.kz/notaries/changes</loc>
    <lastmod>${changeLastmod}</lastmod>
    <changefreq>daily</changefreq>
    <priority>0.8</priority>
  </url>` : '';
    const regionUrls = withNotaryRegionPaths(regions).map(r => `
  <url>
    <loc>https://zakonexpert.kz${r.path}</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.75</priority>
  </url>`).join('');
    const profileUrls = all.map(n => `
  <url>
    <loc>https://zakonexpert.kz/notary/${n.slug}</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.6</priority>
  </url>`).join('');
    res.send(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  ${changesUrl}
  ${regionUrls}
  ${profileUrls}
</urlset>`);
  }));

  // Admin: manual notary import trigger
  app.post('/api/notaries/import', asyncHandler(async (req, res) => {
    if (!checkAdminKey(req, res)) return;
    if (!importNotaries) return res.status(503).json({ error: 'Notary module not available' });
    const count = await importNotaries();
    res.json({ ok: true, imported: count });
  }));

  app.post('/api/notaries/refresh', asyncHandler(async (req, res) => {
    if (!checkAdminKey(req, res)) return;
    if (!refreshNotariesRegistry || !importNotaries) return res.status(503).json({ error: 'Notary module not available' });
    const refreshed = await refreshNotariesRegistry();
    const imported = await importNotaries();
    res.json({ ok: true, refreshed, imported });
  }));

  // ===== CATALOG PAGES =====

  const NOTARY_PAGE_SIZE = 60;

  app.get('/notaries', asyncHandler(async (req, res) => {
    const region = (req.query.region || '').trim();
    if (!notariesDb) return res.status(503).send('Notary module not available');
    if (region) {
      const regionPage = getNotaryRegionByName(region);
      return res.redirect(301, regionPage ? regionPage.path : '/notaries');
    }
    const [allRegions, lastUpdated] = await Promise.all([
      notariesDb.getRegions(),
      notariesDb.getLastUpdated(),
    ]);
    res.render('notary/catalog', {
      selectedRegion: '', regionPage: null, allRegions: withNotaryRegionPaths(allRegions),
      regionItems: [], lastUpdated, getRegionEmblem,
      pagination: { page: 1, pageSize: NOTARY_PAGE_SIZE, total: 0, totalPages: 1 },
    });
  }));

  app.get('/notaries/changes', asyncHandler(async (req, res) => {
    const allowedTypes = new Set(['added', 'status', 'updated', 'removed']);
    const type = allowedTypes.has(String(req.query.type || '')) ? String(req.query.type) : '';
    const region = String(req.query.region || '').trim().slice(0, 100);
    const history = readNotaryChanges();
    const profiles = notariesDb ? await notariesDb.getAllSlugs() : [];
    const profileByKey = new Map(profiles.map(profile => [notaryKey(profile), profile.slug]));
    const allChanges = history.changes.map(change => ({
      ...change,
      profileSlug: profileByKey.get(notaryKey(change)) || '',
    }));
    const regions = [...new Set(allChanges.map(change => change.region).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, 'ru'));
    const filteredChanges = allChanges.filter(change => {
      if (type && change.type !== type) return false;
      if (region && normalizeRegionKey(change.region) !== normalizeRegionKey(region)) return false;
      return true;
    }).slice(0, 200);
    const stats = allChanges.reduce((result, change) => {
      result[change.type] = (result[change.type] || 0) + 1;
      return result;
    }, { added: 0, status: 0, updated: 0, removed: 0 });
    res.render('notary/changes', {
      history,
      changes: filteredChanges,
      stats,
      filters: { type, region },
      regions,
      noindex: Boolean(type || region || !history.changes.length),
    });
  }));

  app.get('/notaries/:regionSlug', asyncHandler(async (req, res) => {
    if (!notariesDb) return res.status(503).send('Notary module not available');
    const regionPage = getNotaryRegionBySlug(req.params.regionSlug);
    if (!regionPage) return sendNotFound(res);
    const parsedPage = Number.parseInt(req.query.page, 10);
    const requestedPage = Number.isInteger(parsedPage) && parsedPage > 0 ? parsedPage : 1;
    const [allRegions, total, lastUpdated] = await Promise.all([
      notariesDb.getRegions(),
      notariesDb.countByRegion(regionPage.sourceName),
      notariesDb.getLastUpdated(),
    ]);
    const totalPages = Math.max(1, Math.ceil(total / NOTARY_PAGE_SIZE));
    if (requestedPage > totalPages) return sendNotFound(res);
    const page = requestedPage;
    const normalizedPath = regionPage.path + (page > 1 ? `?page=${page}` : '');
    if (req.query.page !== undefined && String(req.query.page) !== (page > 1 ? String(page) : '')) {
      return res.redirect(301, normalizedPath);
    }
    const regionItems = await notariesDb.findByRegion(
      regionPage.sourceName,
      NOTARY_PAGE_SIZE,
      (page - 1) * NOTARY_PAGE_SIZE,
    );
    res.render('notary/catalog', {
      selectedRegion: regionPage.sourceName,
      regionPage,
      allRegions: withNotaryRegionPaths(allRegions),
      regionItems,
      lastUpdated,
      getRegionEmblem,
      pagination: { page, pageSize: NOTARY_PAGE_SIZE, total, totalPages },
    });
  }));

}

module.exports = { registerNotaryRoutes };
