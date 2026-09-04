'use strict';

const assert = require('assert');
const releaseConfig = require('../modules/release-config');
const { checkLiveRelease, normalizeOrigin } = require('./monitor-live-release');

function response(body, options = {}) {
  return {
    headers: new Headers({
      'content-type': options.contentType || 'text/html; charset=utf-8',
    }),
    status: options.status || 200,
    text: async () => body,
    url: `https://zakonexpert.kz${options.pathname || '/'}`,
  };
}

function createFetch({ release = releaseConfig.id, assets = releaseConfig.assets } = {}) {
  return async (url) => {
    const pathname = new URL(url).pathname;
    if (pathname === '/health') {
      return response(JSON.stringify({ status: 'ok', release }), {
        contentType: 'application/json; charset=utf-8',
        pathname,
      });
    }
    if (pathname === '/') {
      const body = [...assets, ...releaseConfig.requiredHomepageText].join('\n');
      return response(body, { pathname });
    }
    return response('<h1>OK</h1>', { pathname });
  };
}

(async () => {
  assert.equal(normalizeOrigin('https://example.com///'), 'https://example.com');

  const healthy = await checkLiveRelease({ fetchImpl: createFetch(), origin: 'https://zakonexpert.kz' });
  assert.equal(healthy.ok, true, healthy.errors.join('; '));
  assert.equal(healthy.checks.release, releaseConfig.id);

  const stale = await checkLiveRelease({
    fetchImpl: createFetch({ release: 'old-release', assets: [] }),
    origin: 'https://zakonexpert.kz',
  });
  assert.equal(stale.ok, false);
  assert(stale.errors.some((message) => message.includes('stale release')));
  assert(stale.errors.some((message) => message.includes('release asset')));

  console.log('Live release monitor tests passed');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
