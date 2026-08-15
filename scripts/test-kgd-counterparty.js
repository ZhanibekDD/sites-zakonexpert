'use strict';

const assert = require('assert');
const path = require('path');
const ejs = require('ejs');
const {
  COUNTERPARTY_PATH,
  validateBin,
  normalizeCounterparty,
  createKgdCounterpartyClient,
} = require('../modules/kgd-counterparty');

const fixture = {
  actuality: '2026-08-15',
  xin: '260740044168',
  name: { ru: 'ТОО «ZakonExpert»', kk: '«ZakonExpert» ЖШС' },
  regDate: '2026-07-10',
  residency: { ru: 'Резидент' },
  oked: { ru: '69109' },
  okedName: { ru: 'Прочая деятельность в области права' },
  vatInfo: { ru: 'Нет данных' },
  taxMode: { ru: 'Общеустановленный порядок' },
  registrationInvalid: { ru: 'Нет данных' },
  reRegistrationInvalid: { ru: 'Нет данных' },
  operationsWOWork: { ru: 'Нет данных' },
  esfRestrinctions: { ru: 'Нет данных' },
  inactive: { ru: 'Нет данных' },
  regAddressAbsent: { ru: 'Да' },
  bankrupt: { ru: 'Нет данных' },
  selfRegulatoryRegistry: { ru: 'Нет данных' },
  courtDecisionRegistry: { ru: 'Нет данных' },
  taxDebt: 250000,
  statistics: [
    { year: 2026, workersCount: 3, taxIn: 1200000, knn: '2.3', knnAvg: '2.5', vatAmount: 0 },
  ],
};

assert.strictEqual(validateBin('260 740 044 168'), '260740044168');
assert.strictEqual(validateBin('123'), null);

const normalized = normalizeCounterparty(fixture, '260740044168');
assert.strictEqual(normalized.company.nameRu, 'ТОО «ZakonExpert»');
assert.strictEqual(normalized.tax.debt, 250000);
assert.strictEqual(normalized.assessment.riskLevel, 'attention');
assert(normalized.assessment.indicators.find(item => item.key === 'regAddressAbsent').flagged);
assert(!normalized.assessment.indicators.find(item => item.key === 'bankrupt').flagged);
assert.strictEqual(normalized.statistics[0].workersCount, 3);

let request = null;
const client = createKgdCounterpartyClient({
  token: 'secret-token',
  baseUrl: 'https://portal.kgd.gov.kz/',
  http: {
    async post(url, body, options) {
      request = { url, body, options };
      return { data: fixture };
    },
  },
});

(async () => {
  const result = await client.check('260740044168');
  assert.strictEqual(request.url, 'https://portal.kgd.gov.kz' + COUNTERPARTY_PATH);
  assert.deepStrictEqual(request.body, { xin: '260740044168' });
  assert.strictEqual(request.options.headers['X-Portal-Token'], 'secret-token');
  assert(!JSON.stringify(result).includes('secret-token'), 'API token leaked into public result');

  const disabled = createKgdCounterpartyClient({ token: '', http: { post() {} } });
  await assert.rejects(disabled.check('260740044168'), error => error.code === 'KGD_NOT_CONFIGURED');
  await assert.rejects(client.check('123'), error => error.code === 'INVALID_BIN');
  const html = await ejs.renderFile(path.join(__dirname, '..', 'views', 'company-check.ejs'));
  assert(html.includes('https://zakonexpertt.kz/proverka-kontragenta'), 'Canonical URL is missing');
  assert(html.includes('/css/company-check.css?v=20260815-3'), 'Page stylesheet is missing');
  assert(html.includes('/js/company-check.js?v=20260815-1'), 'Page script is missing');
  assert(html.includes('FAQPage'), 'FAQ structured data is missing');
  assert(!html.includes('secret-token'), 'API token leaked into rendered HTML');
  console.log('KGD counterparty check OK: API isolation, normalization, risk indicators and rendered page');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
