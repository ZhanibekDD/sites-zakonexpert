'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ejs = require('ejs');

const ROOT = path.resolve(__dirname, '..');
const IMAGE_PATHS = [1, 2, 3].map(page => path.join(ROOT, 'public', 'img', 'contracts', `client-contract-page-${page}.svg`));

async function main() {
  IMAGE_PATHS.forEach((filePath, index) => {
    assert(fs.existsSync(filePath), `contract page ${index + 1} image is missing`);
    const svg = fs.readFileSync(filePath, 'utf8');
    assert(svg.startsWith('<?xml'), `contract page ${index + 1} is not an SVG document`);
    assert(svg.includes('Обезличенная визуальная копия'), `contract page ${index + 1} lacks a privacy description`);
    assert(svg.length > 6000, `contract page ${index + 1} is unexpectedly thin`);
    assert(!/<image\b/i.test(svg), `contract page ${index + 1} must not hide an unredacted raster inside the SVG`);
    const twelveDigitValues = svg.match(/\b\d{12}\b/g) || [];
    assert(twelveDigitValues.every(value => value === '260740044168'),
      `contract page ${index + 1} exposes an unexpected 12-digit identifier`);
  });

  const pageOne = fs.readFileSync(IMAGE_PATHS[0], 'utf8');
  const pageThree = fs.readFileSync(IMAGE_PATHS[2], 'utf8');
  assert(pageOne.includes('ДАННЫЕ КЛИЕНТА СКРЫТЫ'), 'page 1 must visibly mark client data as hidden');
  assert(pageThree.includes('ФИО СКРЫТО') && pageThree.includes('ИИН СКРЫТ')
    && pageThree.includes('ТЕЛЕФОН СКРЫТ') && pageThree.includes('ИМЯ И ПОДПИСЬ СКРЫТЫ'),
  'page 3 must visibly redact all client identity fields');

  const html = await ejs.renderFile(path.join(ROOT, 'views', 'contracts', 'how-we-sign.ejs'));
  assert(html.includes('<link rel="canonical" href="https://zakonexpertt.kz/kak-my-zaklyuchaem-dogovor">'));
  assert(html.includes('/img/contracts/client-contract-page-1.svg'));
  assert(html.includes('/img/contracts/client-contract-page-2.svg'));
  assert(html.includes('/img/contracts/client-contract-page-3.svg'));
  assert(html.includes('ФИО, ИИН, телефон, адрес и подпись клиента закрыты'));
  assert(!/\b(?:9[0-9]{11}|8[0-9]{11})\b/.test(html), 'public contract page contains a likely client identifier');

  console.log('Public client contract page: OK — three privacy-safe SVG pages and canonical landing page');
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
