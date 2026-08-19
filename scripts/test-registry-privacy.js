'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
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

console.log('Registry privacy correction OK');
