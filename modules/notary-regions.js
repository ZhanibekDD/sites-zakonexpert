'use strict';

const NOTARY_REGION_BASE_PATH = '/notaries';

const NOTARY_REGIONS = Object.freeze([
  { slug: 'astana', sourceName: 'город Астана', genitive: 'Астаны', displayName: 'Астана', aliases: ['Астана', 'г. Астана'] },
  { slug: 'almaty', sourceName: 'город Алматы', genitive: 'Алматы', displayName: 'Алматы', aliases: ['Алматы', 'г. Алматы'] },
  { slug: 'shymkent', sourceName: 'город Шымкент', genitive: 'Шымкента', displayName: 'Шымкент', aliases: ['Шымкент', 'г. Шымкент'] },
  { slug: 'akmolinskaya-oblast', sourceName: 'Акмолинская область', genitive: 'Акмолинской области', displayName: 'Акмолинская область' },
  { slug: 'aktyubinskaya-oblast', sourceName: 'Актюбинская область', genitive: 'Актюбинской области', displayName: 'Актюбинская область' },
  { slug: 'almatinskaya-oblast', sourceName: 'Алматинская область', genitive: 'Алматинской области', displayName: 'Алматинская область' },
  { slug: 'atyrauskaya-oblast', sourceName: 'Атырауская область', genitive: 'Атырауской области', displayName: 'Атырауская область' },
  { slug: 'vostochno-kazahstanskaya-oblast', sourceName: 'Восточно-Казахстанская область', genitive: 'Восточно-Казахстанской области', displayName: 'Восточно-Казахстанская область' },
  { slug: 'zhambylskaya-oblast', sourceName: 'Жамбылская область', genitive: 'Жамбылской области', displayName: 'Жамбылская область' },
  { slug: 'zapadno-kazahstanskaya-oblast', sourceName: 'Западно-Казахстанская область', genitive: 'Западно-Казахстанской области', displayName: 'Западно-Казахстанская область' },
  { slug: 'karagandinskaya-oblast', sourceName: 'Карагандинская область', genitive: 'Карагандинской области', displayName: 'Карагандинская область' },
  { slug: 'kyzylordinskaya-oblast', sourceName: 'Кызылординская область', genitive: 'Кызылординской области', displayName: 'Кызылординская область' },
  { slug: 'kostanayskaya-oblast', sourceName: 'Костанайская область', genitive: 'Костанайской области', displayName: 'Костанайская область' },
  { slug: 'mangistauskaya-oblast', sourceName: 'Мангистауская область', genitive: 'Мангистауской области', displayName: 'Мангистауская область' },
  { slug: 'pavlodarskaya-oblast', sourceName: 'Павлодарская область', genitive: 'Павлодарской области', displayName: 'Павлодарская область' },
  { slug: 'severo-kazahstanskaya-oblast', sourceName: 'Северо-Казахстанская область', genitive: 'Северо-Казахстанской области', displayName: 'Северо-Казахстанская область' },
  { slug: 'turkestanskaya-oblast', sourceName: 'Туркестанская область', genitive: 'Туркестанской области', displayName: 'Туркестанская область' },
  { slug: 'abay', sourceName: 'область Абай', genitive: 'области Абай', displayName: 'область Абай' },
  { slug: 'zhetisu', sourceName: 'область Жетісу', genitive: 'области Жетісу', displayName: 'область Жетісу', aliases: ['область Жетысу'] },
  { slug: 'ulytau', sourceName: 'область Ұлытау', genitive: 'области Ұлытау', displayName: 'область Ұлытау', aliases: ['область Улытау'] },
].map(region => Object.freeze({
  ...region,
  path: `${NOTARY_REGION_BASE_PATH}/${region.slug}`,
  aliases: Object.freeze([region.sourceName, ...(region.aliases || [])]),
})));

const REGION_BY_SLUG = new Map(NOTARY_REGIONS.map(region => [region.slug, region]));
const REGION_BY_NAME = new Map();

function normalizeRegionName(value) {
  return String(value || '')
    .trim()
    .toLocaleLowerCase('ru-RU')
    .replace(/^г\.\s*/u, 'город ')
    .replace(/\s+/g, ' ');
}

NOTARY_REGIONS.forEach(region => {
  region.aliases.forEach(alias => REGION_BY_NAME.set(normalizeRegionName(alias), region));
});

function getNotaryRegionBySlug(slug) {
  return REGION_BY_SLUG.get(String(slug || '').trim().toLowerCase()) || null;
}

function getNotaryRegionByName(name) {
  return REGION_BY_NAME.get(normalizeRegionName(name)) || null;
}

function withNotaryRegionPaths(regions) {
  return (regions || []).map(item => {
    const region = getNotaryRegionByName(item.region);
    return { ...item, path: region ? region.path : `${NOTARY_REGION_BASE_PATH}?region=${encodeURIComponent(item.region)}` };
  });
}

module.exports = {
  NOTARY_REGION_BASE_PATH,
  NOTARY_REGIONS,
  getNotaryRegionBySlug,
  getNotaryRegionByName,
  withNotaryRegionPaths,
};
