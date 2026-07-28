'use strict';

const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');
const { writeRegistrySource } = require('../modules/registry-source');
const { applyNotaryOverride } = require('../modules/notary-overrides');

const OUTPUT_PATH = path.join(__dirname, '..', 'registry', 'notaries.json.gz');
const STATUS_PATH = path.join(__dirname, '..', 'data', 'notaries-registry-status.json');
const CHAMBERS = [
  [1, 'Акмолинская область'],
  [2, 'Актюбинская область'],
  [3, 'Алматинская область'],
  [4, 'город Алматы'],
  [5, 'город Астана'],
  [6, 'Атырауская область'],
  [7, 'Восточно-Казахстанская область'],
  [8, 'Жамбылская область'],
  [9, 'Западно-Казахстанская область'],
  [10, 'Карагандинская область'],
  [11, 'Кызылординская область'],
  [12, 'Костанайская область'],
  [13, 'Мангистауская область'],
  [14, 'Павлодарская область'],
  [15, 'Северо-Казахстанская область'],
  [16, 'город Шымкент'],
  [18, 'Туркестанская область'],
  [19, 'область Абай'],
  [20, 'область Жетісу'],
  [21, 'область Ұлытау'],
];

function clean(value) {
  return String(value || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

function validEmail(value) {
  const email = clean(value).toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : '';
}

function parseNotaryPage(html, region) {
  const $ = cheerio.load(html);
  const rows = [];
  $('table[border="1"] tr').slice(1).each((_, tr) => {
    const cells = $(tr).children('td');
    if (cells.length < 7) return;
    const num = clean(cells.eq(0).text());
    const name = clean(cells.eq(1).text()).toUpperCase();
    if (!/^\d+$/.test(num) || name.length < 3) return;

    const contactCell = cells.eq(5);
    const contactText = clean(contactCell.clone().find('a').remove().end().text())
      .replace(/(?:,|;|\s)+$/, '');
    const emailLink = contactCell.find('a.cryptedmail').first();
    const encodedEmail = emailLink.attr('data-name') && emailLink.attr('data-domain') && emailLink.attr('data-tld')
      ? `${emailLink.attr('data-name')}@${emailLink.attr('data-domain')}.${emailLink.attr('data-tld')}`
      : '';
    const email = validEmail(encodedEmail)
      || validEmail(clean(contactCell.text()).match(/[^\s,;]+@[^\s,;]+\.[^\s,;]+/)?.[0]);

    rows.push({
      region,
      num,
      name,
      license: clean(cells.eq(2).text()),
      licenseDate: clean(cells.eq(3).text()),
      address: clean(cells.eq(4).text()),
      phone: contactText,
      email,
      schedule: clean(cells.eq(6).text()),
    });
  });
  return rows;
}

function toRegistryRows(rows) {
  return rows.map(row => {
    const corrected = applyNotaryOverride(row);
    return [
      corrected.region, corrected.num, corrected.name, corrected.license, corrected.licenseDate,
      corrected.address, corrected.phone, corrected.email, corrected.schedule,
    ];
  });
}

async function fetchChamber(id, region) {
  const url = `https://enis.kz/Notary/NotaryByChamber/${id}`;
  let html;
  let lastError;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const response = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ZakonExpertRegistry/1.0; +https://zakonexpertt.kz)' },
        signal: AbortSignal.timeout(60000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      html = await response.text();
      break;
    } catch (error) {
      lastError = error;
      if (attempt < 4) await new Promise(resolve => setTimeout(resolve, attempt * 1500));
    }
  }
  if (!html) throw lastError;
  const rows = parseNotaryPage(html, region);
  if (rows.length === 0) throw new Error(`ЕНІС вернул пустой список для ${region}`);
  console.log(`[Notaries] ${region}: ${rows.length}`);
  return rows;
}

async function refreshNotariesRegistry() {
  const groups = [];
  for (const [id, region] of CHAMBERS) groups.push(await fetchChamber(id, region));
  const rows = groups.flat();
  const active = rows.filter(row => !/прекращена/i.test(row.license)).length;
  const withPhone = rows.filter(row => row.phone).length;
  const withEmail = rows.filter(row => row.email).length;
  if (rows.length < 5000 || active < 3000) {
    throw new Error(`Проверка полноты не пройдена: всего ${rows.length}, действующих ${active}`);
  }
  writeRegistrySource(OUTPUT_PATH, 'notaries', toRegistryRows(rows), {
    source: 'https://enis.kz/NotarySearch',
  });
  fs.writeFileSync(STATUS_PATH, JSON.stringify({
    source: 'https://enis.kz/NotarySearch',
    checkedAt: new Date().toISOString(),
    chambers: CHAMBERS.length,
    total: rows.length,
    active,
    withPhone,
    withEmail,
  }, null, 2) + '\n', 'utf8');
  console.log(`[Notaries] Saved ${rows.length}: active=${active}, phone=${withPhone}, email=${withEmail}`);
  return { total: rows.length, active, withPhone, withEmail };
}

if (require.main === module) {
  refreshNotariesRegistry().catch(error => {
    console.error('[Notaries] Refresh failed:', error.message);
    process.exitCode = 1;
  });
}

module.exports = { CHAMBERS, clean, validEmail, parseNotaryPage, toRegistryRows, refreshNotariesRegistry };
