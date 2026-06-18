'use strict';
/**
 * Scraper: emails ЧСИ с kredit-zakryt.kz  — многопоточный режим
 * Запуск:  node scripts/scrape-bailiff-emails.js
 * Возобновление: повторный запуск пропускает уже обработанные URL
 */

const axios     = require('axios');
const cheerio   = require('cheerio');
const path      = require('path');
const fs        = require('fs');
const Datastore = require('nedb-promises');

const BASE       = 'https://kredit-zakryt.kz';
const LIST_URL   = `${BASE}/spisok-chastnyh-sudebnyh-ispolnitelej-respubliki-kazahstan/`;
const CONCURRENCY = 10;   // параллельных запросов
const TIMEOUT     = 20000;
const PROGRESS    = path.join(__dirname, '..', 'data', 'bailiff-email-progress.json');

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

// Пул из CONCURRENCY параллельных воркеров
async function poolRun(items, concurrency, fn) {
  const results = [];
  let idx = 0;

  async function worker() {
    while (idx < items.length) {
      const i = idx++;
      results[i] = await fn(items[i], i);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, worker);
  await Promise.all(workers);
  return results;
}

async function get(url) {
  const r = await axios.get(url, { headers: HEADERS, timeout: TIMEOUT });
  return r.data;
}

async function getProfileUrls() {
  process.stdout.write('📋 Загружаем список ЧСИ... ');
  const html = await get(LIST_URL);
  const $    = cheerio.load(html);
  const urls = new Set();
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href') || '';
    if (href.includes('chastnyj-sudebnyj-ispolnitel') && href.startsWith(BASE)) {
      urls.add(href.split('?')[0].replace(/\/$/, '') + '/');
    }
  });
  const arr = [...urls];
  console.log(`${arr.length} профилей`);
  return arr;
}

function parseProfile(html) {
  const $    = cheerio.load(html);
  const text = $('body').text().replace(/\s+/g, ' ');

  const emailM  = text.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/);
  const email   = emailM ? emailM[0].toLowerCase() : null;

  const licM    = text.match(/номер\s+лицензии\s*[:\-]?\s*(\d{2,5})/i)
               || text.match(/лицензи[яи]\s*[№:#]?\s*(\d{2,5})/i);
  const license = licM ? licM[1] : null;

  const phones  = [];
  const phoneRe = /(?:\+7|8)[\s\-\(]{0,2}\d{3}[\s\-\)]{0,2}\d{3}[\s\-]\d{2}[\s\-]\d{2}/g;
  let m;
  while ((m = phoneRe.exec(text)) !== null) {
    const p = m[0].replace(/[^\d+]/g, '').replace(/^8/, '+7').replace(/^7/, '+7');
    if (p.length >= 11) phones.push(p);
  }

  return { email, license, phones: [...new Set(phones)] };
}

async function updateDb(data) {
  if (!data.email && !data.phones.length) return false;
  if (!data.license) return false;

  const found = await db.findOne({ license: data.license });
  if (!found) return false;

  const upd = {};
  if (data.email  && !found.email)          upd.email  = data.email;
  if (data.phones.length && !found.phones?.length) upd.phones = data.phones;

  if (!Object.keys(upd).length) return false;
  await db.update({ _id: found._id }, { $set: upd });
  return true;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const done = fs.existsSync(PROGRESS)
    ? JSON.parse(fs.readFileSync(PROGRESS, 'utf8'))
    : {};

  let urls;
  if (done.__urls) {
    urls = done.__urls;
    const remaining = urls.filter(u => done[u] === undefined).length;
    console.log(`📂 Возобновление: ${urls.length} URL, осталось: ${remaining}`);
  } else {
    urls = await getProfileUrls();
    done.__urls = urls;
    fs.writeFileSync(PROGRESS, JSON.stringify(done));
  }

  const todo  = urls.filter(u => done[u] === undefined);
  const total = urls.length;
  console.log(`🚀 Многопоточно [${CONCURRENCY} потоков] — обрабатываем ${todo.length} из ${total}\n`);

  // Счётчики (shared state — Node.js однопоточный, гонок нет)
  let processed = 0, updated = 0, withEmail = 0, errors = 0;
  const startAt = Date.now();

  // Мьютекс для записи прогресса (чтобы не перезаписывать одновременно)
  let saving = false;
  async function saveProgress() {
    if (saving) return;
    saving = true;
    fs.writeFileSync(PROGRESS, JSON.stringify(done));
    saving = false;
  }

  await poolRun(todo, CONCURRENCY, async (url) => {
    try {
      const html = await get(url);
      const data = parseProfile(html);

      done[url] = data.email || null;
      if (data.email) withEmail++;

      const changed = await updateDb(data);
      if (changed) {
        updated++;
        process.stdout.write(`✉️  лиц.${data.license} → ${data.email}\n`);
      }

      processed++;

      // Прогресс каждые 50 запросов
      if (processed % 50 === 0) {
        await saveProgress();
        const elapsed = Math.round((Date.now() - startAt) / 1000);
        const rps     = (processed / elapsed).toFixed(1);
        const eta     = Math.round((todo.length - processed) / rps);
        const pct     = Math.round(processed / todo.length * 100);
        console.log(`[${processed}/${todo.length}] ${pct}% | ${rps} req/s | ETA ~${eta}s | email: ${withEmail} | обновлено: ${updated}`);
      }
    } catch (e) {
      errors++;
      done[url] = 'error';
      // Тихо — не флудить консоль, только критические
      if (errors <= 10 || errors % 50 === 0) {
        process.stderr.write(`❌ [${errors}] ${url.split('/').slice(-2,-1)[0].slice(0,30)}: ${e.message}\n`);
      }
    }
  });

  await saveProgress();

  const elapsed = Math.round((Date.now() - startAt) / 1000);
  const totalEmail = await db.count({ email: { $exists: true } });

  console.log(`\n✅ Готово за ${elapsed}с`);
  console.log(`   Обработано:          ${processed} / ${todo.length}`);
  console.log(`   Email найдено:       ${withEmail}`);
  console.log(`   Обновлено в БД:      ${updated}`);
  console.log(`   Ошибок:              ${errors}`);
  console.log(`   Всего с email в БД:  ${totalEmail}`);
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
