'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ejs = require('ejs');
const {
  BANK_ARREST_PAGES,
  BANK_ARREST_HUB_PATH,
  getBankArrestPageByPath,
  getRelatedBankArrestPages,
  getBankArrestPathForBank,
} = require('../modules/bank-arrest-pages');
const { LEGAL_INTENT_PAGES, getLegalIntentPage } = require('../modules/legal-intent-pages');

const root = path.join(__dirname, '..');

function unique(values, label) {
  assert.strictEqual(new Set(values).size, values.length, label + ' must be unique');
}

function assertNoRiskyUniversalClaims(text, label) {
  const banned = [
    /расходы\s+ЧСИ\s*\(?\s*10\s*%/iu,
    /исполнительск(?:ий|ого)\s+(?:сбор|вознагражден)[^.!?]{0,30}25\s*%/iu,
    /обязан[^.!?]{0,80}в\s+течение\s+1\s+рабочего\s+дня/iu,
    /(?:гарантируем|гарантированно\s+(?:снимем|верн[её]м|разблокируем))/iu,
    /снимем\s+арест\s+за\s+\d+/iu,
  ];
  banned.forEach(pattern => assert(!pattern.test(text), label + ' contains risky universal claim: ' + pattern));
}

async function render(relativePath, data) {
  return ejs.renderFile(path.join(root, relativePath), data, {
    root: path.join(root, 'views'),
    views: [path.join(root, 'views')],
  });
}

async function main() {
  assert.strictEqual(BANK_ARREST_HUB_PATH, '/arest-scheta-v-bankah-kazahstana');
  assert.strictEqual(BANK_ARREST_PAGES.length, 23, 'cluster must cover 23 second-tier banks');
  assert(LEGAL_INTENT_PAGES.length >= 7, 'at least seven distinct high-intent pages are required');

  unique(BANK_ARREST_PAGES.map(page => page.path), 'bank paths');
  unique(BANK_ARREST_PAGES.map(page => page.bin), 'bank BINs');
  unique(LEGAL_INTENT_PAGES.map(page => page.path), 'legal intent paths');

  BANK_ARREST_PAGES.forEach(page => {
    assert(page.path.startsWith('/arest-'), page.path + ' must use an arrest-focused canonical path');
    assert(!page.path.endsWith('.html'), page.path + ' must be extensionless');
    assert(/^\d{12}$/.test(page.bin), page.brand + ' must have a 12-digit BIN');
    assert(page.context.length > 120, page.brand + ' needs bank-specific value, not a thin doorway page');
    assert(getBankArrestPageByPath(page.path) === page);
  });
  assert(!BANK_ARREST_PAGES.some(page => page.bankSlug === 'bank-razvitiya-kazakhstana'), 'DBK is not a retail second-tier bank landing page');
  assert.strictEqual(BANK_ARREST_PAGES.filter(page => page.legacyStatic).length, 3, 'Kaspi, Halyk and Freedom keep existing static URLs');

  LEGAL_INTENT_PAGES.forEach(page => {
    assert(page.title.length >= 45 && page.title.length <= 90, page.path + ' title length');
    assert(page.description.length >= 100 && page.description.length <= 180, page.path + ' description length');
    assert(page.steps.length >= 4, page.path + ' requires actionable steps');
    assert(page.causes.length >= 4, page.path + ' requires distinct causes');
    assert(page.faq.length >= 3, page.path + ' requires FAQs');
    assert(getLegalIntentPage(page.path) === page);
  });

  assert.strictEqual(getBankArrestPathForBank({ bin: '980640000093' }), '/arest-bank-centercredit');
  assert.strictEqual(getBankArrestPathForBank({ slug: 'bank-razvitiya-kazakhstana' }), BANK_ARREST_HUB_PATH);

  const moduleText = JSON.stringify({ BANK_ARREST_PAGES, LEGAL_INTENT_PAGES });
  assertNoRiskyUniversalClaims(moduleText, 'growth modules');

  const mockBank = {
    slug: 'bank-centercredit',
    name: 'АО «Банк ЦентрКредит»',
    shortName: 'Bank CenterCredit',
    bin: '980640000093',
    web: 'bcc.kz',
  };
  const bankPage = getBankArrestPageByPath('/arest-bank-centercredit');
  const bankHtml = await render('views/bank-arrest/page.ejs', {
    page: bankPage,
    bank: mockBank,
    relatedPages: getRelatedBankArrestPages(bankPage),
  });
  assert(bankHtml.includes('<title>Арест счёта Bank CenterCredit'));
  assert(bankHtml.includes('https://zakonexpertt.kz/arest-bank-centercredit'));
  assert(bankHtml.includes('data-growth-page-type="bank_arrest"'));
  assert(!bankHtml.includes('undefined'));
  assertNoRiskyUniversalClaims(bankHtml, 'rendered bank page');

  const hubHtml = await render('views/bank-arrest/hub.ejs', {
    pages: BANK_ARREST_PAGES,
    legalPages: LEGAL_INTENT_PAGES,
    reviewedAt: '2026-08-23',
  });
  assert(hubHtml.includes('23 банка второго уровня'));
  assert(hubHtml.includes('/arest-bank-centercredit'));
  assert(hubHtml.includes('/arest-bnk-bank'));
  assert(hubHtml.includes('/arest-kzi-bank'));
  assert(!hubHtml.includes('undefined'));

  for (const page of LEGAL_INTENT_PAGES) {
    const html = await render('views/legal-intent/page.ejs', {
      page,
      relatedPages: LEGAL_INTENT_PAGES.filter(item => item.path !== page.path).slice(0, 3),
    });
    assert(html.includes('<title>' + page.title + '</title>'));
    assert(html.includes('https://zakonexpertt.kz' + page.path));
    assert(html.includes('data-growth-page-type="legal_intent"'));
    assert(!html.includes('undefined'));
    assertNoRiskyUniversalClaims(html, page.path);
  }

  [
    'public/css/bank-arrest-cluster.css',
    'public/js/growth-pages.js',
    'views/bank-arrest/page.ejs',
    'views/bank-arrest/hub.ejs',
    'views/legal-intent/page.ejs',
  ].forEach(file => assert(fs.existsSync(path.join(root, file)), file + ' must exist'));

  console.log('Bank arrest growth cluster: OK');
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
