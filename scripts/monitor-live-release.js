'use strict';

const DEFAULT_ORIGIN = 'https://zakonexpert.kz';
const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_SLOW_MS = 4000;
const HTML_PAGES = {
  homepage: '/',
  contact: '/contact',
  reviews: '/reviews',
  kaspi: '/arest-kaspi',
  halyk: '/arest-halyk-bank',
  accountArrest: '/snyatie-aresta-so-scheta',
  enforcementInscription: '/otmena-ispolnitelnoi-nadpisi',
  notary: '/notary/zhanadilov-aset-dyusenovich',
};
const LEGACY_REDIRECTS = [
  ['https://zakonexpertt.kz/', '/'],
  ['https://zakonexpertt.kz/arest-kaspi?redirect_check=monitor', '/arest-kaspi?redirect_check=monitor'],
  ['https://www.zakonexpertt.kz/arest-halyk-bank', '/arest-halyk-bank'],
  ['http://zakonexpertt.kz/snyatie-aresta-so-scheta', '/snyatie-aresta-so-scheta'],
  ['http://www.zakonexpertt.kz/notary/zhanadilov-aset-dyusenovich', HTML_PAGES.notary],
  ['https://zakonexpertt.kz/ispolnitelnaya-nadpis.html', HTML_PAGES.enforcementInscription, '/ispolnitelnaya-nadpis.html'],
];

function normalizeOrigin(value) {
  return String(value || DEFAULT_ORIGIN).replace(/\/+$/, '');
}

function htmlAttribute(tag, name) {
  return tag.match(new RegExp(`\\s${name}\\s*=\\s*(["'])(.*?)\\1`, 'i'))?.[2];
}

function validateHtml(response, body, url) {
  if (!response.headers.get('content-type')?.includes('text/html')) return 'expected HTML';

  const canonical = (body.match(/<link\b[^>]*>/gi) || [])
    .find((tag) => htmlAttribute(tag, 'rel')?.toLowerCase() === 'canonical');
  if (!canonical || htmlAttribute(canonical, 'href') !== url) return `expected canonical ${url}`;

  const robots = (body.match(/<meta\b[^>]*>/gi) || [])
    .find((tag) => htmlAttribute(tag, 'name')?.toLowerCase() === 'robots');
  const indexDirectives = [response.headers.get('x-robots-tag'), robots && htmlAttribute(robots, 'content')];
  if (indexDirectives.some((value) => /\b(?:noindex|none)\b/i.test(value || ''))) {
    return 'page disallows indexing';
  }
}

async function checkLiveRelease(options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  const origin = normalizeOrigin(options.origin || process.env.MONITOR_ORIGIN);
  const timeoutMs = Number(options.timeoutMs || process.env.MONITOR_TIMEOUT_MS || DEFAULT_TIMEOUT_MS);
  const slowMs = Number(options.slowMs || process.env.MONITOR_SLOW_MS || DEFAULT_SLOW_MS);
  const expectedRelease = options.expectedRelease || process.env.MONITOR_EXPECTED_RELEASE || null;
  const errors = [];
  const warnings = [];
  const checks = {};

  async function checkResponse(url, accept, expectedStatus, validate) {
    const startedAt = Date.now();
    const result = { url, status: null };
    try {
      const response = await fetchImpl(url, {
        redirect: 'manual',
        headers: { accept, 'user-agent': 'ZakonExpert-Release-Monitor/1.0' },
        signal: AbortSignal.timeout(timeoutMs),
      });
      result.status = response.status;
      result.server = response.headers.get('server');
      result.location = response.headers.get('location');
      const body = await response.text();

      if (/BitNinja Captcha Server/i.test(result.server || '') || /<title>\s*Visitor anti-robot validation\s*<\/title>/i.test(body)) {
        result.error = `BitNinja challenge (HTTP ${result.status})`;
      } else if (result.status !== expectedStatus) {
        result.error = `HTTP ${result.status}, expected ${expectedStatus}`;
      } else {
        result.error = validate(response, body, url);
      }
    } catch (error) {
      result.error = error.message;
    }
    result.ms = Date.now() - startedAt;
    if (result.error) errors.push(`${url}: ${result.error}`);
    if (result.ms > slowMs) warnings.push(`${url}: slow response (${result.ms} ms)`);
    return result;
  }

  checks.health = await checkResponse(`${origin}/health`, 'application/json', 200, (response, body) => {
    if (!response.headers.get('content-type')?.includes('application/json')) return 'expected JSON';
    const payload = JSON.parse(body);
    checks.release = payload?.release || null;
    checks.serviceStatus = payload?.status || null;
    if (checks.serviceStatus !== 'ok') return `service status is ${checks.serviceStatus || 'missing'}`;
    if (!checks.release) return 'release identifier is missing';
    if (expectedRelease && checks.release !== expectedRelease) {
      return `stale release: expected ${expectedRelease}, received ${checks.release}`;
    }
  });

  for (const [name, pathname] of Object.entries(HTML_PAGES)) {
    checks[name] = await checkResponse(`${origin}${pathname}`, 'text/html', 200, validateHtml);
  }

  const sitemapUrl = `${origin}/sitemap-index.xml`;
  checks.robots = await checkResponse(`${origin}/robots.txt`, 'text/plain', 200, (response, body) => {
    if (!response.headers.get('content-type')?.includes('text/plain')) return 'expected plain text';
    if (!body.split(/\r?\n/).some((line) => line.trim() === `Sitemap: ${sitemapUrl}`)) {
      return `missing Sitemap: ${sitemapUrl}`;
    }
  });
  checks.sitemap = await checkResponse(sitemapUrl, 'application/xml', 200, (response, body) => {
    if (!response.headers.get('content-type')?.match(/\b(?:application|text)\/xml\b/i)) return 'expected XML';
    if (!/<sitemapindex\b/i.test(body) || !body.includes(`<loc>${origin}/`)) {
      return `expected sitemap index with URLs on ${origin}`;
    }
  });

  if (origin === DEFAULT_ORIGIN) {
    checks.redirects = [];
    for (const [source, pathname, alias] of LEGACY_REDIRECTS) {
      const destination = `${origin}${pathname}`;
      const intermediate = alias && `${origin}${alias}`;
      const result = await checkResponse(source, 'text/html', 301, (response) => {
        const location = response.headers.get('location');
        if (location !== destination && location !== intermediate) {
          return `expected Location ${destination}, received ${location || 'none'}`;
        }
      });
      if (!result.error && intermediate && result.location === intermediate) {
        // The old host may keep the filename, then the new application resolves the known alias.
        result.nextHop = await checkResponse(intermediate, 'text/html', 301, (response) => {
          const location = response.headers.get('location');
          if (!location || new URL(location, intermediate).href !== destination) {
            return `expected Location ${destination}, received ${location || 'none'}`;
          }
        });
      }
      checks.redirects.push({ ...result, destination });
    }
  }

  return {
    checkedAt: new Date().toISOString(),
    checks,
    errors,
    expectedRelease,
    ok: errors.length === 0,
    origin,
    warnings,
  };
}

async function main() {
  const report = await checkLiveRelease();
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exitCode = 1;
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = { checkLiveRelease, normalizeOrigin };
