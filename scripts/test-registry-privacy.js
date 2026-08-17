'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { applyRegistryPrivacyOverride } = require('../modules/registry-privacy');

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

console.log('Registry privacy correction OK');
