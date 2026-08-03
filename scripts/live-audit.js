'use strict';

const ORIGIN = String(process.env.AUDIT_ORIGIN || 'https://zakonexpertt.kz').replace(/\/$/, '');
const TIMEOUT_MS = Number(process.env.AUDIT_TIMEOUT_MS || 20000);
const STABILITY_ROUNDS = Math.max(1, Number(process.env.AUDIT_STABILITY_ROUNDS || 3));
const SLOW_RESPONSE_MS = Math.max(1000, Number(process.env.AUDIT_SLOW_RESPONSE_MS || 8000));
const EXPECTED_RELEASE = process.env.AUDIT_EXPECTED_RELEASE
  || '2026-08-04-company-sitemap-row-repair';

const publicRoutes = [
  '/', '/news', '/dokumenty', '/rezultaty', '/advocate', '/mediator', '/contact',
  '/notaries', '/bailiffs', '/lawyers', '/banks', '/mfo', '/collectors',
  '/lombards', '/companies', '/courts', '/chambers', '/zakony', '/statyi', '/tools',
  '/kk/companies', '/en/companies', '/zh/companies', '/tr/companies',
  '/marshrut-dolzhnika',
  '/tools/payment-plan', '/tools/mrp', '/tools/state-duty', '/tools/deadline',
];
const stabilityRoutes = [
  '/health', '/notaries', '/bailiffs', '/lawyers',
  '/companies', '/en/companies', '/zakony', '/statyi', '/tools', '/marshrut-dolzhnika',
];

const failures = [];
const warnings = [];

function record(list, message) {
  list.push(message);
  console.log(`${list === failures ? 'ERROR' : 'WARN '} ${message}`);
}

async function request(pathname, options = {}) {
  const started = Date.now();
  const response = await fetch(`${ORIGIN}${pathname}`, {
    redirect: options.redirect || 'follow',
    headers: { 'user-agent': 'ZakonExpert-Live-Audit/1.0', ...(options.headers || {}) },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    method: options.method || 'GET',
  });
  const body = await response.text();
  return { response, body, ms: Date.now() - started };
}

function hasTag(html, pattern) {
  return pattern.test(html);
}

async function auditPublicRoute(pathname) {
  try {
    const { response, body, ms } = await request(pathname);
    const type = response.headers.get('content-type') || '';
    console.log(`${response.status} ${String(ms).padStart(5)}ms ${String(body.length).padStart(8)} chars ${pathname}`);
    if (response.status !== 200) record(failures, `${pathname} returned ${response.status}`);
    if (type.includes('text/html')) {
      if (!hasTag(body, /<h1\b/i)) record(failures, `${pathname} has no H1`);
      if (!hasTag(body, /<title>[^<]{8,}<\/title>/i)) record(failures, `${pathname} has no useful title`);
      if (!hasTag(body, /<link[^>]+rel=["']canonical["']/i)) record(failures, `${pathname} has no canonical`);
      if (!hasTag(body, /<meta[^>]+name=["']description["']/i)) record(warnings, `${pathname} has no meta description`);
      if (body.length > 450000) record(warnings, `${pathname} HTML is heavy (${Math.round(body.length / 1024)} KB)`);
      if (pathname === '/companies' && !/href=["']\/company\/\d+-/i.test(body)) {
        record(failures, '/companies has no organization cards; catalog activation is missing');
      }
    }
  } catch (error) {
    record(failures, `${pathname} failed: ${error.message}`);
  }
}

async function auditSecurity() {
  // Plesk/nginx serves physical files (including public/index.html) before a
  // request reaches Passenger. Verify application-owned security headers on a
  // dynamic route instead of falsely attributing the static nginx response to
  // Express. Infrastructure headers are managed in Plesk, not by server.js.
  const { response: appPage } = await request('/companies');
  if (!appPage.headers.get('content-security-policy')) {
    record(failures, 'Content-Security-Policy is missing on the dynamic application');
  }
  const poweredBy = appPage.headers.get('x-powered-by') || '';
  if (/express/i.test(poweredBy)) record(warnings, 'X-Powered-By exposes Express');

  const { response: status } = await request('/api/news/status');
  if (![403, 503].includes(status.status)) record(failures, `/api/news/status is public (${status.status})`);

  // State-changing admin routes are deliberately not called by a live audit.
  // Their POST-only behavior is locked by the local smoke test.
}

async function auditSitemaps() {
  const { response, body } = await request('/sitemap-index.xml');
  if (response.status !== 200) return record(failures, `sitemap index returned ${response.status}`);
  const maps = [...body.matchAll(/<loc>([^<]+)<\/loc>/g)].map(match => match[1]);
  const companyMaps = maps.filter(url => /sitemap-companies-\d+\.xml$/.test(url));
  console.log(`Sitemaps: ${maps.length}; company chunks: ${companyMaps.length}`);
  if (!companyMaps.length) {
    record(failures, 'Company sitemap has no chunks; quality metadata is not activated');
  }
  const sample = [
    '/sitemap-pages.xml', '/sitemap-news.xml', '/sitemap-laws.xml',
    companyMaps[0]?.replace(ORIGIN, ''),
    companyMaps[Math.floor(companyMaps.length / 2)]?.replace(ORIGIN, ''),
    companyMaps.at(-1)?.replace(ORIGIN, ''),
  ].filter(Boolean);
  for (const pathname of sample) {
    try {
      const result = await request(pathname);
      console.log(`${result.response.status} ${String(result.ms).padStart(5)}ms ${pathname}`);
      if (result.response.status !== 200) record(failures, `${pathname} returned ${result.response.status}`);
      if (!/<urlset\b/i.test(result.body)) record(failures, `${pathname} is not a URL set`);
    } catch (error) {
      record(failures, `${pathname} failed: ${error.message}`);
    }
  }
}

async function auditNewsDetail() {
  const list = await request('/news');
  const href = list.body.match(/href=["'](\/news\/(?!(?:category\/|cover\/|feed\.xml(?:["']|$)))[^"'#?]+)["']/i)?.[1];
  if (!href) return record(warnings, 'No news detail link found');
  const detail = await request(href);
  for (const heading of ['Что произошло', 'Почему это важно', 'Юридический разбор', 'Что проверить']) {
    if (!detail.body.includes(heading)) record(failures, `${href} is missing section: ${heading}`);
  }
  if (!/NewsArticle/.test(detail.body)) record(failures, `${href} has no NewsArticle schema`);
}

async function auditTechnicalFiles() {
  const checks = [
    ['/robots.txt', /sitemap-index\.xml/i],
    ['/ads.txt', /google\.com,\s*pub-/i],
  ];
  for (const [pathname, expected] of checks) {
    try {
      const { response, body, ms } = await request(pathname);
      console.log(`${response.status} ${String(ms).padStart(5)}ms ${String(body.length).padStart(8)} chars ${pathname}`);
      if (response.status !== 200) record(failures, `${pathname} returned ${response.status}`);
      if (!expected.test(body)) record(failures, `${pathname} is missing expected content`);
    } catch (error) {
      record(failures, `${pathname} failed: ${error.message}`);
    }
  }
}

async function auditRelease() {
  try {
    const { response, body } = await request('/health');
    if (response.status !== 200) {
      record(failures, `/health returned ${response.status}`);
      return false;
    }
    const health = JSON.parse(body);
    if (health.release !== EXPECTED_RELEASE) {
      record(
        failures,
        `Passenger is serving stale code: expected ${EXPECTED_RELEASE}, received ${health.release || 'no release id'}`
      );
      return false;
    }
    console.log(`Release: ${health.release}`);
    if (health.companies) {
      console.log(
        `Companies: ${health.companies.count} records; `
        + `${health.companies.indexableCount} indexable; qualityReady=${health.companies.qualityReady}`
      );
      if (health.companies.available && !health.companies.qualityReady) {
        record(failures, 'Company quality version is not activated');
      } else if (health.companies.count > 0 && health.companies.indexableCount < 1) {
        record(failures, 'Company quality rows are stale; run backfill-company-quality offline');
      }
    }
    return true;
  } catch (error) {
    record(failures, `/health release check failed: ${error.message}`);
    return false;
  }
}

async function auditStability() {
  console.log(`Stability: ${STABILITY_ROUNDS} rounds × ${stabilityRoutes.length} routes`);
  for (let round = 1; round <= STABILITY_ROUNDS; round += 1) {
    for (const pathname of stabilityRoutes) {
      try {
        const { response, body, ms } = await request(pathname);
        console.log(`round ${round} ${response.status} ${String(ms).padStart(5)}ms ${String(body.length).padStart(8)} chars ${pathname}`);
        if (response.status !== 200) record(failures, `${pathname} stability round ${round} returned ${response.status}`);
        if (!body.trim()) record(failures, `${pathname} stability round ${round} returned an empty body`);
        const type = response.headers.get('content-type') || '';
        if (type.includes('text/html') && !/<\/html>\s*$/i.test(body)) {
          record(failures, `${pathname} stability round ${round} returned incomplete HTML`);
        }
        if (ms > SLOW_RESPONSE_MS) {
          record(warnings, `${pathname} stability round ${round} was slow (${ms} ms)`);
        }
      } catch (error) {
        record(failures, `${pathname} stability round ${round} failed: ${error.message}`);
      }
    }
  }
}

(async () => {
  console.log(`Auditing ${ORIGIN}`);
  if (!await auditRelease()) {
    console.log(`\nResult: ${failures.length} errors, ${warnings.length} warnings`);
    process.exitCode = 1;
    return;
  }
  for (const route of publicRoutes) await auditPublicRoute(route);
  await auditSecurity();
  await auditSitemaps();
  await auditNewsDetail();
  await auditTechnicalFiles();
  await auditStability();
  console.log(`\nResult: ${failures.length} errors, ${warnings.length} warnings`);
  if (failures.length) process.exitCode = 1;
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
