'use strict';

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { DatabaseSync } = require('node:sqlite');
const { createSchema, rebuildSearch } = require('../modules/companies-schema');
const { companySlug } = require('../modules/company-slug');

const ROOT = path.join(__dirname, '..');
const FINAL_DB = process.env.COMPANIES_DB_PATH || path.join(ROOT, 'data', 'companies.sqlite');
const DATASET_URL = 'https://data.egov.kz/datasets/view?index=gbd_ul';
const API_URL = 'https://data.egov.kz/api/v4/gbd_ul/v1';
const API_KEY_URL = 'https://data.egov.kz/profile/apikeylist';
const DEFAULT_PAGE_SIZE = 100;
const MIN_FULL_RECORDS = 900000;

function clean(value) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/\s+/g, ' ').trim();
}

function normalizedKeys(row) {
  const values = new Map();
  for (const [key, value] of Object.entries(row || {})) {
    const normalized = key.toLowerCase().replace(/[^a-zа-яё0-9]/gi, '');
    values.set(normalized, value);
  }
  return values;
}

function pick(values, candidates) {
  for (const candidate of candidates) {
    const value = values.get(candidate);
    if (value !== undefined && value !== null && clean(value)) return clean(value);
  }
  return '';
}

function normalizeCompanyRow(row) {
  const values = normalizedKeys(row);
  const idRaw = pick(values, ['id', 'subjectid', 'idsubject', 'subid', 'entityid']);
  const id = Number.parseInt(idRaw, 10);
  if (!Number.isSafeInteger(id) || id <= 0) return null;

  const nameRu = pick(values, ['nameru', 'rusname', 'namerus', 'name', 'organizationnameru']);
  const nameKk = pick(values, ['namekz', 'namekk', 'kazname', 'namekaz', 'organizationnamekz']);
  const displayName = nameRu || nameKk;
  if (!displayName) return null;

  return {
    id,
    slug: companySlug(id, displayName),
    bin: pick(values, ['bin', 'businessidentificationnumber', 'businessid']),
    nameRu,
    nameKk,
    registrationDate: pick(values, ['registerdate', 'registrationdate', 'regdate', 'dateregistration']),
    addressRu: pick(values, ['addressru', 'addressrus', 'rusaddress', 'address']),
    activityRu: pick(values, ['okedru', 'activityru', 'mainactivityru', 'okednameru', 'activity']),
    leader: pick(values, ['fio', 'leader', 'head', 'director', 'headfio', 'fiohead']),
    statusRu: pick(values, ['statusru', 'subjectstatusru', 'status']),
  };
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function withRetry(fn, label, attempts = 5) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt === attempts) break;
      const delay = Math.min(1000 * (2 ** (attempt - 1)), 15000);
      console.warn(`[Companies] ${label} failed (${error.message}); retry in ${delay} ms`);
      await sleep(delay);
    }
  }
  throw lastError;
}

async function fetchApiPage(apiKey, page, pageSize) {
  const source = {
    from: (page - 1) * pageSize,
    size: pageSize,
    sort: [{ id: { order: 'asc' } }],
  };
  const response = await axios.get(API_URL, {
    timeout: 45000,
    params: { apiKey, source: JSON.stringify(source) },
    headers: { 'User-Agent': 'ZakonExpert registry importer/1.0' },
  });
  const rows = Array.isArray(response.data) ? response.data : response.data?.data;
  if (!Array.isArray(rows)) throw new Error('Unexpected data.egov.kz API response');
  return { rows, totalCount: 0, totalPages: 0 };
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

function insertRows(db, rows, importedAt) {
  const statement = db.prepare(`
    INSERT INTO companies(
      id, bin, name_ru, name_kk, registration_date, address_ru,
      activity_ru, leader, status_ru, imported_at
    ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      bin=excluded.bin, name_ru=excluded.name_ru, name_kk=excluded.name_kk,
      registration_date=excluded.registration_date, address_ru=excluded.address_ru,
      activity_ru=excluded.activity_ru, leader=excluded.leader,
      status_ru=excluded.status_ru, imported_at=excluded.imported_at
  `);

  let inserted = 0;
  db.exec('BEGIN');
  try {
    for (const raw of rows) {
      const company = normalizeCompanyRow(raw);
      if (!company) continue;
      statement.run(
        company.id, company.bin, company.nameRu, company.nameKk,
        company.registrationDate, company.addressRu, company.activityRu,
        company.leader, company.statusRu, importedAt
      );
      inserted += 1;
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  return inserted;
}

function parseArgs(argv) {
  const args = new Set(argv);
  const value = prefix => argv.find(arg => arg.startsWith(prefix))?.slice(prefix.length);
  return {
    all: args.has('--all'),
    confirmOffline: args.has('--confirm-offline'),
    fresh: args.has('--fresh'),
    pages: Number.parseInt(value('--pages=') || '', 10) || 1,
    pageSize: Math.min(Number.parseInt(value('--page-size=') || '', 10) || DEFAULT_PAGE_SIZE, 100),
  };
}

async function importCompanies(options = parseArgs(process.argv.slice(2))) {
  if (options.all && !options.confirmOffline) {
    throw new Error('Full activation requires --confirm-offline (stop Node.js before running)');
  }

  const apiKey = clean(process.env.EGOV_API_KEY);
  if (!apiKey) {
    throw new Error(
      `EGOV_API_KEY is missing. Create a key at ${API_KEY_URL} and add EGOV_API_KEY=... to .env`
    );
  }

  fs.mkdirSync(path.dirname(FINAL_DB), { recursive: true });
  if (options.fresh && fs.existsSync(FINAL_DB)) fs.rmSync(FINAL_DB, { force: true });

  const database = new DatabaseSync(FINAL_DB);
  createSchema(database);
  const startPage = Number.parseInt(getMeta(database, 'next_page', '1'), 10) || 1;
  const importedAt = getMeta(database, 'import_run_id') || String(Math.floor(Date.now() / 1000));
  setMeta(database, 'import_run_id', importedAt);
  const lastPage = options.all ? Number.POSITIVE_INFINITY : startPage + options.pages - 1;

  console.log(`[Companies] Source: API v4; start page ${startPage}`);
  let page = startPage;
  let completed = false;
  let totalCount = Number.parseInt(getMeta(database, 'total_count', '0'), 10) || 0;

  while (page <= lastPage) {
    const data = await withRetry(
      () => fetchApiPage(apiKey, page, options.pageSize),
      `page ${page}`
    );

    if (data.totalCount) {
      totalCount = data.totalCount;
      setMeta(database, 'total_count', totalCount);
    }
    insertRows(database, data.rows, importedAt);
    setMeta(database, 'next_page', page + 1);
    setMeta(database, 'source_url', DATASET_URL);
    setMeta(database, 'last_import_progress_at', new Date().toISOString());

    if (page === startPage || page % 50 === 0) {
      const count = database.prepare('SELECT COUNT(*) AS count FROM companies').get().count;
      console.log(`[Companies] page ${page}${data.totalPages ? '/' + data.totalPages : ''}; ${count} stored`);
    }

    if (data.rows.length === 0 || (data.totalPages && page >= data.totalPages)
        || (!data.totalPages && data.rows.length < options.pageSize)) {
      completed = true;
      break;
    }
    page += 1;
    await sleep(100);
  }

  let stored = Number(database.prepare(
    'SELECT COUNT(*) AS count FROM companies WHERE imported_at = ?'
  ).get(importedAt).count || 0);
  if (options.all && completed) {
    if (stored < MIN_FULL_RECORDS) {
      database.close();
      throw new Error(`Completeness check failed: ${stored} records (minimum ${MIN_FULL_RECORDS})`);
    }
    database.prepare('DELETE FROM companies WHERE imported_at != ?').run(importedAt);
    console.log('[Companies] Building full-text search index...');
    rebuildSearch(database);
    setMeta(database, 'completed_at', new Date().toISOString());
    setMeta(database, 'source_updated_at', new Date().toISOString());
    setMeta(database, 'record_count', stored);
    setMeta(database, 'next_page', 1);
    setMeta(database, 'import_run_id', '');
    database.exec('PRAGMA optimize;');
    database.close();
    console.log(`[Companies] Activated ${stored} records in one compact database. Restart Node.js.`);
  } else {
    database.close();
    console.log(`[Companies] Checkpoint saved: ${stored} records. Run again to continue.`);
  }

  return { stored, completed, totalCount };
}

if (require.main === module) {
  importCompanies()
    .then(result => console.log('[Companies] Done:', result))
    .catch(error => { console.error('[Companies] Import failed:', error.message); process.exitCode = 1; });
}

module.exports = {
  MIN_FULL_RECORDS,
  importCompanies,
  insertRows,
  normalizeCompanyRow,
  parseArgs,
};
