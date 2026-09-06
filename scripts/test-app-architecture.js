'use strict';

const assert = require('assert/strict');
const { once } = require('events');
const { createApp } = require('../app/create-app');
const { loadConfig } = require('../app/config');
const { createHttpHelpers } = require('../app/http/helpers');
const { createRateLimits } = require('../app/http/rate-limits');
const { createCatalogData } = require('../app/catalog-data');
const { applyRegistryPrivacyOverride } = require('../modules/registry-privacy');
const { applyCompanyCorrection } = require('../modules/company-corrections');
const { companySlug } = require('../modules/company-slug');
const { getLocale } = require('../modules/company-i18n');
const release = require('../modules/release-config');
const expectedRoutes = require('./fixtures/http-routes.json');
const { lowContentBoost } = require('../modules/seo-blocks');

assert(!lowContentBoost({ entityLabel: '<script>test</script>' }).includes('<script>test</script>'),
  'registry labels must be escaped before being included in shared HTML');

process.env.NODE_ENV = 'production';
process.env.ADMIN_KEY = '';
process.env.ADMIN_PW = '';
process.env.TELEGRAM_VISIT_NOTIFICATIONS = '';

const errors = [];
const logger = { info() {}, warn() {}, error(message) { errors.push(String(message)); } };
const record = applyRegistryPrivacyOverride('companies', applyCompanyCorrection({
  id: 350784397,
  bin: '251140034546',
  name_ru: 'ТОО Cave Group',
  name_kk: '',
  leader: 'PRIVATE_EXECUTIVE_TEST',
  address_ru: 'PRIVATE_ADDRESS_TEST',
  activity_ru: 'Тестовая деятельность',
  registration_date: '2025-11-27',
  phone: '+7 700 111 22 33',
  email: 'private@example.test',
  status_ru: 'Зарегистрирован',
  contacts: [{ type: 'email', value: 'private@example.test' }],
  addresses: [{ value: 'PRIVATE_ADDRESS_TEST' }],
}));
record.slug = companySlug(record.id, record.name_ru);

let notifications = 0;
let checks = 0;
const services = {
  newsDb: null, newsImporter: null, notariesDb: null, bailiffsDb: null,
  importNotaries: null, importBailiffs: null, refreshNotariesRegistry: null,
  commentsDb: null, lawsDb: null, clicksDb: null, leadsDb: null, chatDb: null,
  regionLabel: () => null,
  telegram: new Proxy({}, { get: () => () => { notifications += 1; } }),
  kgdCounterparty: { configured: false },
  goszakup: { configured: false },
  companyCheckService: { async check(bin) { checks += 1; return { bin, source: 'test' }; } },
  companiesDb: {
    available: () => true,
    stats: () => ({ available: true, count: 1, updatedAt: '2026-09-04', qualityReady: true }),
    browse: () => ({ items: [record], page: 1, hasMore: false }),
    search: () => ({ items: [record], page: 1, hasMore: false }),
    findById: id => String(id) === String(record.id) ? record : null,
    redirectByOldSlug: () => null,
    regionStats: () => [],
    byRegion: () => ({ items: [], page: 1, hasMore: false, label: null }),
    sitemapChunkCount: () => 0,
    quality: () => ({ indexable: true, score: 20, missing: [] }),
  },
};
const config = {
  ...loadConfig(),
  EGOV_API_KEY: '', BACKGROUND_JOBS_ENABLED: false,
  OPEN_DATA_RECORD_CACHE_ENABLED: false, OPEN_DATA_RECORD_CACHE_WARMER_ENABLED: false,
};
const runtime = { config, logger, services };

// App construction must neither listen nor schedule startup work.
const originalSetTimeout = global.setTimeout;
let scheduled = 0;
let app;
try {
  global.setTimeout = () => { scheduled += 1; throw new Error('Unexpected startup timer'); };
  app = createApp(runtime);
} finally {
  global.setTimeout = originalSetTimeout;
}
assert.equal(scheduled, 0);
assert.equal(notifications, 0);

const routes = app._router.stack.filter(layer => layer.route).flatMap(({ route }) => {
  const paths = Array.isArray(route.path) ? route.path : [route.path];
  return paths.map(routePath => ({ path: String(routePath), methods: Object.keys(route.methods).sort() }));
});
const sortRoutes = items => items.map(item => JSON.stringify(item)).sort();
assert.deepEqual(sortRoutes(routes), sortRoutes(expectedRoutes), 'every legacy route and method must survive');

// Rate-limit state belongs to one app, never to a module singleton.
const limitsA = createRateLimits();
const limitsB = createRateLimits();
let allowed = 0;
let limited = 0;
const response = { set() {}, status(code) { assert.equal(code, 429); limited += 1; return this; }, json() {} };
for (let i = 0; i < 121; i += 1) limitsA.companySuggestLimiter({ ip: 'test-client' }, response, () => { allowed += 1; });
limitsB.companySuggestLimiter({ ip: 'test-client' }, response, () => { allowed += 1; });
assert.equal(allowed, 121);
assert.equal(limited, 1);

async function run() {
  const thrown = new Error('synthetic synchronous failure');
  let captured;
  await createHttpHelpers({ logger }).asyncHandler(() => { throw thrown; })({}, {}, error => { captured = error; });
  assert.equal(captured, thrown, 'synchronous throws must reach centralized error handling');

  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  let requests = 0;
  async function get(url, options = {}) {
    requests += 1;
    const response = await fetch(origin + url, { redirect: 'manual', ...options });
    const body = await response.text();
    assert.notEqual(response.status, 500, `${url}: unexpected server error: ${errors.at(-1) || ''}`);
    assert.equal(response.headers.get('x-powered-by'), null);
    assert(response.headers.get('content-security-policy'), `${url}: security policy lost`);
    return { response, body };
  }
  const post = (url, body) => get(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  try {
    const publicPaths = [...new Set(expectedRoutes.filter(item => item.methods.includes('get')
      && !item.path.startsWith('/api/') && !/[():\\]/.test(item.path))
      .map(item => item.path))];
    for (const url of publicPaths) await get(url);

    const catalog = createCatalogData();
    const details = [
      ['/banks/', catalog.getBanksData()[0]], ['/courts/', catalog.getCourtsData()[0]],
      ['/chambers/', catalog.getChambersData()[0]], ['/gsi/', catalog.getGsiData()[0]],
      ['/insurance/', catalog.getInsuranceData()[0]], ['/collectors/', catalog.getCollectors()[0]],
      ['/mfo/', catalog.getMfoData().mfo[0]], ['/lombards/', catalog.getMfoData().lombards[0]],
    ];
    for (const [prefix, item] of details) {
      if (!item) continue;
      const { response } = await get(prefix + item.slug);
      assert.equal(response.status, 200, `${prefix}: existing detail must render`);
    }
    for (const locale of ['kk', 'en', 'zh', 'tr']) {
      const { response, body } = await get(`/${locale}/companies`);
      assert.equal(response.status, 200);
      assert(body.includes(`lang="${getLocale(locale).hreflang}"`));
      const redirect = await get(`/${locale}/company/${record.slug}`);
      assert.equal(redirect.response.status, 301);
      assert.equal(redirect.response.headers.get('location'), `/company/${record.slug}`);
    }
    const profile = await get(`/company/${record.slug}`);
    assert.equal(profile.response.status, 200);
    assert.match(profile.response.headers.get('x-robots-tag'), /noindex/);
    assert.match(profile.body, /name="robots" content="noindex/);
    assert(profile.body.includes('Деятельность прекращена 20.08.2026'));
    for (const value of ['PRIVATE_EXECUTIVE_TEST', 'PRIVATE_ADDRESS_TEST', 'private@example.test', '77001112233', '77058762795']) {
      assert(!profile.body.includes(value), 'organization page must not leak hidden personal or site contact values');
    }
    const search = await get('/poisk?q=Cave');
    assert.equal(search.response.status, 200);
    assert.equal(search.response.headers.get('cache-control'), 'private, no-store');
    assert(!search.body.includes('PRIVATE_ADDRESS_TEST'));
    assert((await get('/poisk?q=%3Cscript%3Ealert(1)%3C%2Fscript%3E')).body.includes('&lt;script&gt;'));
    assert.equal((await get('/company/does-not-exist')).response.status, 404);
    assert.equal((await get('/data/private.sqlite')).response.status, 404);
    assert.equal((await get('/lawyer/retired')).response.status, 410);
    assert.equal((await get('/api/news/import')).response.status, 405);
    assert.equal((await post('/api/news/import', {})).response.status, 503);
    assert.equal((await post('/check', {})).response.status, 400);
    assert.equal((await post('/api/company-check', { bin: '123' })).response.status, 400);
    assert.equal((await post('/api/lead', {})).response.status, 400);
    assert.equal((await post('/api/chat/send', {})).response.status, 400);
    const firstCheck = await post('/api/company-check', { bin: '251140034546' });
    const cachedCheck = await post('/api/company-check', { bin: '251140034546' });
    assert.equal(firstCheck.response.headers.get('x-data-cache'), 'MISS');
    assert.equal(cachedCheck.response.headers.get('x-data-cache'), 'HIT');
    assert.equal(checks, 1);
    const health = JSON.parse((await get('/health')).body);
    assert.equal(health.release, release.id, 'health and release monitor must have one release identifier');
    assert.equal(notifications, 0, 'read-only tests must never contact customers or Telegram');
    console.log(`App architecture OK: ${routes.length} routes preserved, ${requests} HTTP checks, privacy and security intact`);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
