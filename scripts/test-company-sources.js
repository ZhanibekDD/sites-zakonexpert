'use strict';

const assert = require('assert');
const { createGoszakupClient } = require('../modules/goszakup');
const { createCompanyCheckService } = require('../modules/company-check-sources');

const calls = [];
const goszakup = createGoszakupClient({
  token: 'goszakup-secret',
  http: {
    async get(url, options) {
      calls.push({ url, options });
      if (url.includes('/subject/biin/')) return { data: { pid: 7, bin: '050140000656', name_ru: 'ТОО «Тест»', index_date: '2026-08-14', admins: [{ iin: 'must-not-leak' }] } };
      if (url.includes('/contract/supplier/')) return { data: { total: 115, items: [{ id: 1, contract_number_sys: 'TEST/1', crdate: '2026-08-01', contract_sum_wnds: 125000, customer_bin: 'secret-counterparty' }] } };
      if (url.includes('/contract/customer/')) return { data: { total: 4, items: [] } };
      if (url.includes('/rnu/')) return { data: { total: 0, items: [] } };
      throw new Error('Unexpected Goszakup path');
    },
  },
});

const localCompany = {
  bin: '050140000656',
  name_ru: 'Товарищество с ограниченной ответственностью «Тест»',
  name_kk: '«Тест» жауапкершілігі шектеулі серіктестігі',
  registration_date: '2001-05-11',
  address_ru: 'г. Алматы',
  activity_ru: 'Добыча руды',
  leader: 'ТЕСТОВЫЙ РУКОВОДИТЕЛЬ',
  status_ru: 'Зарегистрирован',
  slug: '1-test',
  contact_updated_at: '2026-08-12',
  contacts: [
    { type: 'phone', value: '+7 (727) 123-45-67', normalized: '+77271234567', sourceKey: 'business_directory_kz_2026' },
    { type: 'email', value: 'info@test.kz', normalized: 'info@test.kz', sourceKey: 'business_directory_kz_2026' },
  ],
  addresses: [
    { value: 'г. Алматы, ул. Тестовая, 1', latitude: 43.2389, longitude: 76.8897, sourceKey: 'business_directory_kz_2026' },
    { value: 'Z05T0C6, город Астана, район Есиль, ул. Әлихан Бөкейхан, д. 24, кв. 181, тел. +7(705)585-87-11', latitude: 0, longitude: 0, sourceKey: 'business_directory_kz_2026' },
  ],
  attributes: [
    { type: 'work_hours', value: 'Пн–Пт 09:00–18:00', sourceKey: 'business_directory_kz_2026' },
  ],
};

const companiesDb = {
  available: () => true,
  stats: () => ({ available: true, updatedAt: '2026-08-10' }),
  findByBin: bin => bin === localCompany.bin ? localCompany : null,
};

const kgd = {
  configured: true,
  async check(bin) {
    return {
      company: { bin, nameRu: 'ТОО «Тест»', nameKk: '', registrationDate: '2001-05-11', residency: 'Резидент', oked: '07100', okedName: 'Добыча руды', okedDate: null },
      tax: { vatInfo: 'Да', vatDate: '2002-02-01', taxMode: 'Общеустановленный', taxModeDate: '2022-09-27', debt: 0, debtBreakdown: [] },
      assessment: { score: 0, riskLevel: 'low', flaggedCount: 0, indicators: [] },
      statistics: [],
      actuality: '2026-08-15',
    };
  },
};

(async () => {
  const procurement = await goszakup.check(localCompany.bin);
  assert.strictEqual(calls.length, 4);
  assert(calls.every(call => call.options.headers.Authorization === 'Bearer goszakup-secret'));
  assert.strictEqual(procurement.participant.registered, true);
  assert.strictEqual(procurement.contracts.asSupplier.count, 115);
  assert.strictEqual(procurement.contracts.asSupplier.latest[0].amount, 125000);
  assert(!JSON.stringify(procurement).includes('secret-counterparty'), 'Other-party identifier leaked into public report');
  assert(!JSON.stringify(procurement).includes('must-not-leak'), 'Participant administrator IIN leaked into public report');
  assert(!JSON.stringify(procurement).includes('goszakup-secret'), 'Goszakup token leaked into public report');

  const service = createCompanyCheckService({
    companiesDb,
    kgdClient: kgd,
    goszakupClient: goszakup,
    now: () => new Date('2026-08-15T12:00:00Z'),
  });
  const report = await service.check(localCompany.bin);
  assert.strictEqual(report.coverage.complete, true);
  assert.strictEqual(report.company.leader, 'ТЕСТОВЫЙ РУКОВОДИТЕЛЬ');
  assert.strictEqual(report.company.oked, '07100');
  assert.strictEqual(report.company.contacts[0].value, '+7 (727) 123-45-67');
  assert.strictEqual(report.company.addresses[0].latitude, 43.2389);
  assert.strictEqual(report.company.addresses[1].latitude, null, '0,0 must never be published as Kazakhstan coordinates');
  assert.strictEqual(report.company.addresses[1].longitude, null, '0,0 must never be published as Kazakhstan coordinates');
  assert.strictEqual(report.company.addresses[1].mapValue,
    'город Астана, район Есиль, ул. Әлихан Бөкейхан, д. 24',
    'map query must exclude the postal code, apartment and telephone suffix');
  assert.strictEqual(report.company.attributes[0].type, 'work_hours');
  assert.strictEqual(report.coverage.contacts, true);
  assert.strictEqual(report.coverage.location, true);
  assert.strictEqual(report.sources.find(source => source.key === 'directory').status, 'ok');
  assert.strictEqual(report.procurement.contracts.asSupplier.count, 115);
  assert(report.sources.filter(source => ['egov', 'kgd', 'goszakup'].includes(source.key))
    .every(source => source.status === 'ok'));
  assert(report.sources.filter(source => ['elicense', 'dfo'].includes(source.key))
    .every(source => source.status === 'official_search'));

  const partial = createCompanyCheckService({
    companiesDb,
    kgdClient: { configured: false },
    goszakupClient: { configured: false },
  });
  const partialReport = await partial.check(localCompany.bin);
  assert.strictEqual(partialReport.company.nameRu, localCompany.name_ru);
  assert.strictEqual(partialReport.assessment.riskLevel, 'unknown');
  assert.strictEqual(partialReport.tax.debt, null);
  assert.strictEqual(partialReport.sources.find(source => source.key === 'kgd').status, 'not_configured');

  const empty = createCompanyCheckService({
    companiesDb: { available: () => false },
    kgdClient: { configured: false },
    goszakupClient: { configured: false },
  });
  await assert.rejects(empty.check('050140000656'), error => error.code === 'NO_OFFICIAL_DATA');

  const disabled = createGoszakupClient({ token: '', http: { get() {} } });
  await assert.rejects(disabled.check('050140000656'), error => error.code === 'GOSZAKUP_NOT_CONFIGURED');
  console.log('Official company sources OK: local fallback, KGD merge, Goszakup isolation and partial reports');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
