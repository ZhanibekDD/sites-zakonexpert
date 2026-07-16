'use strict';

const assert = require('assert');
const path = require('path');
const { buildLawyers } = require('./import-lawyers');
const { readRegistrySource } = require('../modules/registry-source');

const source = readRegistrySource(path.join(__dirname, '..', 'registry', 'lawyers.json.gz'), 'lawyers');
const { lawyers } = buildLawyers(source.records, source.sourceMtime);
const slugs = new Set(lawyers.map(item => item.slug));

assert.strictEqual(lawyers.length, 130, 'unexpected lawyer count in fallback snapshot');
assert.strictEqual(slugs.size, lawyers.length, 'lawyer slugs must be unique');
assert.ok(lawyers.every(item => item.name && item.region), 'lawyer identity fields must be present');

console.log(`Lawyer data OK: ${lawyers.length} records`);
