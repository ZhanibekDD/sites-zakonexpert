'use strict';

// Search-oriented transliteration for Russian and Kazakh Cyrillic. This is
// deliberately deterministic: it creates aliases for lookup and structured
// data, but never replaces an organization's official displayed name.
const MAP = {
  а: 'a', ә: 'a', б: 'b', в: 'v', г: 'g', ғ: 'gh', д: 'd', е: 'e', ё: 'yo',
  ж: 'zh', з: 'z', и: 'i', й: 'i', к: 'k', қ: 'q', л: 'l', м: 'm', н: 'n',
  ң: 'ng', о: 'o', ө: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ұ: 'u',
  ү: 'u', ф: 'f', х: 'kh', һ: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'shch',
  ъ: '', ы: 'y', і: 'i', ь: '', э: 'e', ю: 'yu', я: 'ya',
};

function transliterateCompanyName(raw) {
  return String(raw || '')
    .normalize('NFKC')
    .toLocaleLowerCase('ru-RU')
    .split('')
    .map(character => MAP[character] === undefined ? character : MAP[character])
    .join('')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildSearchAliases(...names) {
  const aliases = new Set();
  for (const value of names.flat()) {
    const raw = String(value || '').trim();
    if (!raw) continue;
    const latin = transliterateCompanyName(raw);
    if (latin && latin !== raw.toLocaleLowerCase('ru-RU')) aliases.add(latin);
  }
  return Array.from(aliases).join(' ');
}

module.exports = { buildSearchAliases, transliterateCompanyName };
