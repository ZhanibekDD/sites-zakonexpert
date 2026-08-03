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

const GENERIC_LEGAL_FORM_NAMES = new Set([
  'акционерное общество',
  'акционерное общество закрытого типа',
  'акционерное общество открытого типа',
  'товарищество с ограниченной ответственностью',
  'производственный кооператив',
  'крестьянское хозяйство',
  'индивидуальный предприниматель',
  'акционерлік қоғам',
  'ашық акционерлік қоғам',
  'жабық акционерлік қоғам',
  'жауапкершілігі шектеулі серіктестік',
  'жауапкершілігі шектеулі серіктестігі',
  'өндірістік кооператив',
  'өндірістік кооперативі',
  'шаруа қожалығы',
  'жеке кәсіпкер',
]);

function displayKey(raw) {
  return String(raw || '')
    .normalize('NFKC')
    .toLocaleLowerCase('ru-RU')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Some old registry rows contain only a legal form in the Kazakh name field,
// for example "Жабық акционерлік қоғам", while the Russian field also has the
// organization's unique name. Such a value is provenance, not a usable name:
// displaying it as an alias makes the card look corrupted and pollutes JSON-LD.
function isGenericLegalFormName(raw) {
  return GENERIC_LEGAL_FORM_NAMES.has(displayKey(raw));
}

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
  GENERIC_LEGAL_FORM_NAMES,
  LEGAL_FORM_PREFIX,
  LEGAL_FORM_SUFFIX,
  isGenericLegalFormName,
  normalizeCompanyName,
};
