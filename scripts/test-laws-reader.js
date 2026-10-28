'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ejs = require('ejs');

const ROOT = path.join(__dirname, '..');

async function render(view, data) {
  return ejs.renderFile(path.join(ROOT, 'views', 'laws', view), data);
}

async function run() {
  await require('./test-upk-content').run();
  const listHtml = await render('list.ejs', {
    q: '<img src=x onerror=alert(1)>',
    code: 'uk',
    codes: [{ code: 'uk', codeName: 'УК РК' }],
    articles: [{
      slug: 'uk-rk-190',
      num: '190',
      codeName: 'УК РК',
      title: 'Мошенничество',
      snippet: 'Завладение чужим имуществом путём обмана.',
    }],
    total: 61,
    page: 2,
    pages: 3,
  });
  assert(!listHtml.includes('<img src=x onerror=alert(1)>'), 'Search query must be escaped');
  assert(listHtml.includes('tel:+77777457577'), 'Advocate phone must be used in the consultation card');
  assert(listHtml.includes('/css/laws-reader.css'), 'Reader stylesheet must be loaded');
  assert(listHtml.includes('noindex,follow'), 'Search results must not be indexed');

  const articleHtml = await render('article.ejs', {
    article: {
      slug: 'uk-rk-190',
      num: '190',
      numInt: 190,
      code: 'uk',
      codeName: 'УК РК',
      title: 'Мошенничество <script>alert(1)</script>',
      text: '1. Завладение имуществом <script>alert(2)</script>.\nнаказывается лишением свободы.',
    },
    adjacent: {},
    related: [],
    codes: [],
  });
  assert(!articleHtml.includes('<script>alert(1)</script>'), 'Article title must be escaped');
  assert(!articleHtml.includes('<script>alert(2)</script>'), 'Article body must be escaped');
  assert(articleHtml.includes('data-reading-progress'), 'Reading progress must be present');
  assert(articleHtml.includes('data-reader-size="xlarge"'), 'Font controls must be present');
  assert(articleHtml.includes('tel:+77003097566'), 'Article CTA must call ZakonExpert directly');
  assert(!articleHtml.includes('tel:+77777457577') && !articleHtml.includes('/img/advocate/maulen-erzhanov.jpg'), 'Article must not render the retired personal advocate CTA');

  const upk = require('../config/law-sources/upk-rk-repair-2026-10-28.json').articles.find(article => article.num === '64');
  const upkHtml = await render('article.ejs', {
    article: { ...upk, sourceUrl: 'https://adilet.zan.kz/rus/docs/K1400000231#z509' },
    adjacent: {}, related: [], codes: [],
  });
  assert(upkHtml.includes('Подозреваемым является лицо'), 'Public article must render the repaired body');
  assert(upkHtml.includes('Сноска. Статья 64'), 'Official amendment notes must remain visible');
  assert(upkHtml.includes('href="https://adilet.zan.kz/rus/docs/K1400000231#z509"'), 'Source link must point to the exact official article');

  const advocateHtml = fs.readFileSync(path.join(ROOT, 'public', 'advocate.html'), 'utf8');
  assert(advocateHtml.includes('id="adv-articles"'), 'Advocate page must include the legal reading section');
  assert(advocateHtml.includes('Можете ознакомиться со статьями законов'), 'Advocate page must introduce the articles');

  process.stdout.write('Law reader checks passed\n');
}

run().catch(error => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
