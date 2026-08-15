'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const port = 3199;
const origin = `http://127.0.0.1:${port}`;
const clicksDbPath = path.join(os.tmpdir(), `zakonexpert-smoke-clicks-${process.pid}.db`);
const server = spawn(process.execPath, ['server.js'], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    PORT: String(port),
    NODE_ENV: 'test',
    DISABLE_BACKGROUND_JOBS: 'true',
    EGOV_API_KEY: '',
    KGD_API_TOKEN: '',
    GOSZAKUP_API_TOKEN: '',
    ADMIN_KEY: '',
    ADMIN_PW: '',
    TELEGRAM_BOT_TOKEN: '',
    TELEGRAM_CHAT_ID: '',
    CLICKS_DB_PATH: clicksDbPath,
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

let logs = '';
server.stdout.on('data', chunk => { logs += chunk; });
server.stderr.on('data', chunk => { logs += chunk; });

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function waitForServer() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(`${origin}/health`, {
        headers: { 'user-agent': 'ZakonExpert-Smoke-Test' },
      });
      if (response.ok) return;
    } catch (_) {
      // The process may still be binding the port.
    }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw new Error(`Server did not become ready.\n${logs}`);
}

async function waitForStoredFunnel() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const rows = fs.readFileSync(clicksDbPath, 'utf8')
        .split('\n').filter(Boolean).map(line => JSON.parse(line));
      const stored = rows.find(row => row.funnel_version === 'v2');
      if (stored) return stored;
    } catch (_) {
      // NeDB may still be creating or atomically replacing the data file.
    }
    await new Promise(resolve => setTimeout(resolve, 40));
  }
  return null;
}

async function expectGet(path) {
  const response = await fetch(`${origin}${path}`, {
    headers: { 'user-agent': 'ZakonExpert-Smoke-Test' },
  });
  assert(response.status === 200, `${path}: expected 200, received ${response.status}`);
  const body = await response.arrayBuffer();
  assert(body.byteLength > 0, `${path}: empty response`);
}

async function expectLeanCatalog(path) {
  const response = await fetch(`${origin}${path}`, {
    headers: { 'user-agent': 'ZakonExpert-Smoke-Test' },
  });
  const body = await response.text();
  assert(response.status === 200, `${path}: expected 200, received ${response.status}`);
  assert(body.length < 200000, `${path}: HTML is still too heavy (${body.length} chars)`);
  assert(body.includes('cat-pagination'), `${path}: server pagination is missing`);
  console.log(`Catalog ${path}: ${(body.length / 1024).toFixed(1)} KB after pagination`);

  const pageTwo = await fetch(`${origin}${path}?page=2`, {
    headers: { 'user-agent': 'ZakonExpert-Smoke-Test' },
  });
  const pageTwoBody = await pageTwo.text();
  assert(pageTwo.status === 200, `${path} page 2 returned ${pageTwo.status}`);
  assert(pageTwoBody.includes(`rel="canonical" href="https://zakonexpertt.kz${path}?page=2"`),
    `${path} page 2 has an incorrect canonical URL`);
  assert(pageTwoBody.includes('aria-current="page">2</span>'),
    `${path} page 2 is not marked as current`);

  const search = await fetch(`${origin}${path}?q=астана`, {
    headers: { 'user-agent': 'ZakonExpert-Smoke-Test' },
  });
  const searchBody = await search.text();
  assert(search.status === 200, `${path} search returned ${search.status}`);
  assert(searchBody.includes('name="robots" content="noindex,follow"'),
    `${path} search results must be noindex,follow`);
}

async function expectCheck(payload, expectedStatus) {
  const response = await fetch(`${origin}/check`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'user-agent': 'ZakonExpert-Smoke-Test',
    },
    body: JSON.stringify(payload),
  });
  assert(response.status === expectedStatus,
    `/check ${JSON.stringify(payload)}: expected ${expectedStatus}, received ${response.status}`);
}

async function expectLawyerCatalog() {
  const region = encodeURIComponent('г. Алматы');
  const first = await fetch(`${origin}/lawyers?region=${region}`);
  const firstBody = await first.text();
  assert(first.status === 200, `/lawyers region returned ${first.status}`);
  assert(firstBody.length < 200000, `/lawyers region is too heavy (${firstBody.length} chars)`);
  assert(firstBody.includes('class="catalog-pagination"'), '/lawyers region pagination is missing');
  assert(firstBody.includes('официальный публичный реестр'), '/lawyers official source note is missing');

  const second = await fetch(`${origin}/lawyers?region=${region}&page=2`);
  const secondBody = await second.text();
  assert(second.status === 200, `/lawyers region page 2 returned ${second.status}`);
  assert(secondBody.includes('page=2') && secondBody.includes('aria-current="page">2</a>'),
    '/lawyers page 2 canonical or current-page marker is missing');
  console.log(`Catalog /lawyers: ${(firstBody.length / 1024).toFixed(1)} KB after pagination`);
}

async function run() {
  try {
    await waitForServer();

    const health = await (await fetch(`${origin}/health`)).json();
    assert(health.kgdApi === 'missing', 'Smoke environment must report the missing KGD token');
    assert(health.goszakupApi === 'missing', 'Smoke environment must report the missing Goszakup token');

    const routes = [
      '/',
      '/news',
      '/advocate',
      '/mediator',
      '/services',
      '/contact',
      '/dokumenty',
      '/rezultaty',
      '/notaries',
      '/bailiffs',
      '/lawyers',
      '/banks',
      '/mfo',
      '/lombards',
      '/courts',
      '/collectors',
      '/companies',
      '/kk/companies',
      '/en/companies',
      '/zh/companies',
      '/tr/companies',
      '/tools',
      '/proverka-kontragenta',
      '/marshrut-dolzhnika',
      '/tools/payment-plan',
      '/tools/mrp',
      '/tools/state-duty',
      '/tools/deadline',
      '/statyi',
      '/sitemap.xml',
      '/sitemap-news.xml',
      '/robots.txt',
      '/img/brand/zakonexpert-logo-transparent-hd.png',
      '/img/advocate-maulen.jpeg',
      '/img/mediator-nurgisa.jpeg',
      '/img/rezultaty/otmena-nadpisi-instagram-2025-09.webp',
      '/img/rezultaty/instagram-2025-09-22-111346.webp',
      '/img/rezultaty/instagram-2025-09-22-118723.webp',
      '/img/rezultaty/instagram-2025-09-22-chsi-5388.webp',
    ];
    for (const route of routes) await expectGet(route);
    for (const catalog of ['/courts', '/mfo', '/lombards', '/collectors']) {
      await expectLeanCatalog(catalog);
    }
    await expectLawyerCatalog();

    const homepageResponse = await fetch(`${origin}/`, {
      headers: { 'user-agent': 'ZakonExpert-Smoke-Test' },
    });
    const homepageHtml = await homepageResponse.text();
    assert(homepageResponse.headers.get('content-security-policy')?.includes("default-src 'self'"),
      'Homepage is missing Content-Security-Policy');
    assert(!homepageResponse.headers.has('x-powered-by'), 'Express signature is exposed');
    assert(homepageHtml.includes('class="ze-home-company-check" href="/proverka-kontragenta"'),
      'Homepage does not expose the company BIN checker above the fold');
    assert(homepageHtml.includes('data-nav-kgd') && homepageHtml.includes('href="/proverka-kontragenta"'),
      'Homepage navigation does not expose the KGD company check');
    assert(!homepageHtml.includes('class="sticky-wa"'),
      'Homepage still renders a floating round WhatsApp button');

    const imageResponse = await fetch(`${origin}/img/brand/zakonexpert-logo-transparent-hd.png`);
    assert(imageResponse.headers.get('cache-control')?.includes('max-age=604800'),
      'Static image cache policy is missing');

    const companyCatalog = await fetch(`${origin}/companies`);
    assert(companyCatalog.headers.get('cache-control')?.includes('s-maxage='),
      'Company catalog is missing shared-cache headers');
    assert(companyCatalog.headers.get('server-timing')?.includes('company-db'),
      'Company catalog is missing database timing telemetry');
    const companySearch = await fetch(`${origin}/companies?q=test`);
    assert(companySearch.headers.get('cache-control')?.includes('no-store'),
      'Unbounded company search results must not enter the shared cache');

    const companyCheckPage = await (await fetch(`${origin}/proverka-kontragenta`)).text();
    assert(companyCheckPage.includes('Проверка контрагента'), 'Counterparty page is missing its H1');
    assert(companyCheckPage.includes('/css/company-check.css?v=20260815-6')
      && companyCheckPage.includes('/js/company-check.js?v=20260815-3')
      && companyCheckPage.includes('/js/site.js?v=20260815-2'),
    'Counterparty page assets are missing');
    assert(companyCheckPage.includes('data-nav-kgd') && !companyCheckPage.includes('class="sticky-wa"'),
      'Counterparty page navigation or floating button state is incorrect');
    assert(companyCheckPage.includes('id="cc-sources"') && companyCheckPage.includes('id="cc-procurement"'),
      'Multi-source company report sections are missing');
    const companySuggest = await fetch(`${origin}/api/company-suggest?q=test`);
    assert(companySuggest.status === 200 && Array.isArray((await companySuggest.json()).items),
      'Company autocomplete endpoint is unavailable');
    const invalidCompanyCheck = await fetch(`${origin}/api/company-check`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ bin: '123' }),
    });
    assert(invalidCompanyCheck.status === 400, 'Invalid counterparty BIN must return 400');
    const disabledCompanyCheck = await fetch(`${origin}/api/company-check`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ bin: '260740044168' }),
    });
    const disabledCompanyPayload = await disabledCompanyCheck.json();
    assert(disabledCompanyCheck.status === 503 && disabledCompanyPayload.code === 'NO_OFFICIAL_DATA',
      'Counterparty API without any available official source must fail closed');

    const funnelEvent = await fetch(`${origin}/api/track-event`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'user-agent': 'Mozilla/5.0 (iPhone; Mobile)',
        'x-forwarded-for': '203.0.113.10',
      },
      body: JSON.stringify({
        type: 'click_cta_company',
        target: 'must-not-be-stored',
        page: '/en/company/7137221-alfa-pravo?bin=970540001234',
        cta: 'sidebar',
        offer_variant: 'b',
        company_name: 'must-not-be-stored',
      }),
    });
    assert((await funnelEvent.json()).ok === true, 'Company funnel event was rejected');
    const storedFunnel = await waitForStoredFunnel();
    assert(storedFunnel, 'Company funnel event was not persisted');
    assert(storedFunnel.page === '/en/company/7137221',
      `Company funnel path was not anonymized: ${storedFunnel.page}`);
    assert(storedFunnel.target === 'company-directory', 'Untrusted funnel target was persisted');
    assert(storedFunnel.page_type === 'company_card' && storedFunnel.page_locale === 'en',
      'Localized company page classification is incorrect');
    assert(storedFunnel.device_type === 'mobile' && storedFunnel.offer_variant === 'b',
      'Device or offer segmentation is incorrect');
    assert(!Object.hasOwn(storedFunnel, 'ip') && !Object.hasOwn(storedFunnel, 'ua'),
      'Privacy-safe funnel must not persist IP or raw user-agent');
    assert(!JSON.stringify(storedFunnel).includes('alfa-pravo')
      && !JSON.stringify(storedFunnel).includes('970540001234')
      && !JSON.stringify(storedFunnel).includes('must-not-be-stored'),
    'Company name, BIN or untrusted fields leaked into funnel analytics');

    const invalidFunnelEvent = await fetch(`${origin}/api/track-event`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'view_company_page', page: '/contact' }),
    });
    assert((await invalidFunnelEvent.json()).ok === false,
      'Company funnel event from a non-company page must be rejected');

    const adminStatus = await fetch(`${origin}/api/news/status`);
    assert(adminStatus.status === 503,
      `/api/news/status without ADMIN_KEY: expected 503, received ${adminStatus.status}`);
    const unsafeGet = await fetch(`${origin}/api/news/clear`);
    assert(unsafeGet.status === 405,
      `/api/news/clear GET: expected 405, received ${unsafeGet.status}`);
    const unsafeLawyerRefresh = await fetch(`${origin}/api/lawyers/refresh`);
    assert(unsafeLawyerRefresh.status === 405,
      `/api/lawyers/refresh GET: expected 405, received ${unsafeLawyerRefresh.status}`);
    const unauthenticatedPost = await fetch(`${origin}/api/news/clear`, { method: 'POST' });
    assert(unauthenticatedPost.status === 503,
      `/api/news/clear POST without ADMIN_KEY: expected 503, received ${unauthenticatedPost.status}`);
    const commentsAdmin = await fetch(`${origin}/admin/comments`);
    assert(commentsAdmin.status === 401,
      `/admin/comments without Basic auth: expected 401, received ${commentsAdmin.status}`);

    for (const missingPath of ['/lawyer/profile-does-not-exist', '/news/article-does-not-exist', '/definitely-missing']) {
      const missing = await fetch(`${origin}${missingPath}`, { redirect: 'manual' });
      const missingBody = await missing.text();
      assert(missing.status === 404, `${missingPath}: expected real 404, received ${missing.status}`);
      assert(!missing.headers.has('location'), `${missingPath}: missing page must not redirect`);
      assert(missingBody.includes('name="robots" content="noindex,follow"'),
        `${missingPath}: 404 page is missing noindex`);
    }

    const newsSitemap = await (await fetch(`${origin}/sitemap-news.xml`)).text();
    assert(newsSitemap.includes('xmlns:news="http://www.google.com/schemas/sitemap-news/0.9"'),
      'News sitemap is missing the Google News namespace');

    await expectCheck({}, 400);
    await expectCheck({ iin: '123', consent: true }, 400);
    await expectCheck({ iin: '000000000000', consent: true }, 503);

    assert(logs.includes('Background jobs disabled by DISABLE_BACKGROUND_JOBS'),
      'Smoke mode did not disable background jobs');
    assert(!logs.includes('Telegram bot polling started'),
      'Telegram polling started during smoke test');

    console.log(`Smoke test passed: ${routes.length} routes, security headers, admin protection and 3 IIN error cases.`);
  } finally {
    server.kill('SIGTERM');
    try { fs.unlinkSync(clicksDbPath); } catch (_) { /* already absent */ }
  }
}

run().catch(error => {
  console.error(error.message);
  server.kill('SIGTERM');
  process.exitCode = 1;
});
