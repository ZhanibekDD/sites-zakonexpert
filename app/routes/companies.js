'use strict';

const { INDEXABLE_LOCALES: COMPANY_LOCALES, catalogAlternates, catalogPath: companyCatalogPathFor, companyPath: companyPathFor, getLocale: getCompanyLocale } = require('../../modules/company-i18n');

function registerCompanyRoutes(app, dependencies) {
  const { companiesDb, regionLabel, sendNotFound, companySuggestLimiter } = dependencies;

  function companyLanguageLinks(companySlug = null) {
    return COMPANY_LOCALES.map(code => {
      const language = getCompanyLocale(code);
      return {
        code,
        nativeName: language.nativeName,
        href: companyCatalogPathFor(code),
        companyHref: companySlug
          ? (code === 'ru' ? companyPathFor('ru', companySlug) : companyCatalogPathFor(code))
          : companyCatalogPathFor(code),
      };
    });
  }

  function setCompanyCache(res, cacheable, maxAge = 300) {
    if (!cacheable) {
      res.set('Cache-Control', 'private, no-store');
      return;
    }
    res.set(
      'Cache-Control',
      `public, max-age=${maxAge}, s-maxage=${Math.max(maxAge, 900)}, stale-while-revalidate=86400`
    );
  }

  function setCompanyDbTiming(res, started) {
    const durationMs = Number(process.hrtime.bigint() - started) / 1e6;
    res.set('Server-Timing', `company-db;dur=${durationMs.toFixed(1)}`);
  }

  function renderCompaniesCatalog(req, res, localeCode = 'ru') {
    const started = process.hrtime.bigint();
    const locale = getCompanyLocale(localeCode);
    const query = String(req.query.q || '').trim().slice(0, 120);
    const page = Number.parseInt(req.query.page, 10) || 1;
    const stats = companiesDb
      ? companiesDb.stats()
      : {
        available: false, count: 0, updatedAt: null, source: null,
        officialCount: 0, directoryOnlyCount: 0, withContactsCount: 0,
      };
    const results = companiesDb
      ? (query ? companiesDb.search(query, page, 30) : companiesDb.browse(page, 30))
      : { items: [], page: 1, hasMore: false };
    setCompanyCache(res, !query, 120);
    setCompanyDbTiming(res, started);
    res.render('companies/catalog', {
      query,
      results,
      stats,
      locale,
      copy: locale,
      alternates: catalogAlternates(),
      languages: companyLanguageLinks(),
      companyCatalogPath: companyCatalogPathFor(locale.code),
      companyItemPrefix: '/company/',
    });
  }

  function renderCompanyItem(req, res, localeCode = 'ru') {
    const started = process.hrtime.bigint();
    if (!companiesDb || !companiesDb.available()) return sendNotFound(res);
    const locale = getCompanyLocale(localeCode);
    const id = String(req.params.slug || '').match(/^(\d+)/)?.[1];
    let company = id ? companiesDb.findById(id) : null;
    if (!company) {
      const redirect = companiesDb.redirectByOldSlug(req.params.slug);
      if (redirect) return res.redirect(301, companyPathFor(locale.code, redirect.slug));
      return sendNotFound(res);
    }
    if (company.slug !== req.params.slug) {
      return res.redirect(301, companyPathFor(locale.code, company.slug));
    }
    const sourceUpdatedAt = companiesDb.stats().updatedAt;
    const regionName = company.region_slug ? regionLabel(company.region_slug) : null;
    const companyQuality = companiesDb.quality(company);
    setCompanyCache(res, true, 300);
    if (company.privacy_noindex) {
      res.set('X-Robots-Tag', 'noindex, nofollow, noarchive');
    }
    setCompanyDbTiming(res, started);
    return res.render('companies/item', {
      company,
      sourceUpdatedAt,
      regionName,
      companyQuality,
      localized: locale.code !== 'ru',
      locale,
      copy: locale,
      languages: companyLanguageLinks(company.slug),
      companyCatalogPath: companyCatalogPathFor(locale.code),
    });
  }

  app.get('/companies', (req, res) => renderCompaniesCatalog(req, res, 'ru'));
  app.get('/api/company-suggest', companySuggestLimiter, (req, res) => {
    res.set('Cache-Control', 'private, no-store');
    const query = String(req.query.q || '').trim().slice(0, 120);
    if (!companiesDb || !companiesDb.available() || query.length < 2) {
      return res.json({ items: [] });
    }
    const cleanSummary = (value, limit = 180) => {
      const text = String(value || '').replace(/\s+/g, ' ').trim();
      return text ? text.slice(0, limit) : null;
    };
    const items = companiesDb.search(query, 1, 14).items.map(company => ({
      bin: company.bin,
      name: company.name_ru || company.name_kk,
      activity: cleanSummary(company.activity_ru),
      status: cleanSummary(company.status_ru, 90),
      leader: cleanSummary(company.leader, 140),
      address: cleanSummary(company.address_ru, 220),
      phone: cleanSummary(company.mobile_phone || company.phone, 90),
      email: cleanSummary(company.email, 120),
      website: cleanSummary(company.website, 160),
      url: `/company/${company.slug}`,
    }));
    return res.json({ items });
  });
  app.get('/:locale(kk|en|zh|tr)/companies', (req, res) => {
    renderCompaniesCatalog(req, res, req.params.locale);
  });

  app.get('/companies/regions', (req, res) => {
    if (!companiesDb || !companiesDb.available()) return res.redirect('/companies');
    const started = process.hrtime.bigint();
    const regions = companiesDb.regionStats();
    const stats = companiesDb.stats();
    setCompanyCache(res, true, 300);
    setCompanyDbTiming(res, started);
    res.render('companies/regions', { regions, stats });
  });

  app.get('/companies/region/:slug', (req, res) => {
    if (!companiesDb || !companiesDb.available()) return res.redirect('/companies');
    const started = process.hrtime.bigint();
    const page = Number.parseInt(req.query.page, 10) || 1;
    const results = companiesDb.byRegion(req.params.slug, page, 30);
    if (!results.label) return sendNotFound(res);
    setCompanyCache(res, true, 300);
    setCompanyDbTiming(res, started);
    res.render('companies/region', { slug: req.params.slug, results });
  });

  app.get('/:locale(kk|en|zh|tr)/company/:slug', (req, res) => {
    let canonicalSlug = req.params.slug;
    if (companiesDb && companiesDb.available()) {
      const id = String(req.params.slug || '').match(/^(\d+)/)?.[1];
      const company = id ? companiesDb.findById(id) : null;
      const redirect = company ? null : companiesDb.redirectByOldSlug(req.params.slug);
      canonicalSlug = company?.slug || redirect?.slug || canonicalSlug;
    }
    res.redirect(301, `/company/${canonicalSlug}`);
  });
  app.get('/company/:slug', (req, res) => renderCompanyItem(req, res, 'ru'));

}

module.exports = { registerCompanyRoutes };
