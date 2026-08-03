'use strict';

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { DatabaseSync } = require('node:sqlite');
const {
  backfillDerivedCompanyFields,
  createSchema,
  rebuildSearch,
} = require('../modules/companies-schema');
const { evaluateCompany, minScore, QUALITY_VERSION } = require('../modules/company-quality');
const { companySlug } = require('../modules/company-slug');
const { detectRegion } = require('../modules/company-region');
const { normalizeCompanyName } = require('../modules/company-name-normalize');
const { buildSearchAliases } = require('../modules/company-transliterate');
const { backfillDatabase, qualityNeedsBackfill } = require('./backfill-company-quality');

const ROOT = path.join(__dirname, '..');
const FINAL_DB = process.env.COMPANIES_DB_PATH || path.join(ROOT, 'data', 'companies.sqlite');
const DATASET_URL = 'https://data.egov.kz/datasets/view?index=gbd_ul';
const PUBLIC_DATA_URL = 'https://data.egov.kz/datasets/getdata';
const API_URL = 'https://data.egov.kz/api/v4/gbd_ul/v1';
const DEFAULT_PAGE_SIZE = 100;
const MIN_FULL_RECORDS = 900000;
const DATASET_VIEW_ACCEPT = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8';
const DATASET_JSON_ACCEPT = 'application/json, text/javascript, */*; q=0.01';

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
    registrationDate: pick(values, [
      'registerdate', 'registrationdate', 'regdate', 'datereg', 'dateregistration',
    ]),
    addressRu: pick(values, ['addressru', 'addressrus', 'rusaddress', 'address']),
    activityRu: pick(values, ['okedru', 'activityru', 'mainactivityru', 'okednameru', 'activity']),
    leader: pick(values, ['fio', 'leader', 'head', 'director', 'headfio', 'fiohead']),
    statusRu: pick(values, ['statusru', 'subjectstatusru', 'status']),
  };
}

function withRegion(company) {
  return { ...company, regionSlug: detectRegion(company.addressRu) };
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
    // data.egov.kz uses HTTP content negotiation here. Axios' default Accept
    // header makes the endpoint look for a non-existent `view.txt` template
    // and return 500, while a browser-compatible HTML Accept returns the
    // dataset page and session cookies normally.
    headers: {
      Accept: DATASET_VIEW_ACCEPT,
      'User-Agent': 'ZakonExpert registry importer/1.1',
    },
  });
  const cookies = (response.headers['set-cookie'] || []).map(v => v.split(';')[0]).join('; ');
  return axios.create({
    timeout: 45000,
    headers: {
      Accept: DATASET_JSON_ACCEPT,
      'User-Agent': 'ZakonExpert registry importer/1.1',
      'X-Requested-With': 'XMLHttpRequest',
      Referer: DATASET_URL,
      ...(cookies ? { Cookie: cookies } : {}),
    },
  });
}

async function fetchPublicPage(client, page, pageSize, filter = {}) {
  const response = await client.get(PUBLIC_DATA_URL, {
    params: {
      index: 'gbd_ul', version: 'v1', page, count: pageSize,
      text: filter.text || '', column: filter.column || '', order: filter.order || '',
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
      id, bin, name_ru, name_kk, registration_date, address_ru,
      activity_ru, leader, status_ru, imported_at, region_slug,
      quality_score, is_indexable, normalized_name, search_aliases,
      contact_search, primary_source_key
    ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      bin=excluded.bin, name_ru=excluded.name_ru, name_kk=excluded.name_kk,
      registration_date=excluded.registration_date, address_ru=excluded.address_ru,
      activity_ru=excluded.activity_ru, leader=excluded.leader,
      status_ru=excluded.status_ru, imported_at=excluded.imported_at,
      region_slug=excluded.region_slug, quality_score=excluded.quality_score,
      is_indexable=excluded.is_indexable,
      normalized_name=excluded.normalized_name,
      search_aliases=excluded.search_aliases,
      primary_source_key='egov_gbd_ul'
  `);

  let inserted = 0;
  db.exec('BEGIN');
  try {
    for (const raw of rows) {
      const company = normalizeCompanyRow(raw);
      if (!company) continue;
      const withRegionSlug = withRegion(company);
      const quality = evaluateCompany(withRegionSlug);
      statement.run(
        company.id, company.bin, company.nameRu, company.nameKk,
        company.registrationDate, company.addressRu, company.activityRu,
        company.leader, company.statusRu, importedAt, withRegionSlug.regionSlug,
        quality.score, quality.indexable ? 1 : 0,
        normalizeCompanyName(company.nameRu || company.nameKk),
        buildSearchAliases(company.nameRu, company.nameKk),
        '',
        'egov_gbd_ul'
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
  const targetRaw = value('--id=');
  const targetId = targetRaw === undefined ? null : Number.parseInt(targetRaw, 10);
  return {
    all: args.has('--all'),
    confirmOffline: args.has('--confirm-offline'),
    fresh: args.has('--fresh'),
    pages: Number.parseInt(value('--pages=') || '', 10) || 1,
    pageSize: Math.min(Number.parseInt(value('--page-size=') || '', 10) || DEFAULT_PAGE_SIZE, 100),
    targetId,
    targetRaw,
  };
}

function searchIdentity(company) {
  if (!company) return '';
  return JSON.stringify([
    company.bin || '', company.name_ru || '', company.name_kk || '',
    company.search_aliases || '',
  ]);
}

async function refreshCompanyById(database, targetId) {
  const existing = database.prepare(`
    SELECT id, bin, name_ru, name_kk, search_aliases
    FROM companies WHERE id = ?
  `).get(targetId);
  if (!existing) {
    throw new Error(`Company ${targetId} is not in the active database; use a reviewed full import.`);
  }

  const client = await withRetry(createPublicClient, 'dataset session');
  const data = await withRetry(
    () => fetchPublicPage(client, 1, 100, { text: String(targetId), column: 'id' }),
    `company ${targetId}`
  );
  const sourceRow = data.rows.find(row => normalizeCompanyRow(row)?.id === targetId);
  if (!sourceRow) throw new Error(`Company ${targetId} was not returned by the official dataset.`);

  const refreshedAt = new Date().toISOString();
  insertRows(database, [sourceRow], refreshedAt);
  const updated = database.prepare(`
    SELECT id, bin, name_ru, name_kk, search_aliases,
           registration_date, address_ru, activity_ru, leader, status_ru
    FROM companies WHERE id = ?
  `).get(targetId);
  if (searchIdentity(existing) !== searchIdentity(updated)) {
    console.log('[Companies] Search identity changed; rebuilding the company search index...');
    rebuildSearch(database);
  }
  setMeta(database, 'last_targeted_refresh_at', refreshedAt);
  setMeta(database, 'last_targeted_refresh_id', targetId);
  return updated;
}

async function importCompanies(options = parseArgs(process.argv.slice(2))) {
  if (options.targetRaw !== undefined
      && (!Number.isSafeInteger(options.targetId) || options.targetId <= 0)) {
    throw new Error('--id must be a positive integer');
  }
  if (options.targetId && options.all) {
    throw new Error('Use either --id for one record or --all for the full import, not both');
  }
  if (options.all && !options.confirmOffline) {
    throw new Error('Full activation requires --confirm-offline (stop Node.js before running)');
  }
  if (options.targetId && !options.confirmOffline) {
    throw new Error('Targeted refresh requires --confirm-offline (stop Node.js before running)');
  }

  fs.mkdirSync(path.dirname(FINAL_DB), { recursive: true });
  if (options.fresh && fs.existsSync(FINAL_DB)) fs.rmSync(FINAL_DB, { force: true });

  const database = new DatabaseSync(FINAL_DB);
  createSchema(database);
  if (options.targetId) {
    try {
      const company = await refreshCompanyById(database, options.targetId);
      if (qualityNeedsBackfill(database)) {
        console.log('[Companies] Company quality metadata is missing or stale; repairing sitemap eligibility...');
        backfillDatabase(database);
      } else {
        const total = Number(database.prepare('SELECT COUNT(*) AS count FROM companies').get().count || 0);
        const indexable = Number(database.prepare(
          'SELECT COUNT(*) AS count FROM companies WHERE is_indexable = 1'
        ).get().count || 0);
        setMeta(database, 'record_count', total);
        setMeta(database, 'indexable_count', indexable);
        setMeta(database, 'excluded_count', Math.max(0, total - indexable));
        setMeta(database, 'quality_backfilled_at', new Date().toISOString());
      }
      console.log(`[Companies] Refreshed official company ${options.targetId}. Restart Node.js.`);
      return { targeted: true, id: options.targetId, company };
    } finally {
      database.close();
    }
  }
  backfillDerivedCompanyFields(database, {
    batchSize: 5000,
    onProgress: progress => {
      if (progress.updated % 50000 === 0) {
        console.log(`[Companies] Prepared ${progress.updated} existing organization match keys`);
      }
    },
  });
  const apiKey = clean(process.env.EGOV_API_KEY);
  const publicClient = apiKey ? null : await withRetry(createPublicClient, 'dataset session');
  const startPage = Number.parseInt(getMeta(database, 'next_page', '1'), 10) || 1;
  const importedAt = getMeta(database, 'import_run_id') || String(Math.floor(Date.now() / 1000));
  setMeta(database, 'import_run_id', importedAt);
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
    database.prepare(`
      DELETE FROM companies
      WHERE imported_at != ?
        AND COALESCE(NULLIF(primary_source_key, ''), 'egov_gbd_ul') = 'egov_gbd_ul'
        AND NOT EXISTS (
          SELECT 1 FROM organization_source_links sl WHERE sl.company_id = companies.id
        )
        AND NOT EXISTS (
          SELECT 1 FROM organization_overrides ov
          WHERE ov.company_id = companies.id AND ov.active = 1
        )
    `).run(importedAt);
    console.log('[Companies] Building full-text search index...');
    rebuildSearch(database);
    setMeta(database, 'completed_at', new Date().toISOString());
    setMeta(database, 'source_updated_at', new Date().toISOString());
    const totalStored = Number(database.prepare('SELECT COUNT(*) AS count FROM companies').get().count || 0);
    const officialCount = Number(database.prepare(`
      SELECT COUNT(*) AS count FROM companies
      WHERE length(trim(COALESCE(bin, ''))) = 12
        AND trim(bin) NOT GLOB '*[^0-9]*'
    `).get().count || 0);
    const directoryOnlyCount = Number(database.prepare(`
      SELECT COUNT(*) AS count FROM companies
      WHERE primary_source_key = 'business_directory_kz_2026'
        AND (bin IS NULL OR bin = '')
    `).get().count || 0);
    const withContactsCount = Number(database.prepare(`
      SELECT COUNT(*) AS count FROM companies c
      WHERE EXISTS (
        SELECT 1 FROM organization_details d
        WHERE d.company_id = c.id AND d.search_text != ''
      ) OR COALESCE(
        c.phone, c.mobile_phone, c.email, c.website,
        c.whatsapp, c.viber, c.telegram, ''
      ) != ''
    `).get().count || 0);
    setMeta(database, 'record_count', totalStored);
    setMeta(database, 'official_count', officialCount);
    setMeta(database, 'directory_only_count', directoryOnlyCount);
    setMeta(database, 'with_contacts_count', withContactsCount);
    setMeta(database, 'quality_version', QUALITY_VERSION);
    setMeta(database, 'quality_min_score', minScore());
    const indexableCount = Number(database.prepare(
      'SELECT COUNT(*) AS count FROM companies WHERE is_indexable = 1'
    ).get().count || 0);
    setMeta(database, 'indexable_count', indexableCount);
    setMeta(database, 'excluded_count', Math.max(0, stored - indexableCount));
    setMeta(database, 'quality_backfilled_at', new Date().toISOString());
    setMeta(database, 'next_page', 1);
    setMeta(database, 'last_subject_id', 0);
    setMeta(database, 'import_run_id', '');
    database.exec('PRAGMA optimize;');
    database.close();
    console.log(`[Companies] Activated ${stored} official records (${totalStored} total organizations). Restart Node.js.`);
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
  DATASET_JSON_ACCEPT,
  DATASET_VIEW_ACCEPT,
  MIN_FULL_RECORDS,
  createPublicClient,
  fetchPublicPage,
  importCompanies,
  insertRows,
  normalizeCompanyRow,
  parseArgs,
  refreshCompanyById,
};
