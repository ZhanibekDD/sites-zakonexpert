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
      imported_at TEXT NOT NULL
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
  db.exec('CREATE INDEX IF NOT EXISTS companies_region_idx ON companies(region_slug);');
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
