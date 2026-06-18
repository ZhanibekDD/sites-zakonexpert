/**
 * Парсер статей законов РК с adilet.zan.kz
 * Запуск: node scripts/scrape-laws.js [код_закона]
 * Примеры: node scripts/scrape-laws.js uk
 *          node scripts/scrape-laws.js (все законы)
 */
'use strict';

require('dotenv').config();
const axios   = require('axios');
const cheerio = require('cheerio');
const path    = require('path');
const lawsDb  = require('../modules/laws-db');

const LAWS = [
  {
    code:      'uk',
    codeName:  'УК РК',
    shortName: 'uk-rk',
    fullName:  'Уголовный кодекс Республики Казахстан',
    url:       'https://adilet.zan.kz/rus/docs/K1400000226',
  },
  {
    code:      'upk',
    codeName:  'УПК РК',
    shortName: 'upk-rk',
    fullName:  'Уголовно-процессуальный кодекс Республики Казахстан',
    url:       'https://adilet.zan.kz/rus/docs/K1400000231',
  },
  {
    code:      'koap',
    codeName:  'КоАП РК',
    shortName: 'koap-rk',
    fullName:  'Кодекс Республики Казахстан об административных правонарушениях',
    url:       'https://adilet.zan.kz/rus/docs/K1400000235',
  },
  {
    code:      'gk',
    codeName:  'ГК РК',
    shortName: 'gk-rk',
    fullName:  'Гражданский кодекс Республики Казахстан (Общая часть)',
    url:       'https://adilet.zan.kz/rus/docs/K940001000_',
  },
  {
    code:      'gk',
    codeName:  'ГК РК',
    shortName: 'gk-rk',
    fullName:  'Гражданский кодекс Республики Казахстан (Особенная часть)',
    url:       'https://adilet.zan.kz/rus/docs/K990000409_',
  },
  {
    code:      'sk',
    codeName:  'СК РК',
    shortName: 'sk-rk',
    fullName:  'Кодекс Республики Казахстан о браке (супружестве) и семье',
    url:       'https://adilet.zan.kz/rus/docs/K110000518_',
  },
  {
    code:      'tk',
    codeName:  'ТК РК',
    shortName: 'tk-rk',
    fullName:  'Трудовой кодекс Республики Казахстан',
    url:       'https://adilet.zan.kz/rus/docs/K1500000414',
  },
];

// Статья 96. / Статья 96-1. / Статья 96.1.
const ART_RE = /^Статья\s+(\d+(?:[.\-]\d+)?)\.\s*(.*)/;

const HEADERS = {
  'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  'Accept-Language': 'ru-RU,ru;q=0.9',
  'Accept':          'text/html,application/xhtml+xml',
};

async function fetchText(url) {
  const r = await axios.get(url, { headers: HEADERS, timeout: 60000, maxContentLength: 50 * 1024 * 1024 });
  return r.data;
}

function parseArticles(html, law) {
  const $ = cheerio.load(html);

  // Collect all text paragraphs in document order
  const paras = [];
  $('p, td, li').each((_, el) => {
    const t = $(el).clone()
      .find('script,style').remove().end()
      .text().trim().replace(/\s+/g, ' ');
    if (t.length > 2) paras.push(t);
  });

  const articles = [];
  let cur = null;

  for (const para of paras) {
    const m = para.match(ART_RE);
    if (m) {
      if (cur && cur.text.trim().length > 0) articles.push(cur);
      cur = {
        code:      law.code,
        codeName:  law.codeName,
        shortName: law.shortName,
        fullName:  law.fullName,
        num:       m[1],
        numInt:    parseInt(m[1]),
        title:     m[2].trim() || `Статья ${m[1]}`,
        text:      '',
        updatedAt: new Date(),
      };
    } else if (cur) {
      // Stop collecting if we hit another major heading (Глава, Раздел)
      if (/^(Глава|Раздел|ГЛАВА|РАЗДЕЛ)\s+\d+/.test(para) && para.length < 200) {
        // Keep chapter info but don't add to text
        cur.chapter = para;
      } else if (cur.text.length < 8000) {
        cur.text += (cur.text ? '\n' : '') + para;
      }
    }
  }
  if (cur && cur.text.trim().length > 0) articles.push(cur);

  return articles;
}

async function scrapeLaw(law) {
  console.log(`\n📥 Загружаем ${law.codeName} — ${law.fullName}`);
  console.log(`   URL: ${law.url}`);

  let html;
  try {
    html = await fetchText(law.url);
  } catch (e) {
    console.error(`   ❌ Ошибка загрузки: ${e.message}`);
    return 0;
  }

  const articles = parseArticles(html, law);
  console.log(`   📋 Найдено статей: ${articles.length}`);

  let saved = 0;
  for (const art of articles) {
    const numSlug = art.num.replace(/\./g, '-');
    art.slug = `${law.shortName}-${numSlug}`;
    try {
      await lawsDb.upsert(art);
      saved++;
    } catch (e) {
      // Duplicate slug from different law parts — skip silently
    }
  }

  console.log(`   ✅ Сохранено: ${saved} статей`);
  return saved;
}

async function main() {
  const filterCode = process.argv[2]; // e.g. "uk", "upk", "koap"

  const toScrape = filterCode
    ? LAWS.filter(l => l.code === filterCode)
    : LAWS;

  if (!toScrape.length) {
    console.log(`Нет закона с кодом "${filterCode}". Доступные: ${[...new Set(LAWS.map(l => l.code))].join(', ')}`);
    process.exit(1);
  }

  let total = 0;
  for (const law of toScrape) {
    total += await scrapeLaw(law);
    if (toScrape.length > 1) await new Promise(r => setTimeout(r, 3000)); // задержка между запросами
  }

  const count = await lawsDb.count();
  console.log(`\n🎉 Готово! Всего статей в базе: ${count}`);
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
