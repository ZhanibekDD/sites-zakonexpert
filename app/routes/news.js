'use strict';



function registerNewsRoutes(app, dependencies) {
  const {
    BACKGROUND_JOBS_ENABLED,
    newsDb,
    newsImporter,
    asyncHandler,
    sendNotFound,
    checkAdminKey,
    xmlEscape,
    xmlCdata,
    NEWS_CATEGORY_SLUGS,
    newsCategoryPath,
    newsDisplayTitle,
    newsDisplayExcerpt,
    buildNewsCoverSvg,
    logger,
  } = dependencies;

  // ===== NEWS ROUTES =====
  const NEWS_PER_PAGE = 20;

  async function renderNewsList(req, res, category = null) {
    if (!newsDb) return res.status(503).send('News module not available');
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const offset = (page - 1) * NEWS_PER_PAGE;

    const [articles, total] = await Promise.all([
      category ? newsDb.getByCategory(category, NEWS_PER_PAGE, offset) : newsDb.getPublished(NEWS_PER_PAGE, offset),
      category ? newsDb.countByCategory(category) : newsDb.countPublished(),
    ]);
    const totalPages = Math.ceil(total / NEWS_PER_PAGE);

    const canonical = `https://zakonexpert.kz${newsCategoryPath(category, page)}`;
    const schema = {
      '@context': 'https://schema.org',
      '@type': 'ItemList',
      name: category ? `Новости ZakonExpert: ${category}` : 'Новости ZakonExpert',
      url: `https://zakonexpert.kz${newsCategoryPath(category)}`,
      numberOfItems: total,
      itemListElement: articles.slice(0, 10).map((a, i) => ({
        '@type': 'ListItem',
        position: offset + i + 1,
        url: `https://zakonexpert.kz/news/${a.slug}`
      }))
    };

    res.render('news/list', {
      title: category
        ? `Новости по теме «${category}» | ZakonExpert`
        : 'Новости по арестам счетов и ЧСИ | ZakonExpert',
      description: 'Актуальные новости о банках, арестах счетов, ЧСИ, должниках и законах Казахстана. Юридические комментарии.',
      canonical,
      articles,
      currentPage: page,
      totalPages,
      currentCategory: category,
      allowSourceImages: process.env.NEWS_USE_SOURCE_IMAGES !== 'false',
      schema,
    });
  }

  // NEWS LIST
  app.get('/news', asyncHandler(async (req, res) => {
    const category = String(req.query.cat || '').trim();
    if (category === 'Адвокат') return res.redirect(301, '/advocate');
    if (category) {
      if (!NEWS_CATEGORY_SLUGS.has(category)) return res.redirect(301, '/news');
      const page = Math.max(1, parseInt(req.query.page) || 1);
      return res.redirect(301, newsCategoryPath(category, page));
    }
    return renderNewsList(req, res);
  }));

  // NEWS CATEGORY
  app.get('/news/category/:category', asyncHandler(async (req, res) => {
    if (!newsDb) return res.status(503).send('News module not available');
    const category = String(req.params.category || '').trim();
    if (!NEWS_CATEGORY_SLUGS.has(category)) return sendNotFound(res);
    return renderNewsList(req, res, category);
  }));

  // NEWS RSS FEED
  app.get('/news/feed.xml', asyncHandler(async (req, res) => {
    if (!newsDb) return res.status(503).send('News module not available');
    const articles = await newsDb.getPublished(20, 0);
    const items = articles.map(a => `
    <item>
      <title><![CDATA[${xmlCdata(newsDisplayTitle(a))}]]></title>
      <link>https://zakonexpert.kz/news/${a.slug}</link>
      <guid isPermaLink="true">https://zakonexpert.kz/news/${a.slug}</guid>
      <pubDate>${new Date(a.published_at_source || a.published_at_site || a.created_at).toUTCString()}</pubDate>
      <description><![CDATA[${xmlCdata(newsDisplayExcerpt(a))}]]></description>
      <category><![CDATA[${xmlCdata(a.category || 'general')}]]></category>
    </item>`).join('');

    res.set('Content-Type', 'application/rss+xml; charset=utf-8');
    res.send(`<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>ZakonExpert — Новости</title>
    <link>https://zakonexpert.kz/news</link>
    <description>Новости об арестах счетов, ЧСИ и законодательстве Казахстана</description>
    <language>ru</language>
    <atom:link href="https://zakonexpert.kz/news/feed.xml" rel="self" type="application/rss+xml"/>
    ${items}
  </channel>
</rss>`);
  }));

  // MAIN RSS FEED
  app.get('/feed.xml', (req, res) => res.redirect(301, '/news/feed.xml'));

  // SITEMAP-NEWS.XML
  app.get('/sitemap-news.xml', asyncHandler(async (req, res) => {
    if (!newsDb) {
      res.set('Content-Type', 'application/xml');
      return res.send('<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>');
    }
    const cutoff = Date.now() - (2 * 24 * 60 * 60 * 1000);
    const articles = (await newsDb.getAllForSitemap()).filter(article => {
      const publishedAt = article.published_at_source || article.published_at_site;
      return publishedAt && Date.parse(publishedAt) >= cutoff;
    });
    const urls = articles.map(a => {
      const publishedAt = a.published_at_source || a.published_at_site;
      return `
  <url>
    <loc>https://zakonexpert.kz/news/${xmlEscape(a.slug)}</loc>
    <lastmod>${(a.updatedAt || a.published_at_source || a.published_at_site || new Date().toISOString()).substring(0, 10)}</lastmod>
    <news:news>
      <news:publication>
        <news:name>ZakonExpert</news:name>
        <news:language>ru</news:language>
      </news:publication>
      <news:publication_date>${xmlEscape(new Date(publishedAt).toISOString())}</news:publication_date>
      <news:title>${xmlEscape(newsDisplayTitle(a))}</news:title>
    </news:news>
  </url>`;
    }).join('');

    res.set('Content-Type', 'application/xml');
    res.send(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">
  ${urls}
</urlset>`);
  }));

  // Unique, lightweight editorial cover for every article. The SVG is generated
  // on request, so hundreds of news pages do not consume extra hosting storage
  // and never depend on third-party image hotlinks.
  app.get('/news/cover/:slug', asyncHandler(async (req, res) => {
    if (!newsDb) return res.status(503).send('News module not available');
    const slug = String(req.params.slug || '').replace(/\.svg$/i, '');
    const article = await newsDb.getBySlug(slug);
    if (!article) return res.status(404).send('Cover not found');
    res.set({
      'Content-Type': 'image/svg+xml; charset=utf-8',
      'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800',
      'X-Content-Type-Options': 'nosniff',
    });
    res.send(buildNewsCoverSvg(article));
  }));

  // NEWS DETAIL (must be after feed.xml, category and cover routes)
  app.get('/news/:slug', asyncHandler(async (req, res) => {
    if (!newsDb) return res.status(503).send('News module not available');
    const article = await newsDb.getBySlug(req.params.slug);
    if (!article) return sendNotFound(res);

    const displayTitle = newsDisplayTitle(article);
    const displayExcerpt = newsDisplayExcerpt(article);
    const isAdvokat = article.category === 'Адвокат';
    const generated = !isAdvokat && newsImporter?.buildGeneratedContent
      ? newsImporter.buildGeneratedContent(displayTitle, displayExcerpt)
      : {};
    const articleView = {
      ...article,
      display_title: displayTitle,
      display_excerpt: displayExcerpt,
      event_summary: article.event_summary || generated.event_summary || displayExcerpt,
      why_important: article.why_important || generated.why_important || '',
      legal_commentary: article.legal_commentary || generated.legal_commentary || '',
      what_to_check: article.what_to_check || JSON.stringify(generated.what_to_check || []),
      when_to_seek_help: article.when_to_seek_help || generated.when_to_seek_help || '',
      display_cover: (
        String(article.og_image || '').startsWith('/img/')
        || (process.env.NEWS_USE_SOURCE_IMAGES !== 'false' && /^https:\/\//i.test(article.og_image || ''))
      ) ? article.og_image : `/news/cover/${encodeURIComponent(article.slug)}.svg`,
      fallback_cover: `/news/cover/${encodeURIComponent(article.slug)}.svg`,
    };
    const rawSchemaImage = articleView.display_cover;
    const schemaImage = /^https:\/\//i.test(rawSchemaImage)
      ? rawSchemaImage
      : `https://zakonexpert.kz${rawSchemaImage.startsWith('/') ? '' : '/'}${rawSchemaImage}`;

    const tagsArr = JSON.parse(article.tags || '[]');
    const relatedRaw = tagsArr.length > 0
      ? await newsDb.getByTags(tagsArr[0])
      : await newsDb.getPublished(5, 0);
    const related = relatedRaw
      .filter(r => r.slug !== article.slug && (isAdvokat ? r.category === 'Адвокат' : r.category !== 'Адвокат'))
      .slice(0, 4);

    const pubDate = new Date(article.published_at_source || article.published_at_site || article.created_at);
    const schema = {
      '@context': 'https://schema.org',
      '@type': 'NewsArticle',
      headline: displayTitle,
      description: article.meta_desc || displayExcerpt,
      url: `https://zakonexpert.kz/news/${article.slug}`,
      datePublished: pubDate.toISOString(),
      dateModified: article.updated_at || pubDate.toISOString(),
      publisher: {
        '@type': 'Organization',
        name: 'ZakonExpert',
        url: 'https://zakonexpert.kz'
      },
      image: schemaImage,
    };

    res.render('news/detail', {
      title: `${displayTitle.substring(0, 62)} | ZakonExpert`,
      description: (article.meta_desc || displayExcerpt).substring(0, 160),
      canonical: article.canonical_url || `https://zakonexpert.kz/news/${article.slug}`,
      ogType: 'article',
      ogImage: articleView.display_cover,
      article: articleView,
      related,
      schema,
    });
  }));

  // POST /api/news/import — manual trigger
  app.post('/api/news/import', asyncHandler(async (req, res) => {
    if (!checkAdminKey(req, res)) return;
    if (!newsImporter) return res.status(503).json({ error: 'News module not available' });
    const count = await newsImporter.importAll();
    res.json({ ok: true, imported: count });
  }));

  // POST /api/news/clear — wipe ALL news. State-changing admin operations must
  // never be GET requests because crawlers, previews and browser prefetch can
  // invoke GET without the owner's intent.
  app.post('/api/news/clear', asyncHandler(async (req, res) => {
    if (!checkAdminKey(req, res)) return;
    if (!newsDb || !newsImporter) return res.status(503).json({ error: 'News module not available' });
    await newsDb.clearAll();
    logger.info('[Admin] News DB cleared by admin request');
    res.json({ ok: true, message: 'All news deleted. Run /api/news/import to reload.' });
  }));

  // POST /api/news/reset — wipe ALL news AND immediately re-import
  app.post('/api/news/reset', asyncHandler(async (req, res) => {
    if (!checkAdminKey(req, res)) return;
    if (!newsDb || !newsImporter) return res.status(503).json({ error: 'News module not available' });
    await newsDb.clearAll();
    logger.info('[Admin] News DB cleared, starting fresh import...');
    // Run import in background, respond immediately
    res.json({ ok: true, message: 'DB cleared. Import started in background. Check /api/news/status in 2-3 minutes.' });
    try {
      const count = await newsImporter.importAll();
      logger.info(`[Admin] Fresh import done. Imported: ${count}`);
    } catch (e) {
      logger.error('[Admin] Fresh import failed: ' + e.message);
    }
  }));

  // POST /api/news/fix-images — fetch og:image for existing articles that have none
  app.post('/api/news/fix-images', asyncHandler(async (req, res) => {
    if (!checkAdminKey(req, res)) return;
    if (!newsDb || !newsImporter) return res.status(503).json({ error: 'News module not available' });
    res.json({ ok: true, message: 'Image fetch started in background. Check logs.' });
    try {
      const articles = await newsDb.getAllWithoutImage();
      logger.info(`[fix-images] Found ${articles.length} articles without og_image`);
      let updated = 0;
      for (const a of articles) {
        const urls = [...new Set([a.source_url, a.original_url].filter(Boolean))];
        for (const url of urls) {
          try {
            const { ogImage } = await newsImporter.fetchPageMeta(url);
            const img = newsImporter.normalizeSourceImage(ogImage);
            if (img) {
              await newsDb.updateOgImage(a._id, img);
              updated++;
              if (updated % 25 === 0) logger.info(`[fix-images] Progress: ${updated} images found`);
              break;
            }
          } catch (_) {}
          await new Promise(r => setTimeout(r, 350));
        }
      }
      logger.info(`[fix-images] Done. Updated ${updated}/${articles.length}`);
    } catch (e) {
      logger.error('[fix-images] Error: ' + e.message);
    }
  }));

  // GET /api/news/status — show stats
  app.get('/api/news/status', asyncHandler(async (req, res) => {
    if (!checkAdminKey(req, res)) return;
    if (!newsDb) return res.status(503).json({ error: 'News DB not available' });
    const stats    = await newsDb.getStats();
    const latestPublishedAt = await newsDb.getLatestPublishedAt();
    const importInfo = newsImporter ? newsImporter.getLastImportInfo() : {};
    const parserReference = importInfo.lastImportTime || latestPublishedAt;
    const parserStale = !parserReference || Date.now() - new Date(parserReference).getTime() > 8 * 60 * 60 * 1000;
    const contentStale = !latestPublishedAt || Date.now() - new Date(latestPublishedAt).getTime() > 48 * 60 * 60 * 1000;
    res.json({
      ok: true,
      ...stats,
      sources: require('./config/news_sources.json').filter(s => s.enabled).length,
      lastImportTime:  importInfo.lastImportTime  || null,
      lastImportStats: importInfo.lastImportStats || null,
      importInProgress: Boolean(importInfo.importInProgress),
      latestPublishedAt,
      stale: parserStale,
      contentStale,
      env: {
        AUTO_PUBLISH_NEWS:    process.env.AUTO_PUBLISH_NEWS    || 'true',
        NEWS_MIN_RELEVANCE:   process.env.NEWS_MIN_RELEVANCE   || '0.45',
        NEWS_IMPORT_LIMIT:    process.env.NEWS_IMPORT_LIMIT    || '50',
        NEWS_USE_SOURCE_IMAGES: process.env.NEWS_USE_SOURCE_IMAGES || 'true',
      },
    });
  }));

  // Public, non-sensitive parser health check for uptime monitoring.
  app.get('/api/news/health', asyncHandler(async (_req, res) => {
    if (!newsDb) return res.status(503).json({ ok: false, error: 'News DB not available' });
    const latestPublishedAt = await newsDb.getLatestPublishedAt();
    const importInfo = newsImporter ? newsImporter.getLastImportInfo() : {};
    const parserReference = importInfo.lastImportTime || latestPublishedAt;
    const stale = !parserReference || Date.now() - new Date(parserReference).getTime() > 8 * 60 * 60 * 1000;
    res.status(stale ? 503 : 200).json({
      ok: !stale,
      scheduled: BACKGROUND_JOBS_ENABLED,
      latestPublishedAt,
      lastImportTime: importInfo.lastImportTime || null,
      importInProgress: Boolean(importInfo.importInProgress),
    });
  }));

}

module.exports = { registerNewsRoutes };
