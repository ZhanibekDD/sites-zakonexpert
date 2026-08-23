'use strict';

const BAILIFF_REGION_BASE_PATH = '/bailiffs';

const BAILIFF_REGIONS = Object.freeze([
  { slug: 'astana', sourceName: 'город Астана', genitive: 'Астаны', displayName: 'Астана', aliases: ['Астана', 'г. Астана'] },
  { slug: 'almaty', sourceName: 'город Алматы', genitive: 'Алматы', displayName: 'Алматы', aliases: ['Алматы', 'г. Алматы'] },
  { slug: 'shymkent', sourceName: 'город Шымкент', genitive: 'Шымкента', displayName: 'Шымкент', aliases: ['Шымкент', 'г. Шымкент'] },
  { slug: 'almatinskaya-oblast', sourceName: 'Алматинская область', genitive: 'Алматинской области', displayName: 'Алматинская область' },
  { slug: 'karagandinskaya-oblast', sourceName: 'Карагандинская область', genitive: 'Карагандинской области', displayName: 'Карагандинская область' },
  { slug: 'turkestanskaya-oblast', sourceName: 'Туркестанская область', genitive: 'Туркестанской области', displayName: 'Туркестанская область' },
  { slug: 'aktyubinskaya-oblast', sourceName: 'Актюбинская область', genitive: 'Актюбинской области', displayName: 'Актюбинская область' },
  { slug: 'pavlodarskaya-oblast', sourceName: 'Павлодарская область', genitive: 'Павлодарской области', displayName: 'Павлодарская область' },
  { slug: 'kostanayskaya-oblast', sourceName: 'Костанайская область', genitive: 'Костанайской области', displayName: 'Костанайская область' },
  { slug: 'vostochno-kazahstanskaya-oblast', sourceName: 'Восточно-Казахстанская область', genitive: 'Восточно-Казахстанской области', displayName: 'Восточно-Казахстанская область' },
  { slug: 'zapadno-kazahstanskaya-oblast', sourceName: 'Западно-Казахстанская область', genitive: 'Западно-Казахстанской области', displayName: 'Западно-Казахстанская область' },
  { slug: 'zhambylskaya-oblast', sourceName: 'Жамбылская область', genitive: 'Жамбылской области', displayName: 'Жамбылская область' },
  { slug: 'akmolinskaya-oblast', sourceName: 'Акмолинская область', genitive: 'Акмолинской области', displayName: 'Акмолинская область' },
  { slug: 'atyrauskaya-oblast', sourceName: 'Атырауская область', genitive: 'Атырауской области', displayName: 'Атырауская область' },
  { slug: 'mangistauskaya-oblast', sourceName: 'Мангистауская область', genitive: 'Мангистауской области', displayName: 'Мангистауская область' },
  { slug: 'kyzylordinskaya-oblast', sourceName: 'Кызылординская область', genitive: 'Кызылординской области', displayName: 'Кызылординская область' },
  { slug: 'abay', sourceName: 'область Абай', genitive: 'области Абай', displayName: 'область Абай' },
  { slug: 'zhetisu', sourceName: 'область Жетысу', genitive: 'области Жетісу', displayName: 'область Жетісу', aliases: ['область Жетісу'] },
  { slug: 'severo-kazahstanskaya-oblast', sourceName: 'Северо-Казахстанская область', genitive: 'Северо-Казахстанской области', displayName: 'Северо-Казахстанская область' },
  { slug: 'ulytau', sourceName: 'область Улытау', genitive: 'области Ұлытау', displayName: 'область Ұлытау', aliases: ['область Ұлытау'] },
].map(region => Object.freeze({
  ...region,
  path: `${BAILIFF_REGION_BASE_PATH}/${region.slug}`,
  aliases: Object.freeze([region.sourceName, ...(region.aliases || [])]),
})));

const REGION_BY_SLUG = new Map(BAILIFF_REGIONS.map(region => [region.slug, region]));
const REGION_BY_NAME = new Map();

function normalizeRegionName(value) {
  return String(value || '')
    .trim()
    .toLocaleLowerCase('ru-RU')
    .replace(/^г\.\s*/u, 'город ')
    .replace(/\s+/g, ' ');
}

BAILIFF_REGIONS.forEach(region => {
  region.aliases.forEach(alias => REGION_BY_NAME.set(normalizeRegionName(alias), region));
});

function getBailiffRegionBySlug(slug) {
  return REGION_BY_SLUG.get(String(slug || '').trim().toLowerCase()) || null;
}

function getBailiffRegionByName(name) {
  return REGION_BY_NAME.get(normalizeRegionName(name)) || null;
}

function withBailiffRegionPaths(regions) {
  return (regions || []).map(item => {
    const region = getBailiffRegionByName(item.region);
    return { ...item, path: region ? region.path : `${BAILIFF_REGION_BASE_PATH}?region=${encodeURIComponent(item.region)}` };
  });
}

module.exports = {
  BAILIFF_REGION_BASE_PATH,
  BAILIFF_REGIONS,
  getBailiffRegionBySlug,
  getBailiffRegionByName,
  withBailiffRegionPaths,
};
