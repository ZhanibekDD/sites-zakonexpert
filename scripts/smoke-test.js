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

    await expectCheck({}, 400);
    await expectCheck({ iin: '123' }, 400);
    await expectCheck({ iin: '000000000000' }, 503);

    assert(logs.includes('Background jobs disabled by DISABLE_BACKGROUND_JOBS'),
      'Smoke mode did not disable background jobs');
    assert(!logs.includes('Telegram bot polling started'),
      'Telegram polling started during smoke test');

    console.log(`Smoke test passed: ${routes.length} routes and 3 IIN error cases.`);
  } finally {
    server.kill('SIGTERM');
  }
}

run().catch(error => {
  console.error(error.message);
  server.kill('SIGTERM');
  process.exitCode = 1;
});
