'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ejs = require('ejs');

const root = path.join(__dirname, '..');

async function run() {
  const html = await ejs.renderFile(path.join(root, 'views', 'debt-route.ejs'));
  const script = fs.readFileSync(path.join(root, 'public', 'js', 'debt-route.js'), 'utf8');
  const homepage = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
  const server = require('./lib/source-files').readServerSource();

  assert(html.includes('<h1>Что делать с долгом именно на вашей стадии</h1>'));
  assert(html.includes('https://zakonexpertt.kz/marshrut-dolzhnika'));
  assert(html.includes('data-debt-route'));
  assert(html.includes('77058762795'));
  assert(!html.includes('гарантия результата'));
  assert.doesNotThrow(() => new Function(script), 'debt route client JavaScript is invalid');

  for (const key of ['overdue', 'collectors', 'notary', 'court', 'bailiff', 'restrictions', 'paid']) {
    assert(script.includes(`${key}: {`), `${key}: route config is missing`);
  }
  assert(script.includes("ZE_trackEvent('debt_route_selected'"), 'route selection analytics is missing');
  assert(script.includes("ZE_trackEvent('debt_route_whatsapp'"), 'route WhatsApp analytics is missing');
  assert(homepage.includes('/marshrut-dolzhnika'), 'homepage entry point is missing');
  assert(server.includes("app.get('/marshrut-dolzhnika'"), 'Express route is missing');
  assert(server.includes("{ url: '/marshrut-dolzhnika'"), 'sitemap entry is missing');

  console.log('Debt route OK: seven stages, SEO, homepage entry point and analytics');
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
