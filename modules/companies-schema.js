'use strict';

const { normalizeCompanyName } = require('./company-name-normalize');
const { buildSearchAliases } = require('./company-transliterate');
const { buildContactSearch } = require('./company-details-store');

function hasColumn(db, table, column) {
  return Boolean(db.prepare(`SELECT 1 FROM pragma_table_info('${table}') WHERE name = ?`).get(column));
}

function addColumn(db, table, name, definition) {
  if (!hasColumn(db, table, name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition};`);
}

function setMeta(db, key, value) {
  db.prepare(`
    INSERT INTO company_meta(key, value) VALUES(?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(key, String(value));
}

function getMeta(db, key, fallback = null) {
  const row = db.prepare('SELECT value FROM company_meta WHERE key = ?').get(key);
  return row ? row.value : fallback;
}

function createSchema(db) {
  db.exec(`
    PRAGMA journal_mode = TRUNCATE;
    PRAGMA synchronous = NORMAL;
    PRAGMA temp_store = MEMORY;
    PRAGMA foreign_keys = ON;
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
  addColumn(db, 'companies', 'region_slug', 'TEXT');
  addColumn(db, 'companies', 'quality_score', 'INTEGER NOT NULL DEFAULT 0');
  addColumn(db, 'companies', 'is_indexable', 'INTEGER NOT NULL DEFAULT 0');
  addColumn(db, 'companies', 'normalized_name', 'TEXT');
  addColumn(db, 'companies', 'search_aliases', 'TEXT');
  addColumn(db, 'companies', 'contact_search', 'TEXT');
  addColumn(db, 'companies', 'primary_source_key', 'TEXT');
  addColumn(db, 'companies', 'created_by_run_id', 'TEXT');

  // Frequently displayed values stay on the company row. This compact
  // denormalized layer is deliberate: it avoids duplicating hundreds of
  // megabytes of one-value contact rows and indexes on small Plesk plans.
  // Additional values and provenance live in organization_details.
  const CONTACT_COLUMNS = [
    ['phone', 'TEXT'], ['mobile_phone', 'TEXT'], ['email', 'TEXT'], ['website', 'TEXT'],
    ['whatsapp', 'TEXT'], ['viber', 'TEXT'], ['telegram', 'TEXT'],
    ['work_hours', 'TEXT'], ['rating', 'TEXT'], ['review_count', 'TEXT'],
    ['lat', 'REAL'], ['lon', 'REAL'],
    ['contact_source', 'TEXT'], ['contact_updated_at', 'TEXT'],
  ];
  for (const [name, type] of CONTACT_COLUMNS) {
    addColumn(db, 'companies', name, type);
  }

  db.exec(`
    CREATE INDEX IF NOT EXISTS companies_region_idx ON companies(region_slug);
    CREATE INDEX IF NOT EXISTS companies_indexable_idx ON companies(is_indexable, id);
    CREATE TABLE IF NOT EXISTS organization_sources (
      source_key TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      source_url TEXT,
      source_type TEXT NOT NULL,
      trust_rank INTEGER NOT NULL DEFAULT 0,
      rights_status TEXT NOT NULL DEFAULT 'unknown',
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS organization_import_runs (
      run_id TEXT PRIMARY KEY,
      source_key TEXT NOT NULL,
      source_checksum TEXT NOT NULL,
      source_path TEXT NOT NULL,
      status TEXT NOT NULL,
      next_row INTEGER NOT NULL DEFAULT 0,
      processed_count INTEGER NOT NULL DEFAULT 0,
      matched_count INTEGER NOT NULL DEFAULT 0,
      inserted_count INTEGER NOT NULL DEFAULT 0,
      conflict_count INTEGER NOT NULL DEFAULT 0,
      invalid_count INTEGER NOT NULL DEFAULT 0,
      started_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      completed_at TEXT,
      error_message TEXT
    );
    CREATE INDEX IF NOT EXISTS organization_import_runs_source_idx
      ON organization_import_runs(source_key, source_checksum, status);

    CREATE TABLE IF NOT EXISTS organization_source_links (
      source_key TEXT NOT NULL,
      external_hash BLOB NOT NULL,
      company_id INTEGER NOT NULL,
      created_run INTEGER NOT NULL,
      last_seen_run INTEGER NOT NULL,
      PRIMARY KEY(source_key, external_hash)
    ) WITHOUT ROWID;
    DROP INDEX IF EXISTS organization_source_links_company_idx;

    CREATE TABLE IF NOT EXISTS organization_details (
      company_id INTEGER NOT NULL,
      source_key TEXT NOT NULL,
      details_json TEXT NOT NULL,
      search_text TEXT NOT NULL DEFAULT '',
      created_run INTEGER NOT NULL,
      last_seen_run INTEGER NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY(company_id, source_key)
    ) WITHOUT ROWID;

    CREATE TABLE IF NOT EXISTS organization_overrides (
      id INTEGER PRIMARY KEY,
      company_id INTEGER NOT NULL,
      field_type TEXT NOT NULL,
      field_key TEXT NOT NULL DEFAULT '',
      display_value TEXT NOT NULL,
      normalized_value TEXT NOT NULL,
      verification_note TEXT,
      verified_at TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      UNIQUE(company_id, field_type, field_key)
    );
    CREATE INDEX IF NOT EXISTS organization_overrides_company_idx
      ON organization_overrides(company_id, active);

    CREATE TABLE IF NOT EXISTS organization_merge_candidates (
      id INTEGER PRIMARY KEY,
      source_key TEXT NOT NULL,
      external_id TEXT NOT NULL,
      candidate_company_id INTEGER NOT NULL,
      confidence INTEGER NOT NULL,
      reason TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      imported_run_id TEXT,
      created_at TEXT NOT NULL,
      UNIQUE(source_key, external_id, candidate_company_id)
    );
    CREATE INDEX IF NOT EXISTS organization_merge_candidates_status_idx
      ON organization_merge_candidates(status, id);

    CREATE TABLE IF NOT EXISTS organization_conflicts (
      id INTEGER PRIMARY KEY,
      company_id INTEGER,
      source_key TEXT NOT NULL,
      field_type TEXT NOT NULL,
      current_value TEXT,
      incoming_value TEXT NOT NULL,
      resolution TEXT NOT NULL DEFAULT 'pending',
      imported_run_id TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS organization_conflicts_status_idx
      ON organization_conflicts(resolution, id);

    CREATE TABLE IF NOT EXISTS organization_redirects (
      old_slug TEXT PRIMARY KEY,
      company_id INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
  const now = new Date().toISOString();
  const seedSource = db.prepare(`
    INSERT INTO organization_sources(
      source_key, display_name, source_url, source_type, trust_rank, rights_status, updated_at
    ) VALUES(?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(source_key) DO UPDATE SET
      display_name = excluded.display_name,
      source_url = excluded.source_url,
      source_type = excluded.source_type,
      trust_rank = excluded.trust_rank,
      rights_status = excluded.rights_status,
      updated_at = excluded.updated_at
  `);
  seedSource.run(
    'egov_gbd_ul',
    'Министерство юстиции РК — data.egov.kz',
    'https://data.egov.kz/datasets/view?index=gbd_ul',
    'official_registry',
    90,
    'open_government_data',
    now
  );
  seedSource.run(
    'business_directory_kz_2026',
    'Пользовательская выгрузка бизнес-справочника Казахстана',
    null,
    'business_directory_export',
    40,
    'user_supplied_underlying_license_not_recorded',
    now
  );
  seedSource.run(
    'verified_override',
    'Подтверждённое исправление владельца организации',
    null,
    'manual_override',
    100,
    'verified_first_party_correction',
    now
  );
}

function rebuildSearch(db) {
  db.exec(`
    DROP TABLE IF EXISTS companies_fts;
    CREATE VIRTUAL TABLE companies_fts USING fts5(
      name_ru,
      name_kk,
      aliases,
      bin,
      contacts,
      content='',
      columnsize=0,
      tokenize='unicode61 remove_diacritics 2'
    );
    INSERT INTO companies_fts(rowid, name_ru, name_kk, aliases, bin, contacts)
      SELECT c.id, c.name_ru, c.name_kk, c.search_aliases, c.bin,
             trim(COALESCE(c.contact_search, '') || ' ' || COALESCE((
               SELECT group_concat(d.search_text, ' ')
               FROM organization_details d WHERE d.company_id = c.id
             ), ''))
      FROM companies c;
  `);
}

function backfillDerivedCompanyFields(db, options = {}) {
  const batchSize = Math.max(100, Math.min(Number(options.batchSize) || 5000, 25000));
  let lastId = Number.parseInt(getMeta(db, 'company_derived_backfill_last_id', '0'), 10) || 0;
  const select = db.prepare(`
    SELECT id, bin, name_ru, name_kk, contact_source,
           phone, mobile_phone, email, website, whatsapp, viber, telegram
    FROM companies
    WHERE id > ? AND (
      normalized_name IS NULL OR normalized_name = ''
      OR search_aliases IS NULL
      OR contact_search IS NULL
      OR primary_source_key IS NULL OR primary_source_key = ''
    )
    ORDER BY id LIMIT ?
  `);
  const update = db.prepare(`
    UPDATE companies SET
      normalized_name = ?,
      search_aliases = ?,
      contact_search = ?,
      primary_source_key = COALESCE(NULLIF(primary_source_key, ''), ?)
    WHERE id = ?
  `);

  let updated = 0;
  while (true) {
    const rows = select.all(lastId, batchSize);
    if (!rows.length) break;
    db.exec('BEGIN');
    try {
      for (const row of rows) {
        const primarySource = /^\d{12}$/.test(String(row.bin || '').trim())
          ? 'egov_gbd_ul'
          : (row.contact_source === 'directory' ? 'business_directory_kz_2026' : 'egov_gbd_ul');
        update.run(
          normalizeCompanyName(row.name_ru || row.name_kk),
          buildSearchAliases(row.name_ru, row.name_kk),
          buildContactSearch(row),
          primarySource,
          row.id
        );
        lastId = Number(row.id);
        updated += 1;
      }
      setMeta(db, 'company_derived_backfill_last_id', lastId);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    if (typeof options.onProgress === 'function') options.onProgress({ lastId, updated });
  }
  setMeta(db, 'company_derived_backfill_completed_at', new Date().toISOString());
  return updated;
}

module.exports = {
  backfillDerivedCompanyFields,
  createSchema,
  getMeta,
  hasColumn,
  rebuildSearch,
  setMeta,
};
