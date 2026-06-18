'use strict';
/**
 * Scraper: emails ЧСИ с kredit-zakryt.kz
 * Запуск: node scripts/scrape-bailiff-emails.js
 * Возобновление: повторный запуск — пропускает уже обработанные
 */

const axios    = require('axios');
const cheerio  = require('cheerio');
const path     = require('path');
const fs       = require('fs');
const Datastore = require('nedb-promises');

const BASE     = 'https://kredit-zakryt.kz';
const LIST_URL = `${BASE}/spisok-chastnyh-sudebnyh-ispolnitelej-respubliki-kazahstan/`;
const DELAY    = 1200; // мс между запросами
const PROGRESS = path.join(__dirname, '..', 'data', 'bailiff-email-progress.json');

const db = Datastore.create({
  filename: path.join(__dirname, '..', 'data', 'bailiffs.db'),
  autoload: true,
});

const HEADERS = {
  'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36',
  'Accept':          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'ru-RU,ru;q=0.9',
  'Referer':         'https://www.google.com/',
};

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function get(url) {
  const r = await axios.get(url, { headers: HEADERS, timeout: 30000 });
  return r.data;
}

// ── Шаг 1: собрать все URL профилей ──────────────────────────────────────────
async function getProfileUrls() {
  console.log('📋 Загружаем список ЧСИ...');
  const html = await get(LIST_URL);
  const $    = cheerio.load(html);
  const urls = new Set();

  $('a[href]').each((_, el) => {
    const href = $(el).attr('href') || '';
    // Профили ЧСИ — вложенные страницы с определённым паттерном URL
    if (
      href.includes('chastnyj-sudebnyj-ispolnitel') ||
      href.startsWith(LIST_URL) && href !== LIST_URL
    ) {
      urls.add(href.split('?')[0].replace(/\/$/, '') + '/');
    }
  });

  return [...urls].filter(u => u.startsWith(BASE));
}

// ── Шаг 2: парсить профиль ЧСИ ───────────────────────────────────────────────
function parseProfile(html) {
  const $    = cheerio.load(html);
  const text = $('body').text().replace(/\s+/g, ' ');

  // Email
  const emailM = text.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/);
  const email  = emailM ? emailM[0].toLowerCase() : null;

  // Номер лицензии (формат: "Номер лицензии: 109")
  const licM   = text.match(/номер\s+лицензии\s*[:\-]?\s*(\d{2,5})/i)
              || text.match(/лицензи[яи]\s*[№:#]?\s*(\d{2,5})/i);
  const license = licM ? licM[1] : null;

  // Телефоны — нормализовать к +7XXXXXXXXXX
  const phones = [];
  const phoneRe = /(?:\+7|8)[\s\-\(]{0,2}\d{3}[\s\-\)]{0,2}\d{3}[\s\-]\d{2}[\s\-]\d{2}/g;
  let m;
  while ((m = phoneRe.exec(text)) !== null) {
    const p = m[0].replace(/[^\d+]/g, '').replace(/^8/, '+7').replace(/^7/, '+7');
    if (p.length >= 11) phones.push(p);
  }

  return { email, license, phones: [...new Set(phones)] };
}

// ── Шаг 3: матчить с нашей базой и обновлять ─────────────────────────────────
async function updateDb(data) {
  if (!data.email && !data.phones.length) return false;

  let found = null;

  // Сначала по номеру лицензии (надёжнее)
  if (data.license) {
    found = await db.findOne({ license: data.license });
  }

  if (!found) return false;

  const upd = {};
  if (data.email && !found.email)     upd.email  = data.email;
  if (data.phones.length && !found.phones?.length) upd.phones = data.phones;

  if (Object.keys(upd).length) {
    await db.update({ _id: found._id }, { $set: upd });
    return true;
  }
  return false;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  // Загрузить прогресс (чтобы возобновить)
  const done = fs.existsSync(PROGRESS)
    ? JSON.parse(fs.readFileSync(PROGRESS, 'utf8'))
    : {};

  // Получить список URLs
  let urls;
  if (done.__urls) {
    urls = done.__urls;
    console.log(`📂 Возобновление — найдено ${urls.length} URL в кэше`);
  } else {
    urls = await getProfileUrls();
    done.__urls = urls;
    fs.writeFileSync(PROGRESS, JSON.stringify(done));
    console.log(`🔗 Найдено профилей: ${urls.length}`);
  }

  let processed = 0, updated = 0, withEmail = 0, errors = 0;
  const total = urls.length;

  for (const url of urls) {
    if (done[url] !== undefined) { processed++; continue; } // уже обработан

    try {
      const html = await get(url);
      const data = parseProfile(html);

      done[url] = data.email || null;

      if (data.email) withEmail++;
      const changed = await updateDb(data);
      if (changed) {
        updated++;
        console.log(`✉️  [${updated}] ${data.license || '???'} → ${data.email}`);
      }

      processed++;

      // Сохранять прогресс каждые 20 запросов
      if (processed % 20 === 0) {
        fs.writeFileSync(PROGRESS, JSON.stringify(done));
        const pct = Math.round(processed / total * 100);
        console.log(`[${processed}/${total}] ${pct}% | email найдено: ${withEmail} | обновлено в БД: ${updated} | ошибок: ${errors}`);
      }

      await sleep(DELAY);
    } catch (e) {
      errors++;
      done[url] = 'error';
      console.error(`❌ ${url.slice(BASE.length)}: ${e.message}`);
      await sleep(DELAY * 2);
    }
  }

  fs.writeFileSync(PROGRESS, JSON.stringify(done));

  const total_with_email = await db.count({ email: { $exists: true } });
  console.log(`\n✅ Готово!`);
  console.log(`   Обработано: ${processed}/${total}`);
  console.log(`   Email найдено на сайте: ${withEmail}`);
  console.log(`   Обновлено в нашей БД:  ${updated}`);
  console.log(`   Ошибок: ${errors}`);
  console.log(`   Итого записей с email в БД: ${total_with_email}`);
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
