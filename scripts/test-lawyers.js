'use strict';

const assert = require('assert');
const path = require('path');
const ejs = require('ejs');
const { buildLawyers, importLawyers } = require('./import-lawyers');
const { normalizePhones, isUsableRecord } = require('./refresh-lawyers-registry');
const { readRegistrySource } = require('../modules/registry-source');

async function run() {
  const source = readRegistrySource(path.join(__dirname, '..', 'registry', 'lawyers.json.gz'), 'lawyers');
  const { lawyers } = buildLawyers(source.records, source.sourceMtime);
  const slugs = new Set(lawyers.map(item => item.slug));

  assert.ok(lawyers.length >= 4200, `national lawyer snapshot is incomplete: ${lawyers.length}`);
  assert.strictEqual(slugs.size, lawyers.length, 'lawyer slugs must be unique');
  assert.ok(lawyers.every(item => item.name && item.region), 'lawyer identity fields must be present');
  assert.ok(lawyers.filter(item => item.licenseNo).length >= 4000, 'too many lawyer records lack licence numbers');
  assert.ok(lawyers.filter(item => item.phones.length).length >= 4200, 'too many lawyer records lack valid phones');
  assert.ok(lawyers.filter(item => item.email).length >= 4150, 'too many lawyer records lack valid email');
  assert.ok(new Set(lawyers.map(item => item.region)).size >= 20, 'lawyer regions are incomplete');
  assert.ok(!lawyers.some(item => /\b(?:test|advokat|указано)\b/i.test(item.name)), 'test profiles must be rejected');
  assert.deepStrictEqual(normalizePhones('8 (701) 123-45-67, +98765443321'), ['+77011234567']);
  assert.strictEqual(isUsableRecord({ id: 1, lastName: 'test', firstName: 'test', licenseNumber: '111' }), false);
  assert.match(source.source || '', /eup\.adilet\.gov\.kz/, 'official source metadata is missing');

  const sample = lawyers.find(item => item.email && item.legalOrganization && item.licenseNo);
  const profileHtml = await ejs.renderFile(path.join(__dirname, '..', 'views', 'lawyer', 'page.ejs'), { lawyer: sample });
  assert.match(profileHtml, /"@type":"Person"/, 'lawyer structured data must describe a Person');
  assert.ok(profileHtml.includes(sample.email), 'lawyer email is missing from profile');
  assert.ok(profileHtml.includes('официальный публичный реестр'), 'official registry attribution is missing');

  const imported = await importLawyers();
  assert.strictEqual(imported, lawyers.length, 'lawyer database count differs from snapshot');
  console.log(`Lawyer data OK: ${lawyers.length} records`);
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
