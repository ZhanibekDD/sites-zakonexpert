'use strict';

const REGION_EMBLEMS = Object.freeze({
  'Акмолинская область': 'akmola',
  'Актюбинская область': 'aktobe',
  'Алматинская область': 'almaty-region',
  'город Алматы': 'almaty-city',
  'город Астана': 'astana',
  'Атырауская область': 'atyrau',
  'Восточно-Казахстанская область': 'east-kazakhstan',
  'Жамбылская область': 'jambyl',
  'Западно-Казахстанская область': 'west-kazakhstan',
  'Карагандинская область': 'karaganda',
  'Кызылординская область': 'kyzylorda',
  'Костанайская область': 'kostanay',
  'Мангистауская область': 'mangystau',
  'Павлодарская область': 'pavlodar',
  'Северо-Казахстанская область': 'north-kazakhstan',
  'город Шымкент': 'shymkent',
  'Туркестанская область': 'turkistan',
  'область Абай': 'abai',
  'область Жетісу': 'jetisu',
  'область Ұлытау': 'ulytau',
});

const REGION_ALIASES = Object.freeze({
  'область Жетысу': 'область Жетісу',
  'область Улытау': 'область Ұлытау',
});

function getRegionEmblem(region) {
  const name = String(region || '').trim();
  return REGION_EMBLEMS[REGION_ALIASES[name] || name] || '';
}

module.exports = { REGION_EMBLEMS, getRegionEmblem };
