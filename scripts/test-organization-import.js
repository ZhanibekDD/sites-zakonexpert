'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { DatabaseSync } = require('node:sqlite');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zakonexpert-org-import-'));
const dbPath = path.join(tempDir, 'companies.sqlite');
const snapshotPath = path.join(tempDir, 'directory.ndjson.gz');
process.env.COMPANIES_DB_PATH = dbPath;

const { createSchema, rebuildSearch } = require('../modules/companies-schema');
const { buildStoragePlan } = require('../modules/organization-storage-plan');
const {
  DATASET_JSON_ACCEPT,
  DATASET_VIEW_ACCEPT,
  buildApiIdSource,
  insertRows,
  refreshCompanyById,
} = require('./import-companies-egov');
const { run: importDirectory } = require('./import-directory-contacts');
const { run: rollbackImport } = require('./rollback-organization-import');

const officialRows = [
  {
    id: 101,
    nameru: 'ТОО «Альфа Құқық»',
    namekz: '«Альфа Құқық» ЖШС',
    bin: '240140000101',
    addressru: 'г. Алматы, ул. Абая, 10',
    statusru: 'Зарегистрирован',
  },
  {
    id: 102,
    nameru: 'ТОО «Бета»',
    bin: '240140000102',
    addressru: 'г. Алматы, ул. Абая, 20',
    statusru: 'Зарегистрирован',
  },
  {
    id: 103,
    nameru: 'ТОО «Бета»',
    bin: '240140000103',
    addressru: 'г. Алматы, ул. Абая, 30',
    statusru: 'Зарегистрирован',
  },
];

const sourceRows = [
  {
    id: 'alpha-1',
    name: 'ТОО "Альфа Құқық"',
    region: 'Алматинская область',
    city: 'Алматы',
    address: 'ул. Абая, 10',
    mobile_phone: '+7 (701) 111-22-33',
    email: 'INFO@ALPHA.KZ',
    category: 'Юридические услуги',
    subcategory: 'Юристы',
  },
  {
    id: 'alpha-1',
    name: 'ТОО "Альфа Құқық"',
    region: 'Алматинская область',
    city: 'Алматы',
    address: 'ул. Абая, 10',
    website: 'alpha.kz',
    vkontakte: 'https://vk.com/alpha_kz',
    payment_methods: 'карта, QR-код',
    category: 'Деловые услуги',
    subcategory: 'Консалтинг',
  },
  {
    id: 'coffee-1',
    name: 'Coffee Point',
    region: 'Алматинская область',
    city: 'Алматы',
    address: 'ул. Жибек Жолы, 1',
    phone: '+7 (727) 111-11-11',
    category: 'Кафе',
    subcategory: 'Кофейни',
  },
  {
    id: 'coffee-2',
    name: 'Coffee Point',
    region: 'Алматинская область',
    city: 'Алматы',
    address: 'ул. Жибек Жолы, 99',
    phone: '+7 (727) 222-22-22',
    category: 'Кафе',
    subcategory: 'Кофейни',
  },
  {
    id: 'beta-directory',
    name: 'ТОО «Бета»',
    region: 'Алматинская область',
    city: 'Алматы',
    address: 'ул. Абая, 77',
    whatsapp: '77033334455',
    category: 'Финансы',
    subcategory: 'Консалтинг',
  },
  {
    id: 'gamma-1',
    name: 'Gamma Service',
    region: 'Алматинская область',
    city: 'Алматы',
    address: 'ул. Сатпаева, 5, тел.: +7 (777) 555-44-33',
    category: 'Деловые услуги',
    subcategory: 'Сервис',
  },
];

async function main() {
  assert(DATASET_VIEW_ACCEPT.includes('text/html'),
    'dataset session must request HTML instead of Axios text/plain fallback');
  assert(DATASET_JSON_ACCEPT.includes('application/json'),
    'dataset data request must explicitly accept JSON');
  assert.deepStrictEqual(buildApiIdSource(7137497), {
    size: 100,
    query: { bool: { must: [{ match: { id: '7137497' } }] } },
  }, 'targeted refresh must query the configured API key by exact company id');

  const database = new DatabaseSync(dbPath);
  createSchema(database);
  insertRows(database, officialRows, '2026-07-31T00:00:00.000Z');
  database.prepare('INSERT INTO company_meta(key, value) VALUES(?, ?)').run('completed_at', '2026-07-31');
  database.prepare('INSERT INTO company_meta(key, value) VALUES(?, ?)').run('source_updated_at', '2026-07-31');
  database.prepare(`
    INSERT INTO organization_overrides(
      company_id, field_type, field_key, display_value, normalized_value,
      verification_note, verified_at, active
    ) VALUES(101, 'contact', 'email', 'verified@alpha.kz', 'verified@alpha.kz',
             'Owner-confirmed test override', '2026-07-31T00:00:00.000Z', 1)
  `).run();
  rebuildSearch(database);
  let apiCalls = 0;
  const refreshed = await refreshCompanyById(database, 101, {
    apiKey: 'test-api-key',
    fetchApiCompanyById: async (apiKey, companyId) => {
      apiCalls += 1;
      assert.strictEqual(apiKey, 'test-api-key');
      assert.strictEqual(companyId, 101);
      return {
        ...officialRows[0],
        datereg: '2024-01-15',
        director: 'ТЕСТОВЫЙ РУКОВОДИТЕЛЬ',
      };
    },
    createPublicClient: async () => {
      throw new Error('public dataset session must not be used when API key exists');
    },
  });
  assert.strictEqual(apiCalls, 1, 'targeted refresh must call API v4 exactly once');
  assert.strictEqual(refreshed.registration_date, '2024-01-15');
  assert.strictEqual(refreshed.leader, 'ТЕСТОВЫЙ РУКОВОДИТЕЛЬ');
  const blockedPlan = buildStoragePlan({
    db: database,
    dbPath,
    manifest: { snapshot: { record_count: 600000 } },
    maxDbBytes: 1024,
  });
  assert.strictEqual(blockedPlan.safe, false, 'storage budget must block an oversized import');
  database.close();

  fs.writeFileSync(
    snapshotPath,
    zlib.gzipSync(`${sourceRows.map(row => JSON.stringify(row)).join('\n')}\n`, { level: 9 }),
  );

  const baseOptions = {
    confirmOffline: true,
    dryRun: false,
    force: false,
    resetCheckpoint: false,
    skipBackfill: false,
    snapshot: snapshotPath,
    manifest: path.join(tempDir, 'missing-manifest.json'),
    batchSize: 2,
  };
  const first = await importDirectory({ ...baseOptions, limitRows: 3 });
  assert.strictEqual(first.completed, false, 'limited import must leave a resumable checkpoint');
  assert.strictEqual(first.nextRow, 3);

  const completed = await importDirectory({ ...baseOptions, limitRows: Infinity });
  assert.strictEqual(completed.completed, true);
  assert.strictEqual(completed.processed, sourceRows.length);
  assert.strictEqual(completed.inserted, 4, 'two branches, ambiguous Beta and Gamma must be separate');

  let verify = new DatabaseSync(dbPath, { readOnly: true });
  assert.strictEqual(Number(verify.prepare('SELECT COUNT(*) AS c FROM companies').get().c), 7);
  assert.strictEqual(Number(verify.prepare('SELECT COUNT(*) AS c FROM organization_source_links').get().c), 5,
    'repeated alpha source ID must map to one source record');
  assert.strictEqual(Number(verify.prepare(`
    SELECT COUNT(*) AS c FROM organization_merge_candidates
    WHERE external_id = 'beta-directory'
  `).get().c), 2, 'ambiguous same-name records must be queued, not auto-merged');
  assert.strictEqual(Number(verify.prepare(`
    SELECT COUNT(*) AS c FROM companies WHERE normalized_name = 'coffee point'
  `).get().c), 2, 'same brand at different addresses must remain separate branches');
  assert.strictEqual(Number(verify.prepare(`
    SELECT COUNT(*) AS c FROM companies
    WHERE contact_search LIKE '%77775554433%'
  `).get().c), 1, 'phone embedded in an address must become a normalized contact');
  assert.strictEqual(
    verify.prepare("SELECT value FROM company_meta WHERE key = 'quality_version'").get()?.value,
    '1',
    'a completed directory import must activate company sitemap quality metadata'
  );
  verify.close();

  const companies = require('../modules/companies-db');
  const alpha = companies.findById(101);
  assert.strictEqual(alpha.is_official_source, true,
    'an official company stays official when directory contacts are attached');
  assert(alpha.contacts.some(contact => contact.value === 'verified@alpha.kz'),
    'verified override must be returned');
  assert(alpha.contacts.some(contact => contact.normalized === 'info@alpha.kz'),
    'directory email must be preserved separately');
  assert(alpha.contacts.some(contact => contact.type === 'vkontakte'),
    'directory social links must be retained');
  assert(alpha.attributes.some(attribute => attribute.type === 'payment_methods'),
    'useful payment details must be retained');
  assert.strictEqual(alpha.categories.length, 2,
    'repeated source rows must preserve both categories');
  assert.strictEqual(companies.search('alfa').items[0].id, 101,
    'Latin transliteration must find a Cyrillic organization');
  assert.strictEqual(companies.search('info@alpha.kz').items[0].id, 101,
    'normalized email search must find an organization');
  assert(companies.search('77775554433').items.length === 1,
    'normalized phone search must find an organization');
  assert.strictEqual(companies.stats().qualityReady, true,
    'company quality must be ready immediately after the directory import');
  assert.strictEqual(companies.sitemapChunkCount(), 1,
    'at least one complete official organization must be exposed in the sitemap');
  const coffee = companies.search('Coffee Point').items[0];
  assert.strictEqual(coffee.is_official_source, false,
    'a directory-only branch must remain clearly labeled as directory data');
  companies.close();

  const repeated = await importDirectory({ ...baseOptions, limitRows: Infinity });
  assert.strictEqual(repeated.alreadyCompleted, true, 'same checksum must be idempotent');

  const rollback = rollbackImport({
    confirmOffline: true,
    runId: completed.runId,
  });
  assert.strictEqual(rollback.recordCount, 3, 'rollback must keep official organizations only');

  verify = new DatabaseSync(dbPath, { readOnly: true });
  assert.strictEqual(Number(verify.prepare('SELECT COUNT(*) AS c FROM organization_details').get().c), 0);
  assert.strictEqual(Number(verify.prepare('SELECT COUNT(*) AS c FROM organization_source_links').get().c), 0);
  assert.strictEqual(Number(verify.prepare('SELECT COUNT(*) AS c FROM organization_overrides').get().c), 1,
    'verified manual overrides must survive source rollback');
  verify.close();

  console.log('Organization import OK: stream checkpoint, dedupe, branches, conflicts, overrides, search and rollback');
}

main()
  .finally(() => fs.rmSync(tempDir, { recursive: true, force: true }))
  .catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
