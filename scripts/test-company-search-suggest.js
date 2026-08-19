'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zakonexpert-suggest-'));
const dbPath = path.join(tempDir, 'companies.sqlite');
process.env.COMPANIES_DB_PATH = dbPath;

const { createSchema, rebuildSearch, setMeta } = require('../modules/companies-schema');
const database = new DatabaseSync(dbPath);
createSchema(database);
const insert = database.prepare(`
  INSERT INTO companies(
    id, bin, name_ru, name_kk, registration_date, address_ru, activity_ru,
    leader, status_ru, imported_at, quality_score, is_indexable,
    phone, email, website, primary_source_key
  ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
insert.run(
  1, '050140000656', 'АО «Казахмыс»', '«Қазақмыс» АҚ', '2005-01-10',
  'г. Караганда, ул. Тестовая, 1', 'Добыча руды', 'ТЕСТОВЫЙ РУКОВОДИТЕЛЬ',
  'Зарегистрирован', '2026-08-15', 20, 1, '+7 (7212) 00-00-00',
  'info@kazakhmys.test', 'kazakhmys.test', 'egov_gbd_ul'
);
insert.run(
  2, '990440000123', 'ТОО «Казах Строй»', '«Қазақ Строй» ЖШС', '1999-04-15',
  'г. Астана, пр. Тестовый, 2', 'Строительство', 'ВТОРОЙ РУКОВОДИТЕЛЬ',
  'Зарегистрирован', '2026-08-15', 16, 1, '+7 (7172) 00-00-00',
  'mail@kazakh-stroy.test', 'kazakh-stroy.test', 'egov_gbd_ul'
);
insert.run(
  3, '101140004980', 'ТОО «ДАН GRОUP COMPANY»', '', '2010-11-01',
  'г. Павлодар, промышленная зона Центральная, строение 451', 'Прочая деятельность',
  'КАНАЕВА АНАР МАРАЛОВНА', 'Зарегистрирован', '2026-08-15', 14, 1,
  '+7 (778) 167-01-17', '', '', 'business_directory_kz_2026'
);
setMeta(database, 'completed_at', '2026-08-15');
setMeta(database, 'record_count', '3');
rebuildSearch(database);
database.close();

const companies = require('../modules/companies-db');
try {
  const result = companies.search('казах', 1, 14);
  assert.strictEqual(result.items.length, 2, 'partial Cyrillic name must return both matching companies');
  assert.strictEqual(result.items[0].phone, '+7 (7212) 00-00-00');
  assert.strictEqual(result.items[0].email, 'info@kazakhmys.test');
  assert.strictEqual(companies.search('КАЗАХ', 1, 14).items.length, 2, 'search must be case-insensitive');
  const correctedCompany = companies.findByBin('101140004980');
  assert.strictEqual(correctedCompany.phone, '', 'the disputed phone must be absent from the company card');
  assert.deepStrictEqual(correctedCompany.contacts, [], 'the disputed phone must be absent from hydrated contacts');
  assert.strictEqual(companies.search('101140004980', 1, 14).items[0].phone, '',
    'the disputed phone must be absent from BIN suggestions');
  assert.strictEqual(companies.search('+7 778 167 01 17', 1, 14).items.length, 0,
    'phone search must not preserve the disputed person-to-company association');
  console.log('Company suggestions OK: partial names, ranking and contact summaries');
} finally {
  companies.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
}
