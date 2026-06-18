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
const https   = require('https');
const path    = require('path');
const lawsDb  = require('../modules/laws-db');

// adilet.zan.kz uses a cert that doesn't verify locally
const httpsAgent = new https.Agent({ rejectUnauthorized: false });

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
    url:       'https://adilet.zan.kz/rus/docs/K1100000518',
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
  const r = await axios.get(url, { headers: HEADERS, timeout: 60000, maxContentLength: 50 * 1024 * 1024, httpsAgent });
  return r.data;
}

function parseArticles(html, law) {
  const $ = cheerio.load(html);

  // adilet.zan.kz: article headers are in <h3>, text in <p>
  // Also seen in <b> and <span> for some codes
  const ART_IN_H = /Статья\s+(\d+(?:[.\-]\d+)?)\.\s*(.*)/;

  const articles = [];
  let cur        = null;
  let chapter    = '';

  // Walk h3 + p + li + b in document order
  $('h3, p, li, b, span').each((_, el) => {
    const tag  = el.tagName.toLowerCase();
    const raw  = $(el).text();
    // Normalize: replace &nbsp; sequences and collapse whitespace
    const text = raw.replace(/ /g, ' ').replace(/\s+/g, ' ').trim();

    if (!text) return;

    // Chapter / section heading (not an article)
    if ((tag === 'h3' || tag === 'h2') && /^(ОБЩАЯ|ОСОБЕННАЯ|РАЗДЕЛ|ГЛАВА|Раздел|Глава)\b/.test(text)) {
      chapter = text.slice(0, 120);
      return;
    }

    // Article heading
    const m = (tag === 'h3' || tag === 'b') ? text.match(ART_IN_H) : null;
    if (m) {
      if (cur && cur.text.trim()) articles.push(cur);
      cur = {
        code:      law.code,
        codeName:  law.codeName,
        shortName: law.shortName,
        fullName:  law.fullName,
        chapter,
        num:       m[1],
        numInt:    parseInt(m[1]),
        title:     m[2].trim() || `Статья ${m[1]}`,
        text:      '',
        updatedAt: new Date(),
      };
      return;
    }

    // Article body: paragraphs and list items
    if (cur && (tag === 'p' || tag === 'li') && cur.text.length < 12000) {
      cur.text += (cur.text ? '\n' : '') + text;
    }
  });

  if (cur && cur.text.trim()) articles.push(cur);
  return articles;
}

async function scrapeLaw(law, debug = false) {
  console.log(`\n📥 Загружаем ${law.codeName} — ${law.fullName}`);
  console.log(`   URL: ${law.url}`);

  let html;
  try {
    html = await fetchText(law.url);
  } catch (e) {
    console.error(`   ❌ Ошибка загрузки: ${e.message}`);
    return 0;
  }

  if (debug) {
    const cheerio = require('cheerio');
    const $ = cheerio.load(html);
    console.log(`\n🔍 DEBUG: HTML size = ${html.length} bytes`);
    console.log(`   Body text (first 3000 chars):\n---`);
    console.log($('body').text().replace(/\s+/g,' ').slice(0, 3000));
    console.log(`---`);
    // Find first 10 paragraphs
    const paras = [];
    $('p, td, div').each((_, el) => {
      const t = $(el).text().trim().replace(/\s+/g,' ');
      if (t.length > 10 && t.length < 500) paras.push(t);
    });
    console.log(`\n   First 20 text blocks:`);
    paras.slice(0, 20).forEach((p,i) => console.log(`   [${i}] ${p.slice(0,120)}`));
    process.exit(0);
  }

  const articles = parseArticles(html, law);
  console.log(`   📋 Найдено статей: ${articles.length}`);

  let saved = 0;
  for (const art of articles) {
    const numSlug = art.num.replace(/\./g, '-');
    art.slug = `${law.shortName}-${numSlug}`;
    // Generate short snippet for list cards (no re-scrape needed later)
    if (art.text) {
      let sn = art.text.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300);
      const ls = sn.lastIndexOf(' ');
      if (ls > 200) sn = sn.slice(0, ls);
      art.snippet = sn;
    }
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
  const filterCode = process.argv[2]; // e.g. "uk", "upk", "koap", "debug-uk"
  const isDebug    = filterCode && filterCode.startsWith('debug-');
  const codeFilter = isDebug ? filterCode.replace('debug-', '') : filterCode;

  const toScrape = codeFilter
    ? LAWS.filter(l => l.code === codeFilter)
    : LAWS;

  if (!toScrape.length) {
    console.log(`Нет закона с кодом "${filterCode}". Доступные: ${[...new Set(LAWS.map(l => l.code))].join(', ')}`);
    process.exit(1);
  }

  let total = 0;
  for (const law of toScrape) {
    total += await scrapeLaw(law, isDebug);
    if (toScrape.length > 1) await new Promise(r => setTimeout(r, 3000)); // задержка между запросами
  }

  const count = await lawsDb.count();
  console.log(`\n🎉 Готово! Всего статей в базе: ${count}`);
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
