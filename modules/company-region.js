'use strict';

// 17 oblasts + 3 cities of republican significance (Kazakhstan, post-2022 split).
// Each entry: [slug, label, regex matched against normalized address text].
// Note: \b is unusable here — JS regex treats Cyrillic letters as non-word
// characters, so \b never anchors correctly against them. Match on the
// distinctive stem plus a following "област"/prefix token instead.
const REGIONS = [
  ['astana', 'Астана', /астан[а-я]*/i],
  ['almaty-city', 'Алматы', /(?:^|[^а-яё])(?:г\.?\s*|город\s+)?алматы(?:[^а-яё]|$)/i],
  ['shymkent', 'Шымкент', /шымкент[а-я]*/i],
  ['baikonur', 'Байконур', /байконур[а-я]*/i],
  ['abay', 'Абайская область', /абайск[а-я]*\s+област/i],
  ['akmola', 'Акмолинская область', /акмолинск[а-я]*\s+област/i],
  ['aktobe', 'Актюбинская область', /актюбинск[а-я]*\s+област/i],
  ['almaty-region', 'Алматинская область', /алматинск[а-я]*\s+област/i],
  ['atyrau', 'Атырауская область', /атырауск[а-я]*\s+област/i],
  ['east-kazakhstan', 'Восточно-Казахстанская область', /восточно.?казахстанск[а-я]*\s+област/i],
  ['zhambyl', 'Жамбылская область', /жамбылск[а-я]*\s+област/i],
  ['zhetisu', 'Жетысуская область', /жет[иі]су[а-я]*\s+област/i],
  ['west-kazakhstan', 'Западно-Казахстанская область', /западно.?казахстанск[а-я]*\s+област/i],
  ['karaganda', 'Карагандинская область', /карагандинск[а-я]*\s+област/i],
  ['kostanay', 'Костанайская область', /костанайск[а-я]*\s+област/i],
  ['kyzylorda', 'Кызылординская область', /кызылординск[а-я]*\s+област/i],
  ['mangystau', 'Мангистауская область', /мангистауск[а-я]*\s+област/i],
  ['pavlodar', 'Павлодарская область', /павлодарск[а-я]*\s+област/i],
  ['north-kazakhstan', 'Северо-Казахстанская область', /северо.?казахстанск[а-я]*\s+област/i],
  ['turkistan', 'Туркестанская область', /туркестанск[а-я]*\s+област/i],
  ['ulytau', 'Улытауская область', /улытауск[а-я]*\s+област|ұлытауск[а-я]*\s+област/i],
];

const EXACT_REGION_LABELS = new Map([
  ['астана', 'astana'],
  ['алматы', 'almaty-city'],
  ['шымкент', 'shymkent'],
  ['байконур', 'baikonur'],
  ['акмолинская область', 'akmola'],
  ['актюбинская область', 'aktobe'],
  ['алматинская область', 'almaty-region'],
  ['атырауская область', 'atyrau'],
  ['восточно казахстанская область', 'east-kazakhstan'],
  ['жамбылская область', 'zhambyl'],
  ['область жетысу', 'zhetisu'],
  ['жетысуская область', 'zhetisu'],
  ['западно казахстанская область', 'west-kazakhstan'],
  ['карагандинская область', 'karaganda'],
  ['костанайская область', 'kostanay'],
  ['кызылординская область', 'kyzylorda'],
  ['мангистауская область', 'mangystau'],
  ['павлодарская область', 'pavlodar'],
  ['северо казахстанская область', 'north-kazakhstan'],
  ['туркестанская область', 'turkistan'],
  ['область абай', 'abay'],
  ['абайская область', 'abay'],
  ['область улытау', 'ulytau'],
  ['область ұлытау', 'ulytau'],
  ['улытауская область', 'ulytau'],
]);

function normalizedPlace(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLocaleLowerCase('ru-RU')
    .replace(/ё/g, 'е')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function detectRegion(addressRu) {
  const text = String(addressRu || '');
  if (!text) return null;
  for (const [slug, label, pattern] of REGIONS) {
    if (pattern.test(text)) return slug;
  }
  return null;
}

function detectRegionFromParts({ region, city, address } = {}) {
  const cityKey = normalizedPlace(city);
  if (EXACT_REGION_LABELS.has(cityKey) && ['astana', 'almaty-city', 'shymkent', 'baikonur'].includes(EXACT_REGION_LABELS.get(cityKey))) {
    return EXACT_REGION_LABELS.get(cityKey);
  }
  const regionKey = normalizedPlace(region);
  if (EXACT_REGION_LABELS.has(regionKey)) return EXACT_REGION_LABELS.get(regionKey);
  return detectRegion([city, region, address].filter(Boolean).join(', '));
}

function regionLabel(slug) {
  const entry = REGIONS.find(r => r[0] === slug);
  return entry ? entry[1] : null;
}

module.exports = { EXACT_REGION_LABELS, REGIONS, detectRegion, detectRegionFromParts, regionLabel };
