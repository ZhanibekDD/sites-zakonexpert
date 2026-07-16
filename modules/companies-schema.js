'use strict';

function createSchema(db) {
  db.exec(`
    PRAGMA journal_mode = TRUNCATE;
    PRAGMA synchronous = NORMAL;
    PRAGMA temp_store = MEMORY;
    CREATE TABLE IF NOT EXISTS companies (
      id INTEGER PRIMARY KEY,
      slug TEXT NOT NULL UNIQUE,
      bin TEXT,
      name_ru TEXT NOT NULL,
      name_kk TEXT,
      registration_date TEXT,
      address_ru TEXT,
      address_kk TEXT,
      activity_ru TEXT,
      activity_kk TEXT,
      leader TEXT,
      status_ru TEXT,
      status_kk TEXT,
      imported_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS company_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS companies_bin_idx ON companies(bin);
    CREATE INDEX IF NOT EXISTS companies_status_idx ON companies(status_ru);
  `);
}

function rebuildSearch(db) {
  db.exec(`
    DROP TABLE IF EXISTS companies_fts;
    CREATE VIRTUAL TABLE companies_fts USING fts5(
      name_ru,
      name_kk,
      bin,
      activity_ru,
      content='companies',
      content_rowid='id',
      tokenize='unicode61 remove_diacritics 2'
    );
    INSERT INTO companies_fts(rowid, name_ru, name_kk, bin, activity_ru)
      SELECT id, name_ru, name_kk, bin, activity_ru FROM companies;
  `);
}

module.exports = { createSchema, rebuildSearch };
