'use strict';
/**
 * Парсер списков ЧСИ с gov.kz (страницы с таблицами, рендерятся через Googlebot UA)
 *
 * Известные страницы:
 *   Жамбылская: https://www.gov.kz/memleket/entities/adilet-zhmb/press/article/details/22228?lang=ru
 *
 * Добавляйте URL других регионов в массив PAGES по мере нахождения.
 *
 * Запуск: node scripts/scrape-govkz-chsi.js
 */

const axios     = require('axios');
const cheerio   = require('cheerio');
const path      = require('path');
const Datastore = require('nedb-promises');

const db = Datastore.create({
  filename: path.join(__dirname, '..', 'data', 'bailiffs.db'),
  autoload: true,
});

const PAGES = [
  'https://www.gov.kz/memleket/entities/adilet-zhmb/press/article/details/22228?lang=ru',
  // Добавьте сюда URL других регионов:
  // 'https://www.gov.kz/memleket/entities/adilet-krg/press/article/details/XXXX?lang=ru',
];

const BOT = {
  'User-Agent': 'Googlebot/2.1 (+http://www.google.com/bot.html)',
  'Accept':     'text/html',
};

// Нормализация имени для сравнения: убрать лишние пробелы, привести к верхнему регистру
function normName(s) {
  return (s || '').toUpperCase().replace(/\s+/g, ' ').trim();
}

// Из строки таблицы: № | ФИО | Адрес | Телефоны | Email
function parseRow($, row) {
  const cells = $(row).find('td');
  if (cells.length < 4) return null;

  const name   = normName($(cells[1]).text());
  const addr   = $(cells[2]).text().replace(/\s+/g, ' ').trim();
  const phones = [];
  const phoneRe = /(?:\+7|8)[\s\-\(]{0,2}\d{3}[\s\-\)]{0,2}\d{3}[\s\-]\d{2}[\s\-]\d{2}/g;
  const rawPhones = $(cells[3]).text();
  let m;
  while ((m = phoneRe.exec(rawPhones)) !== null) {
    const p = m[0].replace(/[^\d+]/g, '').replace(/^8/, '+7').replace(/^7/, '+7');
    if (p.length >= 11) phones.push(p);
  }

  const emailCell = $(cells[4]) || $(cells[cells.length - 1]);
  const emailText = emailCell.text().trim();
  const emailM    = emailText.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/);
  const email     = emailM ? emailM[0].toLowerCase() : null;

  if (!name || name.length < 5) return null;
  return { name, addr, phones, email };
}

// Найти в нашей БД по ФИО (нормализованному)
async function findInDb(name) {
  // Попробовать точное совпадение
  const exact = await db.findOne({ name });
  if (exact) return exact;

  // Попробовать по первым двум словам (Фамилия Имя)
  const parts  = name.split(' ').slice(0, 2).join(' ');
  if (parts.length > 4) {
    const fuzzy = await db.find({ name: new RegExp(parts.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') }).limit(1);
    if (fuzzy.length) return fuzzy[0];
  }
  return null;
}

async function scrapePage(url) {
  console.log('\n📥 Загружаем:', url);
  const r = await axios.get(url, { headers: BOT, timeout: 20000 });
  const $ = cheerio.load(r.data);

  const title = $('title').text().trim();
  console.log('   Заголовок:', title);

  const rows  = $('tr').toArray().slice(1); // пропустить заголовок таблицы
  console.log('   Строк в таблице:', rows.length);

  let matched = 0, updated = 0, noMatch = 0, noEmail = 0;

  for (const row of rows) {
    const data = parseRow($, row);
    if (!data) continue;
    if (!data.email) { noEmail++; continue; }

    const found = await findInDb(data.name);
    if (!found) { noMatch++; continue; }
    matched++;

    const upd = {};
    if (data.email && !found.email)           upd.email  = data.email;
    if (data.phones.length && !found.phones?.length) upd.phones = data.phones;
    if (data.addr  && !found.address)         upd.address = data.addr;

    if (Object.keys(upd).length) {
      await db.update({ _id: found._id }, { $set: upd });
      updated++;
      console.log(`   ✉️  ${found.name} → ${data.email}`);
    }
  }

  console.log(`   Найдено в нашей БД: ${matched} | Обновлено: ${updated} | Без совпадения: ${noMatch} | Без email: ${noEmail}`);
  return { matched, updated };
}

async function main() {
  let totalUpdated = 0;

  for (const url of PAGES) {
    try {
      const { updated } = await scrapePage(url);
      totalUpdated += updated;
    } catch (e) {
      console.error('❌', url, e.message);
    }
  }

  const withEmail = await db.count({ email: { $exists: true } });
  console.log(`\n✅ Готово! Обновлено записей: ${totalUpdated}`);
  console.log(`   Всего ЧСИ с email в базе: ${withEmail}`);
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
