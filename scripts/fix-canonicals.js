'use strict';
/**
 * Исправляет canonical URLs в HTML файлах — должны совпадать с чистыми URL из sitemap
 * Запуск: node scripts/fix-canonicals.js
 */

const fs   = require('fs');
const path = require('path');

const PUBLIC = path.join(__dirname, '..', 'public');

// Маппинг: имя файла → правильный canonical URL (чистый, без .html)
const CANONICAL_MAP = {
  'snyatie-aresta-so-scheta.html':        'https://zakonexpertt.kz/snyatie-aresta-so-scheta',
  'ispolnitelnaya-nadpis.html':            'https://zakonexpertt.kz/otmena-ispolnitelnoi-nadpisi',
  'chsi-arest-schetov.html':              'https://zakonexpertt.kz/snyatie-ogranichenii-chsi',
  'spornost-dolga.html':                  'https://zakonexpertt.kz/vozrazhenie-na-ispolnitelnuyu-nadpis',
  'snyatie-zapreta-na-avto.html':         'https://zakonexpertt.kz/snyatie-zapreta-na-avto',
  'snyatie-ogranicheniya-na-imushchestvo.html': 'https://zakonexpertt.kz/snyatie-ogranicheniya-na-imushchestvo',
  'zapret-registracionnyh-deystviy.html': 'https://zakonexpertt.kz/snyatie-zapreta-registracionnyh-deistvii',
  'snyatie-ogranichenii-u-notariusa.html':'https://zakonexpertt.kz/snyatie-ogranichenii-u-notariusa',
  'grafik-platezhey.html':                'https://zakonexpertt.kz/grafik-oplaty-zadolzhennosti',
  'ubrat-procenty-i-rashody-chsi.html':   'https://zakonexpertt.kz/ubrat-procenty-i-rashody-chsi',
  'arest-kaspi.html':                     'https://zakonexpertt.kz/arest-kaspi',
  'arest-halyk-bank.html':                'https://zakonexpertt.kz/arest-halyk-bank',
  'arest-freedom-bank.html':              'https://zakonexpertt.kz/arest-freedom-bank',
  'besspornost-dolga.html':               'https://zakonexpertt.kz/besspornost-dolga',
  'zakony.html':                          'https://zakonexpertt.kz/zakony',
  'services.html':                        'https://zakonexpertt.kz/services.html',
  'contact.html':                         'https://zakonexpertt.kz/contact.html',
  'alimenty-i-aresty.html':               'https://zakonexpertt.kz/alimenty-i-aresty',
  'shtrafy-i-aresty.html':               'https://zakonexpertt.kz/shtrafy-i-aresty',
};

let fixed = 0;
let already = 0;

for (const [filename, correctCanonical] of Object.entries(CANONICAL_MAP)) {
  const filePath = path.join(PUBLIC, filename);
  if (!fs.existsSync(filePath)) continue;

  let html = fs.readFileSync(filePath, 'utf8');

  // Найти текущий canonical
  const canonRe = /<link\s+rel="canonical"\s+href="([^"]+)"\s*\/?>/;
  const match = canonRe.exec(html);

  if (!match) {
    // Нет canonical — добавить после <title>
    html = html.replace(
      /(<title>[^<]*<\/title>)/,
      `$1\n  <link rel="canonical" href="${correctCanonical}">`
    );
    fs.writeFileSync(filePath, html, 'utf8');
    console.log(`  ➕ Добавлен canonical: ${filename} → ${correctCanonical}`);
    fixed++;
    continue;
  }

  if (match[1] === correctCanonical) {
    already++;
    continue;
  }

  // Заменить на правильный
  html = html.replace(
    canonRe,
    `<link rel="canonical" href="${correctCanonical}">`
  );

  // Также исправить og:url если есть
  html = html.replace(
    /(<meta\s+property="og:url"\s+content=")[^"]+(")/,
    `$1${correctCanonical}$2`
  );

  fs.writeFileSync(filePath, html, 'utf8');
  console.log(`  ✅ Исправлен: ${filename}`);
  console.log(`       было:  ${match[1]}`);
  console.log(`       стало: ${correctCanonical}`);
  fixed++;
}

console.log(`\n✅ Готово! Исправлено: ${fixed}, уже правильных: ${already}`);
