'use strict';

const assert = require('assert');
const path = require('path');
const { buildNotaries, validEmail } = require('./import-notaries');
const { CHAMBERS, parseNotaryPage, toRegistryRows } = require('./refresh-notaries-csv');
const { readRegistrySource } = require('../modules/registry-source');

const sample = `
<table border="1">
  <tr><td>№</td><td>ФИО</td><td>Лицензия</td><td>Дата</td><td>Адрес</td><td>Контакты</td><td>Режим</td></tr>
  <tr><td>1</td><td>ИВАНОВ ИВАН ИВАНОВИЧ</td><td>25000001</td><td>01.01.2025</td><td>Астана, Кабанбай батыра, 1</td><td>87010000000,<br><a class="cryptedmail" data-name="ivanov" data-domain="mail" data-tld="kz"></a></td><td>09:00–18:00</td></tr>
</table>`;

const parsedPage = parseNotaryPage(sample, 'город Астана');
assert.strictEqual(parsedPage.length, 1);
assert.strictEqual(parsedPage[0].phone, '87010000000');
assert.strictEqual(parsedPage[0].email, 'ivanov@mail.kz');
assert.strictEqual(CHAMBERS.length, 20, 'all 20 ENIS chambers must be covered');
assert.strictEqual(validEmail('Test@Mail.KZ'), 'test@mail.kz');
assert.strictEqual(validEmail('10.00-18.00'), null);

const source = readRegistrySource(path.join(__dirname, '..', 'registry', 'notaries.json.gz'), 'notaries');
const { notaries } = buildNotaries(source.records, source.sourceMtime);
const regions = new Set(notaries.map(item => item.region));
const slugs = new Set(notaries.map(item => item.slug));
assert.ok(notaries.length >= 6000, 'fallback snapshot is unexpectedly incomplete');
assert.strictEqual(regions.size, 20, 'snapshot must contain all 20 chambers');
assert.strictEqual(slugs.size, notaries.length, 'notary slugs must be unique');
assert.ok(notaries.filter(item => item.phone).length >= 5700, 'phone coverage unexpectedly dropped');
assert.ok(notaries.filter(item => item.email).length >= 5700, 'email coverage unexpectedly dropped');
assert.ok(notaries.every(item => !item.email || validEmail(item.email)), 'all stored emails must be valid');
const aman = notaries.find(item => item.license === '22020237' && item.name === 'АМАН ЖАНЕРКЕ');
assert.ok(aman, 'verified notary override target must exist');
assert.strictEqual(aman.email, 'amanzhanerke87@gmail.com');
assert.strictEqual(
  toRegistryRows([{
    region: 'Жамбылская область',
    num: '30',
    name: 'АМАН ЖАНЕРКЕ',
    license: '22020237',
    licenseDate: '01.11.2022',
    address: 'г.Тараз',
    phone: '87071408084',
    email: 'aman_jan87@mail.ru',
    schedule: 'с 9:00 до 18:00',
  }])[0][7],
  'amanzhanerke87@gmail.com',
  'registry refresh must preserve the verified email',
);

console.log(`Notary data OK: ${notaries.length} records, ${regions.size} chambers`);
