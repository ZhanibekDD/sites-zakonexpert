'use strict';

const assert = require('assert');
const fs = require('fs');
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
assert.strictEqual(
  quality.extractRssImage({ mediaContent: { $: { url: 'https://publisher.kz/images/story-1200.jpg' } } }),
  'https://publisher.kz/images/story-1200.jpg'
);
assert.strictEqual(
  quality.extractRssImage({ content: '<p>Лид</p><img src="https://publisher.kz/images/story.webp">' }),
  'https://publisher.kz/images/story.webp'
);
assert.strictEqual(quality.normalizeSourceImage('https://publisher.kz/img/logo.png'), null);

const generated = quality.buildGeneratedContent(
  'ЧСИ наложил арест на банковский счёт должника',
  'Исполнительное производство возбуждено на основании исполнительного документа.'
);
assert.match(generated.event_summary, /юридический разбор/i);
assert.ok(generated.why_important.length > 300);
assert.ok(generated.legal_commentary.length > 500);
assert.ok(Array.isArray(generated.what_to_check) && generated.what_to_check.length >= 3);
assert.ok(generated.when_to_seek_help.length > 150);

const fixture = {
  slug: 'test-news',
  title: 'Старый шаблонный заголовок',
  original_title: 'Банк изменил порядок работы с просроченной задолженностью',
  excerpt: 'Банк сообщил об изменении порядка урегулирования просроченной задолженности для клиентов Казахстана.',
  original_excerpt: '',
  event_summary: 'Банк сообщил об изменении порядка урегулирования задолженности.\n\nZakonExpert объясняет последствия.',
  why_important: 'Изменение влияет на порядок взыскания и права должника.\n\nВажно проверить основание требования и соблюдение сроков.',
  legal_commentary: 'Сначала необходимо установить вид исполнительного документа.\n\n**Документы имеют значение:**\n— постановление ЧСИ\n— исполнительная надпись',
  what_to_check: JSON.stringify(['Номер исполнительного производства', 'Основание взыскания', 'Сумму задолженности']),
  when_to_seek_help: 'Обратитесь за помощью, если не получили документы, не согласны с суммой или пропустили срок обжалования.',
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

  const listWithSourceImages = await ejs.renderFile(path.join(views, 'list.ejs'), {
    title: 'Новости | ZakonExpert',
    description: 'Новости и юридические разборы Казахстана.',
    canonical: 'https://zakonexpertt.kz/news',
    articles: [fixture],
    currentPage: 1,
    totalPages: 1,
    currentCategory: null,
    allowSourceImages: true,
    schema: null,
  });
  assert.match(listWithSourceImages, /https:\/\/broken\.example\/image\.jpg/);
  assert.match(listWithSourceImages, /referrerpolicy="no-referrer"/);

  const detailHtml = await ejs.renderFile(path.join(views, 'detail.ejs'), {
    article: { ...fixture, display_title: fixture.original_title, display_excerpt: fixture.excerpt, display_cover: '/news/cover/test-news.svg' },
    related: [],
    schema: null,
  });
  assert.match(detailHtml, /<h1 itemprop="headline">Банк изменил порядок работы/);
  assert.match(detailHtml, /Банк сообщил об изменении порядка/);
  assert.match(detailHtml, /Почему это важно/);
  assert.match(detailHtml, /Юридический разбор ZakonExpert/);
  assert.match(detailHtml, /Что проверить прямо сейчас/);
  assert.match(detailHtml, /Когда нужна помощь специалиста/);
  assert.match(detailHtml, /\/news\/cover\/test-news\.svg/);
  assert.match(detailHtml, /rel="nofollow noopener noreferrer"/);

  const fallbackSvg = fs.readFileSync(path.join(__dirname, '..', 'public', 'img', 'news', 'news-cover-fallback-v2.svg'), 'utf8');
  assert.match(fallbackSvg, /^<svg[\s\S]+<\/svg>\s*$/);
  assert.doesNotMatch(fallbackSvg, /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/);

  console.log('News quality and template checks passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
