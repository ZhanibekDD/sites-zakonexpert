'use strict';

const LEGAL_FORM_PREFIX = new RegExp(
  '^(?:'
  + 'товарищество\\s+с\\s+ограниченной\\s+ответственностью|'
  + 'акционерное\\s+общество|'
  + 'производственный\\s+кооператив|'
  + 'крестьянское\\s+хозяйство|'
  + 'индивидуальный\\s+предприниматель|'
  + 'жауапкершілігі\\s+шектеулі\\s+серіктестік|'
  + 'акционерлік\\s+қоғам|'
  + 'өндірістік\\s+кооператив|'
  + 'шаруа\\s+қожалығы|'
  + 'жеке\\s+кәсіпкер|'
  + 'тоо|ао|пк|ип|гкп|ккп|жшс|ақ|жк'
  + ')\\s+',
  'iu'
);

const LEGAL_FORM_SUFFIX = new RegExp(
  '\\s+(?:'
  + 'жауапкершілігі\\s+шектеулі\\s+серіктестігі|'
  + 'акционерлік\\s+қоғамы|'
  + 'өндірістік\\s+кооперативі|'
  + 'шаруа\\s+қожалығы|'
  + 'жеке\\s+кәсіпкері|'
  + 'жшс|ақ|жк'
  + ')$',
  'iu'
);

// Shared normalizer for matching a company name across sources that format
// the legal-form prefix differently (ТОО vs spelled out, quote styles, etc.).
// Strips wrapping punctuation/legal-form words and lowercases, so
// 'ТОО "Ромашка"' and 'Товарищество с ограниченной ответственностью Ромашка'
// both reduce to 'ромашка' for comparison. Not for display — display the
// original field, only use this for matching.
function normalizeCompanyName(raw) {
  return String(raw || '')
    .normalize('NFKC')
    .replace(/[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2060\ufeff]/gu, ' ')
    .trim()
    .replace(/^[«»"'“”]+/, '')
    .replace(LEGAL_FORM_PREFIX, '')
    .replace(LEGAL_FORM_SUFFIX, '')
    .replace(/^[«»"'“”]+/, '')
    .replace(/[«»"'“”]+$/, '')
    .toLocaleLowerCase('ru-RU')
    .replace(/ё/g, 'е')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

module.exports = {
  LEGAL_FORM_PREFIX,
  LEGAL_FORM_SUFFIX,
  normalizeCompanyName,
};
