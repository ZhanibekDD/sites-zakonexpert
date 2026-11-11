'use strict';

const assert = require('node:assert/strict');
const { checkLiveRelease, normalizeOrigin } = require('./monitor-live-release');

const origin = 'https://zakonexpert.kz';
const oldOrigin = 'https://zakonexpertt.kz';
const kaspi = '/arest-kaspi?redirect_check=monitor';
const inscriptionAlias = '/ispolnitelnaya-nadpis.html';
const inscriptionPage = '/otmena-ispolnitelnoi-nadpisi';

function response(body, contentType, options = {}) {
  const { headers, status } = options;
  return new Response(body, { status, headers: { 'content-type': contentType, ...headers } });
}

function redirect(location, status = 301) {
  return response('', 'text/html', { status, headers: { location } });
}

function createFetch({ release = 'current-production-release', overrides = new Map() } = {}) {
  return async (url, options) => {
    assert.equal(options.redirect, 'manual');
    if (overrides.has(url)) return overrides.get(url);

    const { hostname, pathname, search } = new URL(url);
    if (hostname.endsWith('zakonexpertt.kz')) return redirect(`${origin}${pathname}${search}`);
    if (pathname === inscriptionAlias) return redirect(inscriptionPage);
    if (pathname === '/health') {
      return response(JSON.stringify({ status: 'ok', release }), 'application/json');
    }
    if (pathname === '/robots.txt') {
      return response(`User-agent: *\nAllow: /\nSitemap: ${origin}/sitemap-index.xml`, 'text/plain');
    }
    if (pathname === '/sitemap-index.xml') {
      return response(`<sitemapindex><sitemap><loc>${origin}/sitemap-pages.xml</loc></sitemap></sitemapindex>`, 'application/xml');
    }
    return response(`<link href='${url}' rel='canonical'><h1>OK</h1>`, 'text/html');
  };
}

(async () => {
  assert.equal(normalizeOrigin('https://example.com///'), 'https://example.com');

  const healthy = await checkLiveRelease({ fetchImpl: createFetch() });
  assert.equal(healthy.ok, true, healthy.errors.join('\n'));
  assert.equal(healthy.origin, origin);
  assert.equal(healthy.expectedRelease, null);
  assert.equal(healthy.checks.release, 'current-production-release');
  assert.equal(healthy.checks.redirects.length, 6);
  const alias = healthy.checks.redirects.find((check) => check.url.endsWith(inscriptionAlias));
  assert.equal(alias.nextHop.location, inscriptionPage);

  const stale = await checkLiveRelease({
    fetchImpl: createFetch({ release: 'old-release' }),
    expectedRelease: 'deployed-release',
  });
  assert.deepEqual(stale.errors, [`${origin}/health: stale release: expected deployed-release, received old-release`]);

  const challenged = await checkLiveRelease({
    fetchImpl: createFetch({
      overrides: new Map([
        [`${origin}/health`, response('Blocked', 'text/html', { status: 403, headers: { server: 'BitNinja Captcha Server' } })],
        [`${origin}/robots.txt`, response('User-agent: *\nDisallow: /', 'text/plain', { headers: { server: 'BitNinja Captcha Server' } })],
        [`${oldOrigin}/`, response('<title>Visitor anti-robot validation</title>', 'text/html', { status: 403 })],
      ]),
    }),
  });
  assert.deepEqual(challenged.errors, [
    `${origin}/health: BitNinja challenge (HTTP 403)`,
    `${origin}/robots.txt: BitNinja challenge (HTTP 200)`,
    `${oldOrigin}/: BitNinja challenge (HTTP 403)`,
  ]);

  const brokenMigration = await checkLiveRelease({
    fetchImpl: createFetch({
      overrides: new Map([
        [`${origin}/arest-kaspi`, response(`<link rel="canonical" href="${oldOrigin}/arest-kaspi">`, 'text/html')],
        [`${origin}/arest-halyk-bank`, response(`<link rel="canonical" href="${origin}/arest-halyk-bank">`, 'text/html', { headers: { 'x-robots-tag': 'noindex, follow' } })],
        [`${oldOrigin}${kaspi}`, redirect(`${origin}/arest-kaspi`)],
        [`${origin}${inscriptionAlias}`, redirect('/')],
      ]),
    }),
  });
  assert.equal(brokenMigration.ok, false);
  assert.deepEqual(brokenMigration.errors, [
    `${origin}/arest-kaspi: expected canonical ${origin}/arest-kaspi`,
    `${origin}/arest-halyk-bank: page disallows indexing`,
    `${oldOrigin}${kaspi}: expected Location ${origin}${kaspi}, received ${origin}/arest-kaspi`,
    `${origin}${inscriptionAlias}: expected Location ${origin}${inscriptionPage}, received /`,
  ]);

  const directAlias = await checkLiveRelease({
    fetchImpl: createFetch({ overrides: new Map([[`${oldOrigin}${inscriptionAlias}`, redirect(`${origin}${inscriptionPage}`)]]) }),
  });
  assert.equal(directAlias.ok, true, directAlias.errors.join('\n'));

  console.log('Live release monitor tests passed');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
