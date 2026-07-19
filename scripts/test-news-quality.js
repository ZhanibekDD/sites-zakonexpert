'use strict';

const assert = require('assert');
const path = require('path');
const ejs = require('ejs');
const { __test: quality } = require('../modules/news_importer');

assert.strictEqual(
  quality.cleanHeadline('Казахстанцам объяснили порядок снятия ареста — inform.kz'),
  'Казахстанцам объяснили порядок снятия ареста'
);

assert.strictEqual(
  quality.cleanExcerpt('Коротко', 'Заголовок'),
  ''
);

assert.match(
  quality.buildExcerpt('', '', 'Арест счёта'),
  /объясняем простым языком/i
);

assert.strictEqual(
  quality.isPrefilterRelevant('Ночной наезд на лошадь обернулся судебным разбирательством', ''),
  false
);

assert.strictEqual(
  quality.isPrefilterRelevant('ЧСИ наложил арест на банковский счёт должника', ''),
  true
);

assert.strictEqual(quality.normalizeCategory('кредит'), 'finance');
assert.strictEqual(quality.normalizeCategory('ЧСИ'), 'chsi');

const fixture = {
  slug: 'test-news',
  title: 'Старый шаблонный заголовок',
  original_title: 'Банк изменил порядок работы с просроченной задолженностью',
  excerpt: 'Банк сообщил об изменении порядка урегулирования просроченной задолженности для клиентов Казахстана.',
  original_excerpt: '',
  event_summary: 'Банк сообщил об изменении порядка урегулирования задолженности.\n\nZakonExpert объясняет последствия.',
  source_name: 'Тестовый источник',
  source_url: 'https://example.com/news',
  category: 'finance',
  tags: JSON.stringify(['банк', 'кредит']),
  category_cover: '/img/news/news-cover-bank.svg',
  og_image: 'https://broken.example/image.jpg',
  published_at_source: '2026-07-19T08:00:00.000Z',
  published_at_site: '2026-07-20T08:00:00.000Z',
  status: 'published',
};

(async () => {
  const views = path.join(__dirname, '..', 'views', 'news');
  const listHtml = await ejs.renderFile(path.join(views, 'list.ejs'), {
    title: 'Новости | ZakonExpert',
    description: 'Новости и юридические разборы Казахстана.',
    canonical: 'https://zakonexpertt.kz/news',
    articles: [fixture, { ...fixture, slug: 'test-news-2' }, { ...fixture, slug: 'test-news-3' }],
    currentPage: 1,
    totalPages: 1,
    currentCategory: null,
    allowSourceImages: false,
    schema: null,
  });
  assert.match(listHtml, /Банк изменил порядок работы/);
  assert.match(listHtml, /Лента обновляется автоматически/);
  assert.doesNotMatch(listHtml, /broken\.example/);

  const detailHtml = await ejs.renderFile(path.join(views, 'detail.ejs'), {
    article: { ...fixture, display_title: fixture.original_title, display_excerpt: fixture.excerpt },
    related: [],
    schema: null,
  });
  assert.match(detailHtml, /<h1 itemprop="headline">Банк изменил порядок работы/);
  assert.match(detailHtml, /Банк сообщил об изменении порядка/);

  console.log('News quality and template checks passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
