'use strict';

const slugify = require('slugify');
const governmentSectorSeed = require('../data/open-data-government-sector-seed.json');

const DATA_EGOV_BASE = 'https://data.egov.kz';

function source(index, version) {
  return {
    datasetUrl: `${DATA_EGOV_BASE}/datasets/view?index=${index}`,
    apiUrl: `${DATA_EGOV_BASE}/api/v4/${index}/${version}`,
    metaUrl: `${DATA_EGOV_BASE}/meta/${index}/${version}`,
  };
}

const CURATED_DATASETS = [
  {
    key: 'audit-commissions-2026-q2',
    kind: 'audit',
    path: '/otkrytye-dannye/revizionnye-komissii-2-kvartal-2026',
    index: 'opendata-api-uri1787649025620',
    version: 'v8',
    sourceFile: 'opendata-api-uri1787649025620-v8.json',
    title: 'Основные показатели деятельности ревизионных комиссий за 2 квартал 2026 года',
    shortTitle: 'Показатели ревизионных комиссий',
    description: 'Показатели аудиторских мероприятий ревизионных комиссий областей, городов республиканского значения и столицы за 2 квартал 2026 года.',
    category: 'Государственный сектор',
    agency: 'Высшая аудиторская палата Республики Казахстан',
    publishedAt: '2026-08-25T14:05:00+05:00',
    updatedAt: '2026-08-25T16:27:00+05:00',
    updateFrequency: 'Ежеквартально',
    ...source('opendata-api-uri1787649025620', 'v8'),
  },
  {
    key: 'children-rehabilitation-alatau-2026-h1',
    kind: 'rehabilitation',
    path: '/otkrytye-dannye/reabilitaciya-detey-alatau-2026',
    index: 'number_of_children_who_underwe14',
    version: 'v1',
    sourceFile: 'number_of_children_who_underwe14-v1.json',
    title: 'Количество детей, прошедших реабилитацию за 6 месяцев 2026 года',
    shortTitle: 'Реабилитация детей в санатории «Алатау»',
    description: 'Официальный набор о количестве детей, прошедших реабилитацию в детском клиническом санатории «Алатау» за первое полугодие 2026 года.',
    category: 'Здравоохранение',
    agency: 'РГП на ПХВ «Детский клинический санаторий «Алатау»',
    publishedAt: '2026-08-24T10:23:00+05:00',
    updatedAt: '2026-08-24T10:24:00+05:00',
    updateFrequency: 'Ежеквартально',
    ...source('number_of_children_who_underwe14', 'v1'),
  },
  {
    key: 'housing-received-akmola', kind: 'housing_received', regionSlug: 'akmolinskaya-oblast',
    regionName: 'Акмолинская область', regionPrepositional: 'Акмолинской области',
    path: '/zhilishchnye-spiski/poluchili-zhile/akmolinskaya-oblast',
    index: 'list_of_citizens_who_received_1', version: 'v3', sourceFile: 'list_of_citizens_who_received_1-v3.json',
    title: 'Список граждан, получивших жильё из коммунального жилищного фонда по Акмолинской области',
    description: 'Обезличенная статистика официального списка граждан, получивших коммунальное жильё в Акмолинской области.',
    category: 'Государственный сектор', agency: 'АО «Отбасы банк»',
    publishedAt: '2026-04-21T16:32:00+05:00', updatedAt: '2026-07-16T10:45:00+05:00', updateFrequency: 'Ежеквартально',
    ...source('list_of_citizens_who_received_1', 'v3'),
  },
  {
    key: 'housing-received-shymkent', kind: 'housing_received', regionSlug: 'shymkent',
    regionName: 'Шымкент', regionPrepositional: 'Шымкенте',
    path: '/zhilishchnye-spiski/poluchili-zhile/shymkent',
    index: 'shymkent_kalasy_boiynsha_kommu', version: 'v3', sourceFile: 'shymkent_kalasy_boiynsha_kommu-v3.json',
    title: 'Список граждан, получивших жильё из коммунального жилищного фонда в городе Шымкент',
    description: 'Обезличенная статистика официального списка граждан, получивших коммунальное жильё в Шымкенте.',
    category: 'Государственный сектор', agency: 'АО «Отбасы банк»',
    publishedAt: '2026-01-29T10:27:00+05:00', updatedAt: '2026-07-16T10:49:00+05:00', updateFrequency: 'Ежеквартально',
    ...source('shymkent_kalasy_boiynsha_kommu', 'v3'),
  },
  {
    key: 'housing-received-mangystau', kind: 'housing_received', regionSlug: 'mangistauskaya-oblast',
    regionName: 'Мангистауская область', regionPrepositional: 'Мангистауской области',
    path: '/zhilishchnye-spiski/poluchili-zhile/mangistauskaya-oblast',
    index: 'mangystau_oblysy_boiynsha_komm12', version: 'v2', sourceFile: 'mangystau_oblysy_boiynsha_komm12-v2.json',
    title: 'Список граждан, получивших жильё из коммунального жилищного фонда в Мангистауской области',
    description: 'Обезличенная статистика официального списка граждан, получивших коммунальное жильё в Мангистауской области.',
    category: 'Государственный сектор', agency: 'АО «Отбасы банк»',
    publishedAt: '2026-01-29T10:18:00+05:00', updatedAt: '2026-07-16T10:52:00+05:00', updateFrequency: 'Ежеквартально',
    ...source('mangystau_oblysy_boiynsha_komm12', 'v2'),
  },
  {
    key: 'housing-received-kyzylorda', kind: 'housing_received', regionSlug: 'kyzylordinskaya-oblast',
    regionName: 'Кызылординская область', regionPrepositional: 'Кызылординской области',
    path: '/zhilishchnye-spiski/poluchili-zhile/kyzylordinskaya-oblast',
    index: 'opendata-api-uri1769663394007', version: 'v3', sourceFile: 'opendata-api-uri1769663394007-v3.json',
    title: 'Список граждан, получивших жильё из коммунального жилищного фонда в Кызылординской области',
    description: 'Обезличенная статистика официального списка граждан, получивших коммунальное жильё в Кызылординской области.',
    category: 'Государственный сектор', agency: 'АО «Отбасы банк»',
    publishedAt: '2026-01-29T10:09:00+05:00', updatedAt: '2026-07-16T10:56:00+05:00', updateFrequency: 'Ежеквартально',
    ...source('opendata-api-uri1769663394007', 'v3'),
  },
  {
    key: 'housing-waitlist-akmola', kind: 'housing_waitlist', regionSlug: 'akmolinskaya-oblast',
    regionName: 'Акмолинская область', regionPrepositional: 'Акмолинской области',
    path: '/zhilishchnye-spiski/ochered-na-zhile/akmolinskaya-oblast',
    index: 'akmola_oblysy_boiynsha_turgyn_', version: 'v3', sourceFile: 'akmola_oblysy_boiynsha_turgyn_-v3.json',
    title: 'Список граждан, состоящих на учёте как нуждающиеся в жилище в Акмолинской области',
    description: 'Обезличенная статистика официального списка граждан, состоящих на учёте как нуждающиеся в жилье в Акмолинской области.',
    category: 'Государственный сектор', agency: 'АО «Отбасы банк»',
    publishedAt: '2026-01-16T13:16:00+05:00', updatedAt: '2026-07-02T11:13:00+05:00', updateFrequency: 'Ежеквартально',
    ...source('akmola_oblysy_boiynsha_turgyn_', 'v3'),
  },
  {
    key: 'housing-waitlist-almaty', kind: 'housing_waitlist', regionSlug: 'almaty',
    regionName: 'Алматы', regionPrepositional: 'Алматы',
    path: '/zhilishchnye-spiski/ochered-na-zhile/almaty',
    index: 'almaty_kalasy_boiynsha_turgyn_', version: 'v3', sourceFile: 'almaty_kalasy_boiynsha_turgyn_-v3.json',
    title: 'Список граждан, состоящих на учёте как нуждающиеся в жилище в городе Алматы',
    description: 'Обезличенная статистика официального списка граждан, состоящих на учёте как нуждающиеся в жилье в Алматы.',
    category: 'Государственный сектор', agency: 'АО «Отбасы банк»',
    publishedAt: '2026-01-16T13:11:00+05:00', updatedAt: '2026-07-02T09:48:00+05:00', updateFrequency: 'Ежеквартально',
    ...source('almaty_kalasy_boiynsha_turgyn_', 'v3'),
  },
  {
    key: 'housing-waitlist-kostanay', kind: 'housing_waitlist', regionSlug: 'kostanayskaya-oblast',
    regionName: 'Костанайская область', regionPrepositional: 'Костанайской области',
    path: '/zhilishchnye-spiski/ochered-na-zhile/kostanayskaya-oblast',
    index: 'kostanai_oblysy_boiynsha_turgy1', version: 'v3', sourceFile: 'kostanai_oblysy_boiynsha_turgy1-v3.json',
    title: 'Список граждан, состоящих на учёте как нуждающиеся в жилище в Костанайской области',
    description: 'Обезличенная статистика официального списка граждан, состоящих на учёте как нуждающиеся в жилье в Костанайской области.',
    category: 'Государственный сектор', agency: 'АО «Отбасы банк»',
    publishedAt: '2026-01-16T13:06:00+05:00', updatedAt: '2026-07-02T11:12:00+05:00', updateFrequency: 'Ежеквартально',
    ...source('kostanai_oblysy_boiynsha_turgy1', 'v3'),
  },
  {
    key: 'housing-waitlist-ulytau', kind: 'housing_waitlist', regionSlug: 'ulytau',
    regionName: 'область Ұлытау', regionPrepositional: 'области Ұлытау',
    path: '/zhilishchnye-spiski/ochered-na-zhile/ulytau',
    index: 'ulytau_oblysy_boiynsha_turgyn_', version: 'v3', sourceFile: 'ulytau_oblysy_boiynsha_turgyn_-v3.json',
    title: 'Список граждан, состоящих на учёте как нуждающиеся в жилище в области Ұлытау',
    description: 'Обезличенная статистика официального списка граждан, состоящих на учёте как нуждающиеся в жилье в области Ұлытау.',
    category: 'Государственный сектор', agency: 'АО «Отбасы банк»',
    publishedAt: '2026-01-16T12:59:00+05:00', updatedAt: '2026-07-02T11:10:00+05:00', updateFrequency: 'Ежеквартально',
    ...source('ulytau_oblysy_boiynsha_turgyn_', 'v3'),
  },
];

function genericDatasetDefinition(dataset) {
  const index = String(dataset.index || '').trim();
  const title = String(dataset.title || index || 'Набор открытых данных').trim();
  const slugBase = slugify(title, { lower: true, strict: true, locale: 'ru' }).slice(0, 82) || 'nabor-dannyh';
  const suffix = index.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').slice(-18).toLowerCase();
  return {
      key: `government-sector-${index}`,
      kind: 'government_sector',
      path: `/otkrytye-dannye/gosudarstvennyy-sektor/${slugBase}-${suffix}`,
      index,
      version: '',
      sourceFile: '',
      title,
      shortTitle: title,
      description: `Понятный срез официального набора «${title}» из категории «Государственный сектор».`,
      category: 'Государственный сектор',
      agency: 'Уточняется по паспорту data.egov.kz',
      publishedAt: '',
      updatedAt: '',
      updateFrequency: '',
      datasetUrl: `${DATA_EGOV_BASE}/datasets/view?index=${index}`,
      apiUrl: '',
      metaUrl: '',
    };
}

const curatedIndexes = new Set(CURATED_DATASETS.map(dataset => dataset.index));
const genericDatasets = governmentSectorSeed
  .filter(dataset => !curatedIndexes.has(dataset.index))
  .map(genericDatasetDefinition);

const OPEN_DATA_DATASETS = CURATED_DATASETS.concat(genericDatasets);

const OPEN_DATA_BY_KEY = new Map(OPEN_DATA_DATASETS.map(dataset => [dataset.key, Object.freeze(dataset)]));

module.exports = {
  OPEN_DATA_DATASETS: Object.freeze(OPEN_DATA_DATASETS.map(Object.freeze)),
  OPEN_DATA_BY_KEY,
  genericDatasetDefinition,
};
