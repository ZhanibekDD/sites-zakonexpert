'use strict';

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const slugify = require('slugify');
const { DatabaseSync } = require('node:sqlite');
const { createSchema, rebuildSearch } = require('../modules/companies-schema');

const ROOT = path.join(__dirname, '..');
const FINAL_DB = process.env.COMPANIES_DB_PATH || path.join(ROOT, 'data', 'companies.sqlite');
const IMPORT_DB = `${FINAL_DB}.importing`;
const DATASET_URL = 'https://data.egov.kz/datasets/view?index=gbd_ul';
const PUBLIC_DATA_URL = 'https://data.egov.kz/datasets/getdata';
const API_URL = 'https://data.egov.kz/api/v4/gbd_ul/v1';
const DEFAULT_PAGE_SIZE = 100;
const MIN_FULL_RECORDS = 900000;

slugify.extend({
  'ә': 'a', 'Ә': 'A', 'ғ': 'g', 'Ғ': 'G', 'қ': 'k', 'Қ': 'K',
  'ң': 'n', 'Ң': 'N', 'ө': 'o', 'Ө': 'O', 'ұ': 'u', 'Ұ': 'U',
  'ү': 'u', 'Ү': 'U', 'һ': 'h', 'Һ': 'H', 'і': 'i', 'І': 'I',
});

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

  const nameSlug = slugify(displayName.toLowerCase(), {
    locale: 'ru', replacement: '-', strict: true, trim: true,
  }).slice(0, 96);

  return {
    id,
    slug: `${id}-${nameSlug || 'organization'}`,
    bin: pick(values, ['bin', 'businessidentificationnumber', 'businessid']),
    nameRu,
    nameKk,
    registrationDate: pick(values, ['registerdate', 'registrationdate', 'regdate', 'dateregistration']),
    addressRu: pick(values, ['addressru', 'addressrus', 'rusaddress', 'address']),
    addressKk: pick(values, ['addresskz', 'addresskk', 'kazaddress']),
    activityRu: pick(values, ['okedru', 'activityru', 'mainactivityru', 'okednameru', 'activity']),
    activityKk: pick(values, ['okedkz', 'okedkk', 'activitykz', 'mainactivitykz', 'okednamekz']),
    leader: pick(values, ['fio', 'leader', 'head', 'director', 'headfio', 'fiohead']),
    statusRu: pick(values, ['statusru', 'subjectstatusru', 'status']),
    statusKk: pick(values, ['statuskz', 'statuskk', 'subjectstatuskz']),
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

async function createPublicClient() {
  const response = await axios.get(DATASET_URL, {
    timeout: 30000,
    headers: { 'User-Agent': 'ZakonExpert registry importer/1.0' },
  });
  const cookies = (response.headers['set-cookie'] || []).map(v => v.split(';')[0]).join('; ');
  return axios.create({
    timeout: 45000,
    headers: {
      'User-Agent': 'ZakonExpert registry importer/1.0',
      'X-Requested-With': 'XMLHttpRequest',
      Referer: DATASET_URL,
      ...(cookies ? { Cookie: cookies } : {}),
    },
  });
}

async function fetchPublicPage(client, page, pageSize) {
  const response = await client.get(PUBLIC_DATA_URL, {
    params: {
      index: 'gbd_ul', version: 'v1', page, count: pageSize,
      text: '', column: '', order: '',
    },
  });
  const body = response.data || {};
  if (!Array.isArray(body.elements)) throw new Error('Unexpected data.egov.kz response');
  return {
    rows: body.elements,
    totalCount: Number.parseInt(body.totalCount, 10) || 0,
    totalPages: Number.parseInt(body.totalPages, 10) || 0,
  };
}

async function fetchApiPage(apiKey, searchAfter, pageSize) {
  const source = {
    size: pageSize,
    sort: [{ id: { order: 'asc' } }],
  };
  if (searchAfter) source.search_after = [Number(searchAfter)];
  const response = await axios.get(API_URL, {
    timeout: 45000,
    params: { apiKey, source: JSON.stringify(source) },
    headers: { 'User-Agent': 'ZakonExpert registry importer/1.0' },
  });
  const rows = Array.isArray(response.data) ? response.data : response.data?.data;
  if (!Array.isArray(rows)) throw new Error('Unexpected data.egov.kz API response');
  const last = rows.length ? normalizeCompanyRow(rows[rows.length - 1]) : null;
  return { rows, totalCount: 0, totalPages: 0, lastId: last?.id || null };
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
      id, slug, bin, name_ru, name_kk, registration_date, address_ru, address_kk,
      activity_ru, activity_kk, leader, status_ru, status_kk, imported_at
    ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      slug=excluded.slug, bin=excluded.bin, name_ru=excluded.name_ru,
      name_kk=excluded.name_kk, registration_date=excluded.registration_date,
      address_ru=excluded.address_ru, address_kk=excluded.address_kk,
      activity_ru=excluded.activity_ru, activity_kk=excluded.activity_kk,
      leader=excluded.leader, status_ru=excluded.status_ru,
      status_kk=excluded.status_kk, imported_at=excluded.imported_at
  `);

  let inserted = 0;
  db.exec('BEGIN');
  try {
    for (const raw of rows) {
      const company = normalizeCompanyRow(raw);
      if (!company) continue;
      statement.run(
        company.id, company.slug, company.bin, company.nameRu, company.nameKk,
        company.registrationDate, company.addressRu, company.addressKk,
        company.activityRu, company.activityKk, company.leader,
        company.statusRu, company.statusKk, importedAt
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

function activateDatabase() {
  const oldPath = `${FINAL_DB}.old`;
  if (fs.existsSync(oldPath)) fs.rmSync(oldPath, { force: true });
  if (fs.existsSync(FINAL_DB)) fs.renameSync(FINAL_DB, oldPath);
  try {
    fs.renameSync(IMPORT_DB, FINAL_DB);
    if (fs.existsSync(oldPath)) fs.rmSync(oldPath, { force: true });
  } catch (error) {
    if (fs.existsSync(oldPath) && !fs.existsSync(FINAL_DB)) fs.renameSync(oldPath, FINAL_DB);
    throw error;
  }
}

async function importCompanies(options = parseArgs(process.argv.slice(2))) {
  if (options.all && !options.confirmOffline) {
    throw new Error('Full activation requires --confirm-offline (stop Node.js before running)');
  }

  fs.mkdirSync(path.dirname(FINAL_DB), { recursive: true });
  if (options.fresh && fs.existsSync(IMPORT_DB)) fs.rmSync(IMPORT_DB, { force: true });

  const database = new DatabaseSync(IMPORT_DB);
  createSchema(database);
  const importedAt = new Date().toISOString();
  const apiKey = clean(process.env.EGOV_API_KEY);
  const publicClient = apiKey ? null : await withRetry(createPublicClient, 'dataset session');
  const startPage = Number.parseInt(getMeta(database, 'next_page', '1'), 10) || 1;
  let searchAfter = Number.parseInt(getMeta(database, 'last_subject_id', '0'), 10) || 0;
  const lastPage = options.all ? Number.POSITIVE_INFINITY : startPage + options.pages - 1;

  console.log(`[Companies] Source: ${apiKey ? 'API v4' : 'public dataset'}; start page ${startPage}`);
  let page = startPage;
  let completed = false;
  let totalCount = Number.parseInt(getMeta(database, 'total_count', '0'), 10) || 0;

  while (page <= lastPage) {
    const data = await withRetry(
      () => apiKey
        ? fetchApiPage(apiKey, searchAfter, options.pageSize)
        : fetchPublicPage(publicClient, page, options.pageSize),
      `page ${page}`
    );

    if (data.totalCount) {
      totalCount = data.totalCount;
      setMeta(database, 'total_count', totalCount);
    }
    insertRows(database, data.rows, importedAt);
    if (apiKey && data.rows.length && !data.lastId) {
      throw new Error(`API page ${page} has no sortable subject id`);
    }
    if (data.lastId) {
      searchAfter = data.lastId;
      setMeta(database, 'last_subject_id', searchAfter);
    }
    setMeta(database, 'next_page', page + 1);
    setMeta(database, 'source_url', DATASET_URL);
    setMeta(database, 'source_updated_at', importedAt);

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

  const stored = Number(database.prepare('SELECT COUNT(*) AS count FROM companies').get().count || 0);
  if (options.all && completed) {
    if (stored < MIN_FULL_RECORDS) {
      database.close();
      throw new Error(`Completeness check failed: ${stored} records (minimum ${MIN_FULL_RECORDS})`);
    }
    console.log('[Companies] Building full-text search index...');
    rebuildSearch(database);
    setMeta(database, 'completed_at', new Date().toISOString());
    setMeta(database, 'record_count', stored);
    database.exec('PRAGMA optimize;');
    database.close();
    activateDatabase();
    console.log(`[Companies] Activated ${stored} records. Restart Node.js to open the new database.`);
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
