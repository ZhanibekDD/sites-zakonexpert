'use strict';

function createSchema(db) {
  db.exec(`
    PRAGMA journal_mode = TRUNCATE;
    PRAGMA synchronous = NORMAL;
    PRAGMA temp_store = MEMORY;
    CREATE TABLE IF NOT EXISTS companies (
      id INTEGER PRIMARY KEY,
      bin TEXT,
      name_ru TEXT NOT NULL,
      name_kk TEXT,
      registration_date TEXT,
      address_ru TEXT,
      activity_ru TEXT,
      leader TEXT,
      status_ru TEXT,
      imported_at TEXT NOT NULL,
      quality_score INTEGER NOT NULL DEFAULT 0,
      is_indexable INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS company_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS companies_bin_idx ON companies(bin);
    DROP INDEX IF EXISTS companies_status_idx;
  `);
  const hasRegionColumn = db.prepare("SELECT 1 FROM pragma_table_info('companies') WHERE name = 'region_slug'").get();
  if (!hasRegionColumn) {
    db.exec('ALTER TABLE companies ADD COLUMN region_slug TEXT;');
  }
  const hasQualityColumn = db.prepare("SELECT 1 FROM pragma_table_info('companies') WHERE name = 'quality_score'").get();
  if (!hasQualityColumn) db.exec('ALTER TABLE companies ADD COLUMN quality_score INTEGER NOT NULL DEFAULT 0;');
  const hasIndexableColumn = db.prepare("SELECT 1 FROM pragma_table_info('companies') WHERE name = 'is_indexable'").get();
  if (!hasIndexableColumn) db.exec('ALTER TABLE companies ADD COLUMN is_indexable INTEGER NOT NULL DEFAULT 0;');

  const CONTACT_COLUMNS = [
    ['phone', 'TEXT'], ['mobile_phone', 'TEXT'], ['email', 'TEXT'], ['website', 'TEXT'],
    ['whatsapp', 'TEXT'], ['viber', 'TEXT'], ['telegram', 'TEXT'],
    ['work_hours', 'TEXT'], ['rating', 'TEXT'], ['review_count', 'TEXT'],
    ['lat', 'TEXT'], ['lon', 'TEXT'],
    ['contact_source', 'TEXT'], ['contact_updated_at', 'TEXT'],
  ];
  for (const [name, type] of CONTACT_COLUMNS) {
    const has = db.prepare("SELECT 1 FROM pragma_table_info('companies') WHERE name = ?").get(name);
    if (!has) db.exec(`ALTER TABLE companies ADD COLUMN ${name} ${type};`);
  }

  db.exec(`
    CREATE INDEX IF NOT EXISTS companies_region_idx ON companies(region_slug);
    CREATE INDEX IF NOT EXISTS companies_indexable_idx ON companies(is_indexable, id);
  `);
}

function rebuildSearch(db) {
  db.exec(`
    DROP TABLE IF EXISTS companies_fts;
    CREATE VIRTUAL TABLE companies_fts USING fts5(
      name_ru,
      name_kk,
      bin,
      content='companies',
      content_rowid='id',
      tokenize='unicode61 remove_diacritics 2'
    );
    INSERT INTO companies_fts(rowid, name_ru, name_kk, bin)
      SELECT id, name_ru, name_kk, bin FROM companies;
  `);
}

module.exports = { createSchema, rebuildSearch };
