'use strict';

const assert = require('assert');
const { hydrateDetails } = require('../modules/company-details-store');
const {
  inheritLegacySlugs,
  legacyCatalogCandidates,
  resolveLegacyCatalogItem,
  resolvePersonSlugAlias,
} = require('../modules/seo-url-policy');

const catalogs = [
  { slug: 'lombard-baybol' },
  { slug: 'mfo-finance-kz' },
];
assert.strictEqual(
  resolveLegacyCatalogItem(
    catalogs,
    'ovarishchestvo-s-ogranichennoy-otvetstvennostyu-lombard-baybol'
  )?.slug,
  'lombard-baybol',
  'old legal-form catalog URLs must resolve to the current canonical slug'
);
assert(legacyCatalogCandidates('too-mfo-finance-kz').includes('mfo-finance-kz'));
assert.strictEqual(resolveLegacyCatalogItem([
  { slug: 'same-name' }, { slug: 'same-name' },
], 'too-same-name'), null, 'ambiguous catalog aliases must remain a real 404');

const inherited = inheritLegacySlugs([
  { slug: 'ivanov-ivan-astana', license: '123', name: 'Иванов Иван', region: 'Астана' },
], [
  {
    slug: 'ivanov-ivan', legacySlugs: ['ivanov-ivan-2'], license: '123',
    name: 'Иванов Иван', region: 'Астана',
  },
], [item => item.license, item => `${item.name}|${item.region}`]);
assert.deepStrictEqual(
  inherited[0].legacySlugs.sort(),
  ['ivanov-ivan', 'ivanov-ivan-2'],
  'registry refresh must preserve every previous public slug'
);
assert.strictEqual(
  resolvePersonSlugAlias(inherited, 'ivanov-ivan')?.slug,
  'ivanov-ivan-astana',
  'stored person aliases must resolve to the current record'
);
assert.strictEqual(resolvePersonSlugAlias([
  { slug: 'ivanov-ivan-astana' },
  { slug: 'ivanov-ivan-almaty' },
], 'ivanov-ivan'), null, 'ambiguous person aliases must never guess a profile');

const malformed = hydrateDetails(JSON.stringify({
  n: [null, 'Дополнительное имя'],
  a: [null, ['Алматы']],
  c: [false, ['phone', '+77010000000', '77010000000']],
  g: [{}, ['Услуги', 'Право', 'law']],
  x: [null, ['work_hours', '09:00–18:00', '09 00 18 00', 1]],
}), { key: 'test', label: 'Test source', priority: 1 });
assert.strictEqual(malformed.names.length, 1);
assert.strictEqual(malformed.addresses.length, 1);
assert.strictEqual(malformed.contacts.length, 1);
assert.strictEqual(malformed.categories.length, 1);
assert.strictEqual(malformed.attributes.length, 1);

console.log('SEO indexing policy OK: aliases, ambiguity guards and malformed details');
