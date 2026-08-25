'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const { createSchema } = require('../modules/companies-schema');
const { insertRows } = require('./import-companies-egov');
const {
  applyRegistryPrivacyOverride,
  isRegistryContactSuppressed,
} = require('../modules/registry-privacy');

const ROOT = path.join(__dirname, '..');
const COLLECTOR_BIN = '210740004596';
const csv = fs.readFileSync(path.join(ROOT, 'Коллекторские_агентства_Казахстана.csv'), 'utf8');
const row = csv.split(/\r?\n/).find(line => line.startsWith(`${COLLECTOR_BIN};`));

assert(row, 'collector record must remain available by BIN');
assert.match(row, /^210740004596;[^;]*;[^;]*;;/,
  'the outdated leader field must be empty in the source registry row');

const sanitized = applyRegistryPrivacyOverride('collectors', {
  bin: COLLECTOR_BIN,
  name: 'Test agency',
  leader: 'Outdated person',
});
assert.strictEqual(sanitized.leader, '', 'privacy override must suppress the leader after future imports');
assert.strictEqual(sanitized.name, 'Test agency', 'privacy override must preserve non-personal organization data');

const untouched = applyRegistryPrivacyOverride('collectors', {
  bin: '000000000000',
  leader: 'Current person',
});
assert.strictEqual(untouched.leader, 'Current person', 'unrelated records must not change');

const COMPANY_BIN = '101140004980';
assert.strictEqual(
  isRegistryContactSuppressed('companies', COMPANY_BIN, '+7 (778) 167-01-17'),
  true,
  'the disputed company phone must remain suppressed after future imports'
);
assert.strictEqual(
  isRegistryContactSuppressed('companies', COMPANY_BIN, '+7 (7182) 33-40-88'),
  false,
  'unrelated company contacts must remain available'
);

const company = applyRegistryPrivacyOverride('companies', {
  bin: COMPANY_BIN,
  name: 'ДАН GRОUP COMPANY',
  contacts: [
    { type: 'mobile_phone', value: '8 778 167 01 17', normalized: '+77781670117' },
    { type: 'phone', value: '+7 (7182) 33-40-88', normalized: '+77182334088' },
  ],
});
assert.deepStrictEqual(
  company.contacts.map(contact => contact.normalized),
  ['+77182334088'],
  'privacy override must remove only the disputed contact from hydrated company details'
);
assert.strictEqual(company.name, 'ДАН GRОUP COMPANY', 'company identity must be preserved');

const VEGA_BIN = '240840020011';
const vega = applyRegistryPrivacyOverride('companies', {
  bin: VEGA_BIN,
  name: 'Товарищество с ограниченной ответственностью "VEGA-M"',
  leader: 'МАЛАХОВА МАРИНА ВАЛЕРЬЕВНА',
  address_ru: '110000, Костанайская область, город Костанай, ул. И.Алтынсарина, зд. 133, тел. +7(776)720-00-52',
  activity_ru: 'Предоставление прочих индивидуальных услуг',
  contacts: [
    { type: 'mobile_phone', value: '+7 (776) 720-00-52', normalized: '+77767200052' },
  ],
});
assert.strictEqual(vega.leader, '', 'requested VEGA-M leader value must stay suppressed after future imports');
assert.strictEqual(
  vega.address_ru,
  '110000, Костанайская область, город Костанай, ул. И.Алтынсарина, зд. 133',
  'suppressed phone must also be removed when embedded in the legal address'
);
assert.deepStrictEqual(vega.contacts, [], 'VEGA-M disputed phone must not be returned as a contact');
assert.strictEqual(vega.bin, VEGA_BIN, 'VEGA-M company identity must remain public');
assert.match(vega.name, /VEGA-M/, 'VEGA-M company name must remain public');
assert.match(vega.activity_ru, /индивидуальных услуг/, 'VEGA-M business activity must remain public');

const vegaFutureLeader = applyRegistryPrivacyOverride('companies', {
  bin: VEGA_BIN,
  name: 'Товарищество с ограниченной ответственностью "VEGA-M"',
  leader: 'САХАРОВА ТАТЬЯНА ЗАБИШАХОВНА',
  address_ru: '110000, Костанайская область, город Костанай, ул. И.Алтынсарина, зд. 133',
});
assert.strictEqual(
  vegaFutureLeader.leader,
  'САХАРОВА ТАТЬЯНА ЗАБИШАХОВНА',
  'a future different official leader must not be hidden by the current request'
);

const database = new DatabaseSync(':memory:');
createSchema(database);
insertRows(database, [{
  id: '309373765',
  bin: VEGA_BIN,
  nameru: 'Товарищество с ограниченной ответственностью "VEGA-M"',
  registerdate: '2024-08-16+05:00',
  addressru: '110000, Костанайская область, город Костанай, ул. И.Алтынсарина, зд. 133, тел. +7(776)720-00-52',
  okedru: 'ПРЕДОСТАВЛЕНИЕ ПРОЧИХ ИНДИВИДУАЛЬНЫХ УСЛУГ, НЕ ВКЛЮЧЕННЫХ В ДРУГИЕ ГРУППИРОВКИ',
  fio: 'МАЛАХОВА МАРИНА ВАЛЕРЬЕВНА',
  statusru: 'Зарегистрирован',
}], 'privacy-test');
const persistedVega = database.prepare(
  'SELECT bin, name_ru, leader, address_ru FROM companies WHERE id = ?'
).get(309373765);
assert.strictEqual(persistedVega.bin, VEGA_BIN, 'VEGA-M BIN must still be persisted');
assert.match(persistedVega.name_ru, /VEGA-M/, 'VEGA-M organization identity must still be persisted');
assert.strictEqual(persistedVega.leader, '', 'suppressed leader must not be persisted by the eGov importer');
assert.strictEqual(
  persistedVega.address_ru,
  '110000, Костанайская область, город Костанай, ул. И.Алтынсарина, зд. 133',
  'suppressed embedded phone must not be persisted by the eGov importer'
);
database.close();

console.log('Registry privacy correction OK');
