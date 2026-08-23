'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ejs = require('ejs');
const { TOOLS } = require('../modules/tools-catalog');

const root = path.join(__dirname, '..');

async function run() {
  const html = await ejs.renderFile(path.join(root, 'views', 'arrest-diagnostic.ejs'));
  const script = fs.readFileSync(path.join(root, 'public', 'js', 'arrest-diagnostic.js'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'public', 'css', 'arrest-diagnostic.css'), 'utf8');
  const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
  const homepage = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
  const arrestPillar = fs.readFileSync(path.join(root, 'public', 'snyatie-aresta-so-scheta.html'), 'utf8');
  const bankHub = fs.readFileSync(path.join(root, 'views', 'partials', 'bank-arrest-hub-body.ejs'), 'utf8');

  assert(html.includes('<h1>Диагностика ареста счёта:'), 'H1 must begin with the search intent');
  assert(html.includes('<link rel="canonical" href="https://zakonexpertt.kz/diagnostika-aresta">'), 'Canonical is missing');
  assert(html.includes('WebApplication') && html.includes('FAQPage') && html.includes('BreadcrumbList'), 'Structured data is incomplete');
  assert(html.includes('/css/arrest-diagnostic.css?v=20260824-1'), 'Dedicated stylesheet is missing');
  assert(html.includes('/js/arrest-diagnostic.js?v=20260824-1'), 'Dedicated script is missing');
  assert.strictEqual((html.match(/data-answer="symptom"/g) || []).length, 5, 'Five symptom choices are required');
  assert.strictEqual((html.match(/data-answer="source"/g) || []).length, 5, 'Five source choices are required');
  assert.strictEqual((html.match(/data-answer="payment"/g) || []).length, 4, 'Four payment choices are required');
  assert.strictEqual((html.match(/<details>/g) || []).length, 4, 'Visible FAQ and schema must remain aligned');
  assert(html.includes('предоплатой 50%'), 'The agreed commercial model is missing');
  assert(html.includes('77003097566'), 'Current WhatsApp number is missing');
  assert(html.includes('https://www.adilet.zan.kz/rus/docs/Z100000261_'), 'Official law source is missing');
  assert(html.includes('https://aisoip.adilet.gov.kz'), 'Official enforcement registry is missing');

  assert(!/<form\b/i.test(html), 'Diagnostic must not submit a form');
  assert(!/<input\b/i.test(html), 'Diagnostic must not request personal data');
  assert(!/type=["']file["']/i.test(html), 'Diagnostic must not upload documents');
  assert(!script.includes('/api/'), 'Diagnostic answers must not be sent to a custom API');
  assert(!script.includes('FormData'), 'Diagnostic must not create an upload payload');
  assert.doesNotThrow(() => new Function(script), 'Diagnostic client JavaScript is invalid');

  for (const key of ['notary', 'court', 'bailiff', 'state', 'unknown']) {
    assert(script.includes(`${key}: {`), `${key}: source route is missing`);
  }
  for (const key of ['account', 'writeoff', 'paid', 'restriction', 'sms']) {
    assert(script.includes(`${key}: {`), `${key}: symptom route is missing`);
  }
  for (const key of ['none', 'principal', 'all', 'unknown']) {
    assert(script.includes(`${key}: {`), `${key}: payment route is missing`);
  }
  for (const event of ['arrest_diagnostic_started', 'arrest_diagnostic_completed', 'arrest_diagnostic_copy', 'arrest_diagnostic_whatsapp']) {
    assert(script.includes(`'${event}'`), `${event}: client event is missing`);
    assert(server.includes(`'${event}'`), `${event}: server whitelist is missing`);
  }

  assert(server.includes("app.get('/diagnostika-aresta'"), 'Express route is missing');
  assert(server.includes("{ url: '/diagnostika-aresta'"), 'Sitemap entry is missing');
  assert(TOOLS.some(tool => tool.href === '/diagnostika-aresta'), 'Tools hub card is missing');
  assert(homepage.includes('/diagnostika-aresta'), 'Homepage entry point is missing');
  assert(arrestPillar.includes('/diagnostika-aresta'), 'Account-arrest pillar link is missing');
  assert(bankHub.includes('/diagnostika-aresta'), 'Bank hub entry point is missing');
  assert(css.includes('@media (max-width: 680px)'), 'Mobile design is missing');
  assert(css.includes('@media (prefers-reduced-motion: reduce)'), 'Reduced-motion support is missing');

  [
    /гарантируем отмену/i,
    /всегда можно отменить/i,
    /точно не прид[её]тся платить/i,
    /арест снимут за \d/i,
  ].forEach(pattern => assert(!pattern.test(html + script), `Risky universal promise found: ${pattern}`));

  console.log('Arrest diagnostic OK: 3-step private route, five legal sources, SEO, analytics and conversion entry points.');
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
