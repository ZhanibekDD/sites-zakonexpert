'use strict';

const { spawn } = require('child_process');

const port = 3199;
const origin = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ['server.js'], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    PORT: String(port),
    NODE_ENV: 'test',
    DISABLE_BACKGROUND_JOBS: 'true',
    EGOV_API_KEY: '',
    ADMIN_KEY: '',
    ADMIN_PW: '',
    TELEGRAM_BOT_TOKEN: '',
    TELEGRAM_CHAT_ID: '',
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
    assert(homepageResponse.headers.get('content-security-policy')?.includes("default-src 'self'"),
      'Homepage is missing Content-Security-Policy');
    assert(!homepageResponse.headers.has('x-powered-by'), 'Express signature is exposed');

    const imageResponse = await fetch(`${origin}/img/brand/zakonexpert-logo-transparent-hd.png`);
    assert(imageResponse.headers.get('cache-control')?.includes('max-age=604800'),
      'Static image cache policy is missing');

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
    await expectCheck({ iin: '123' }, 400);
    await expectCheck({ iin: '000000000000' }, 503);

    assert(logs.includes('Background jobs disabled by DISABLE_BACKGROUND_JOBS'),
      'Smoke mode did not disable background jobs');
    assert(!logs.includes('Telegram bot polling started'),
      'Telegram polling started during smoke test');

    console.log(`Smoke test passed: ${routes.length} routes, security headers, admin protection and 3 IIN error cases.`);
  } finally {
    server.kill('SIGTERM');
  }
}

run().catch(error => {
  console.error(error.message);
  server.kill('SIGTERM');
  process.exitCode = 1;
});
