'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ejs = require('ejs');
const { TOOLS } = require('../modules/tools-catalog');
const { summarizeArrestDiagnosticFunnel } = require('../modules/clicks-db');

const root = path.join(__dirname, '..');

async function run() {
  const html = await ejs.renderFile(path.join(root, 'views', 'arrest-diagnostic.ejs'));
  const script = fs.readFileSync(path.join(root, 'public', 'js', 'arrest-diagnostic.js'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'public', 'css', 'arrest-diagnostic.css'), 'utf8');
  const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
  const homepage = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
  const arrestPillar = fs.readFileSync(path.join(root, 'public', 'snyatie-aresta-so-scheta.html'), 'utf8');
  const bankHub = fs.readFileSync(path.join(root, 'views', 'partials', 'bank-arrest-hub-body.ejs'), 'utf8');
  const bailiffPage = fs.readFileSync(path.join(root, 'views', 'bailiff', 'page.ejs'), 'utf8');
  const notaryPage = fs.readFileSync(path.join(root, 'views', 'notary', 'page.ejs'), 'utf8');
  const registryBody = fs.readFileSync(path.join(root, 'views', 'partials', 'registry-item-body.ejs'), 'utf8');
  const catalogBody = fs.readFileSync(path.join(root, 'views', 'partials', 'professional-catalog-body.ejs'), 'utf8');
  const analytics = fs.readFileSync(path.join(root, 'public', 'js', 'analytics-events.js'), 'utf8');
  const registryLocals = { comments: [], commentStats: {}, commentSent: false };
  const [bailiffHtml, activeNotaryHtml, inactiveNotaryHtml] = await Promise.all([
    ejs.renderFile(path.join(root, 'views', 'bailiff', 'page.ejs'), {
      ...registryLocals,
      bailiff: { name: 'TEST BAILIFF', slug: 'test-bailiff', region: 'город Астана', phones: [], license: '1', address: 'Астана' },
    }),
    ejs.renderFile(path.join(root, 'views', 'notary', 'page.ejs'), {
      ...registryLocals,
      notary: { name: 'TEST NOTARY', slug: 'test-notary', region: 'город Астана', active: true },
    }),
    ejs.renderFile(path.join(root, 'views', 'notary', 'page.ejs'), {
      ...registryLocals,
      notary: { name: 'OLD NOTARY', slug: 'old-notary', region: 'город Астана', active: false },
    }),
  ]);

  assert(html.includes('<h1>Диагностика ареста счёта:'), 'H1 must begin with the search intent');
  assert(html.includes('<link rel="canonical" href="https://zakonexpert.kz/diagnostika-aresta">'), 'Canonical is missing');
  assert(html.includes('WebApplication') && html.includes('FAQPage') && html.includes('BreadcrumbList'), 'Structured data is incomplete');
  assert(html.includes('/css/arrest-diagnostic.css?v=20260824-1'), 'Dedicated stylesheet is missing');
  assert(html.includes('/js/arrest-diagnostic.js?v=20260824-2'), 'Dedicated script is missing');
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
  assert(script.includes("['notary', 'court', 'bailiff', 'state', 'unknown']"), 'Preset source must use a strict allowlist');
  assert(script.includes("['bailiff_profile', 'notary_profile', 'bailiff_region', 'notary_region']"), 'Entry attribution must use a strict allowlist');
  assert(script.includes("currentStep === 1 && presetSource"), 'A known registry source must skip the redundant source question');

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
  assert(bailiffPage.includes("source: 'bailiff'") && bailiffPage.includes("entry: 'bailiff_profile'"), 'Bailiff profiles must prefill the diagnostic safely');
  assert(notaryPage.includes("source: 'notary'") && notaryPage.includes("entry: 'notary_profile'"), 'Active notary profiles must prefill the diagnostic safely');
  assert(registryBody.includes('data-product-event="arrest_diagnostic_entry"'), 'Registry profile diagnostic event is missing');
  assert(catalogBody.includes('entry=bailiff_region'), 'Regional bailiff pages must link to the diagnostic');
  assert(catalogBody.includes('entry=notary_region'), 'Regional notary pages must link to the diagnostic');
  assert(analytics.includes("send(eventType, link.getAttribute('data-event-target')"), 'Shared product CTA analytics handler is missing');
  assert(server.includes('source_entity_type:') && server.includes('source_page:'), 'Safe registry attribution dimensions are not persisted');
  assert(bailiffHtml.includes('source=bailiff&amp;entry=bailiff_profile'), 'Rendered bailiff diagnostic link is invalid');
  assert(activeNotaryHtml.includes('source=notary&amp;entry=notary_profile'), 'Rendered notary diagnostic link is invalid');
  assert(!inactiveNotaryHtml.includes('data-event-cta="notary_profile"'), 'Inactive notary archive pages must not assume an executable writ');
  assert(bailiffHtml.includes('analytics-events.js?v=20260828-2'), 'Registry analytics cache key is stale');
  assert(css.includes('@media (max-width: 680px)'), 'Mobile design is missing');
  assert(css.includes('@media (prefers-reduced-motion: reduce)'), 'Reduced-motion support is missing');

  [
    /гарантируем отмену/i,
    /всегда можно отменить/i,
    /точно не прид[её]тся платить/i,
    /арест снимут за \d/i,
  ].forEach(pattern => assert(!pattern.test(html + script), `Risky universal promise found: ${pattern}`));

  const funnel = summarizeArrestDiagnosticFunnel([
    { type: 'arrest_diagnostic_entry', cta_position: 'bailiff_profile', source_entity_type: 'bailiff' },
    { type: 'arrest_diagnostic_started', cta_position: 'bailiff_profile', source_entity_type: 'bailiff' },
    { type: 'arrest_diagnostic_completed', cta_position: 'bailiff_profile', source_entity_type: 'bailiff', document_type: 'bailiff' },
    { type: 'arrest_diagnostic_whatsapp', cta_position: 'bailiff_profile', source_entity_type: 'bailiff', document_type: 'bailiff' },
    { type: 'copy_link', cta_position: 'bailiff_profile' },
  ]);
  assert.deepStrictEqual(
    [funnel.entryClicks, funnel.starts, funnel.completions, funnel.whatsappClicks],
    [1, 1, 1, 1],
    'Diagnostic funnel must count only its four conversion stages',
  );
  assert.strictEqual(funnel.completionRatePct, 100);
  assert.strictEqual(funnel.whatsappRatePct, 100);
  assert.strictEqual(funnel.byEntry.bailiff_profile.whatsappClicks, 1);

  console.log('Arrest diagnostic OK: private route, registry bridge, safe attribution and measurable conversion funnel.');
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
