'use strict';

const slugify = require('slugify');

slugify.extend({
  'ә': 'a', 'Ә': 'A', 'ғ': 'g', 'Ғ': 'G', 'қ': 'k', 'Қ': 'K',
  'ң': 'n', 'Ң': 'N', 'ө': 'o', 'Ө': 'O', 'ұ': 'u', 'Ұ': 'U',
  'ү': 'u', 'Ү': 'U', 'һ': 'h', 'Һ': 'H', 'і': 'i', 'І': 'I',
});

function companySlug(id, name) {
  const nameSlug = slugify(String(name || '').toLowerCase(), {
    locale: 'ru', replacement: '-', strict: true, trim: true,
  }).slice(0, 96);
  return `${id}-${nameSlug || 'organization'}`;
}

module.exports = { companySlug };
