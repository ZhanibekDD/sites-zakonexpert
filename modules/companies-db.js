'use strict';

const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const { companySlug } = require('./company-slug');
const { REGIONS, regionLabel } = require('./company-region');
const { evaluateCompany, QUALITY_VERSION } = require('./company-quality');
const { isGenericLegalFormName } = require('./company-name-normalize');
const { contactValues, normalizePhoneDigits } = require('./company-details-normalize');
const { hydrateDetails: hydrateCompactDetails } = require('./company-details-store');
const { transliterateCompanyName } = require('./company-transliterate');
const {
  applyRegistryPrivacyOverride,
  hasRegistryContactSuppressions,
  isRegistryContactSuppressed,
} = require('./registry-privacy');

const DEFAULT_DB_PATH = path.join(__dirname, '..', 'data', 'companies.sqlite');
const DB_PATH = process.env.COMPANIES_DB_PATH || DEFAULT_DB_PATH;
// Keep each dynamic sitemap small enough for the low-memory Plesk process.
// At 10k URLs one XML response is about 2.4 MB; concurrent crawler requests
// caused worker 502s and the old in-process cache could grow above 190 MB.
const SITEMAP_LIMIT = 5000;

let db = null;

function open() {
  if (db) return db;
  if (!fs.existsSync(DB_PATH)) return null;
  db = new DatabaseSync(DB_PATH, { readOnly: true });
  db.exec('PRAGMA query_only = ON;');
  return db;
}

function close() {
  if (!db) return;
  db.close();
  db = null;
}

function available() {
  return Boolean(open());
}

function getMeta(database, key) {
  try {
    const row = database.prepare('SELECT value FROM company_meta WHERE key = ?').get(key);
    return row ? row.value : null;
  } catch (_) {
    return null;
  }
}

function hasColumn(database, column) {
  try {
    return Boolean(database.prepare("SELECT 1 FROM pragma_table_info('companies') WHERE name = ?").get(column));
  } catch (_) {
    return false;
  }
}

// Production can briefly run the new application code against the previous
// companies.sqlite schema while an offline organization import is pending.
// Keep all read paths compatible with that database instead of turning a
// normal code deployment into an HTTP 500 for the whole catalog.
function sourceProjection(database, qualifier = '') {
  const prefix = qualifier ? `${qualifier}.` : '';
  if (hasColumn(database, 'primary_source_key')) {
    return `${prefix}primary_source_key`;
  }
  if (hasColumn(database, 'contact_source')) {
    return `CASE
      WHEN ${prefix}contact_source IN ('directory', 'business_directory_kz_2026')
      THEN 'business_directory_kz_2026'
      ELSE 'egov_gbd_ul'
    END AS primary_source_key`;
  }
  return "'egov_gbd_ul' AS primary_source_key";
}

function contactSummaryProjection(database, qualifier = '') {
  const prefix = qualifier ? `${qualifier}.` : '';
  return ['phone', 'mobile_phone', 'email', 'website']
    .map(column => hasColumn(database, column)
      ? `${prefix}${column}`
      : `NULL AS ${column}`)
    .join(', ');
}

function qualityRowsAvailable(database) {
  return hasColumn(database, 'is_indexable')
    && getMeta(database, 'quality_version') === QUALITY_VERSION;
}

function publicBrowseFilter(database, qualifier = '') {
  if (!qualityRowsAvailable(database)) return '';
  const prefix = qualifier ? `${qualifier}.` : '';
  return `WHERE ${prefix}is_indexable = 1`;
}

function optionalMetaCount(database, key) {
  const value = Number.parseInt(getMeta(database, key), 10);
  return Number.isInteger(value) && value >= 0 ? value : null;
}

function hasTable(database, table) {
  try {
    return Boolean(database.prepare(
      "SELECT 1 FROM sqlite_master WHERE type IN ('table', 'view') AND name = ?"
    ).get(table));
  } catch (_) {
    return false;
  }
}

function stats() {
  const database = open();
  if (!database) return {
    available: false, count: 0, updatedAt: null, source: null,
    qualityReady: false, indexableCount: 0, excludedCount: 0, qualityUpdatedAt: null,
    officialCount: 0, directoryOnlyCount: 0, withContactsCount: 0,
  };
  const completedAt = getMeta(database, 'completed_at');
  if (!completedAt) return {
    available: false, count: 0, updatedAt: null, source: null,
    qualityReady: false, indexableCount: 0, excludedCount: 0, qualityUpdatedAt: null,
    officialCount: 0, directoryOnlyCount: 0, withContactsCount: 0,
  };
  const qualityReady = qualityRowsAvailable(database);
  const metaCount = Number.parseInt(getMeta(database, 'record_count'), 10);
  const count = Number.isInteger(metaCount) && metaCount >= 0
    ? metaCount
    : Number(database.prepare('SELECT COUNT(*) AS count FROM companies').get().count || 0);
  const metaIndexableCount = Number.parseInt(getMeta(database, 'indexable_count'), 10);
  const indexableCount = qualityReady && Number.isInteger(metaIndexableCount) && metaIndexableCount >= 0
    ? metaIndexableCount
    : 0;
  return {
    available: true,
    count,
    updatedAt: getMeta(database, 'source_updated_at'),
    source: getMeta(database, 'source_url'),
    qualityReady,
    indexableCount,
    excludedCount: qualityReady ? Math.max(0, count - indexableCount) : count,
    qualityUpdatedAt: getMeta(database, 'quality_backfilled_at') || getMeta(database, 'source_updated_at'),
    // The legacy database has no trustworthy split counters. Returning null
    // lets the template hide those cards until the offline import writes the
    // exact values; displaying a made-up zero would mislead visitors.
    officialCount: optionalMetaCount(database, 'official_count'),
    directoryOnlyCount: optionalMetaCount(database, 'directory_only_count'),
    withContactsCount: optionalMetaCount(database, 'with_contacts_count'),
  };
}

function sourceMetadata(company) {
  const directorySource = company?.primary_source_key === 'business_directory_kz_2026'
    || company?.contact_source === 'directory'
    || company?.contact_source === 'business_directory_kz_2026';
  const sourceKey = directorySource
    ? 'business_directory_kz_2026'
    : (company?.primary_source_key || 'egov_gbd_ul');
  const official = sourceKey === 'egov_gbd_ul';
  return {
    key: sourceKey,
    label: official
      ? 'Министерство юстиции РК — data.egov.kz'
      : (directorySource
        ? 'Пользовательская выгрузка бизнес-справочника Казахстана'
        : 'Ранее импортированные данные'),
    priority: official ? 90 : (directorySource ? 40 : 20),
    official,
  };
}

function decorateCompany(company) {
  if (!company) return null;
  const sanitized = sanitizeCompanyContactFields(
    applyRegistryPrivacyOverride('companies', company)
  );
  const source = sourceMetadata(sanitized);
  return {
    ...sanitized,
    primary_source_key: source.key,
    source_label: source.label,
    is_official_source: source.official,
    has_verified_bin: /^\d{12}$/.test(String(sanitized.bin || '').trim()),
    display_name_kk: isGenericLegalFormName(sanitized.name_kk) ? null : sanitized.name_kk,
  };
}

function sanitizeCompanyContactFields(company) {
  if (!company || !hasRegistryContactSuppressions('companies', company.bin)) return company;
  const sanitized = { ...company };
  for (const type of ['phone', 'mobile_phone', 'email', 'website', 'whatsapp', 'viber', 'telegram']) {
    if (!sanitized[type]) continue;
    sanitized[type] = contactValues(type, sanitized[type])
      .filter(contact => !isRegistryContactSuppressed(
        'companies',
        sanitized.bin,
        contact.normalized || contact.value
      ))
      .map(contact => contact.value)
      .join(', ');
  }
  if (Array.isArray(sanitized.contacts)) {
    sanitized.contacts = sanitized.contacts.filter(contact => !isRegistryContactSuppressed(
      'companies',
      sanitized.bin,
      contact?.normalized || contact?.value
    ));
  }
  return sanitized;
}

function addSlug(rawCompany) {
  const company = decorateCompany(rawCompany);
  if (!company) return null;
  return {
    ...company,
    slug: companySlug(company.id, company.name_ru || company.name_kk),
  };
}

function normalizePage(value) {
  const page = Number.parseInt(value, 10);
  return Number.isFinite(page) && page > 0 ? page : 1;
}

function ftsQuery(query) {
  const phone = normalizePhoneDigits(query);
  const input = phone || String(query || '');
  return (input.match(/[\p{L}\p{N}]+/gu) || [])
    .filter(part => part.length >= 2 || /^\d+$/.test(part))
    .slice(0, 6)
    .map(part => `"${part}"*`)
    .join(' AND ');
}

function search(query, page = 1, limit = 30) {
  const database = open();
  const q = String(query || '').trim();
  if (!database || !getMeta(database, 'completed_at') || q.length < 2) {
    return { items: [], page: 1, hasMore: false };
  }

  const safePage = normalizePage(page);
  const safeLimit = Math.min(Math.max(Number.parseInt(limit, 10) || 30, 1), 100);
  const offset = (safePage - 1) * safeLimit;
  let items = [];

  if (/^\d{12}$/.test(q)) {
    const primarySource = sourceProjection(database);
    const contactSummary = contactSummaryProjection(database);
    items = database.prepare(`
      SELECT id, bin, name_ru, name_kk, registration_date, address_ru,
             activity_ru, leader, status_ru, ${contactSummary}, ${primarySource}
      FROM companies WHERE bin = ? ORDER BY id LIMIT ? OFFSET ?
    `).all(q, safeLimit + 1, offset);
  } else {
    const match = ftsQuery(q);
    if (!match) return { items: [], page: safePage, hasMore: false };
    const primarySource = sourceProjection(database, 'c');
    const contactSummary = contactSummaryProjection(database, 'c');
    items = database.prepare(`
      SELECT c.id, c.bin, c.name_ru, c.name_kk, c.registration_date,
             c.address_ru, c.activity_ru, c.leader, c.status_ru,
             ${contactSummary}, ${primarySource}
      FROM companies_fts f
      JOIN companies c ON c.id = f.rowid
      WHERE companies_fts MATCH ?
      ORDER BY bm25(companies_fts, 14.0, 10.0, 3.0, 5.0, 0.35),
               c.is_indexable DESC, c.quality_score DESC, c.id
      LIMIT ? OFFSET ?
    `).all(match, safeLimit + 1, offset);
  }

  const visibleItems = items.filter(item => !isRegistryContactSuppressed('companies', item.bin, q));
  return {
    items: visibleItems.slice(0, safeLimit).map(addSlug),
    page: safePage,
    hasMore: visibleItems.length > safeLimit,
  };
}

function browse(page = 1, limit = 30) {
  const database = open();
  if (!database || !getMeta(database, 'completed_at')) {
    return { items: [], page: 1, hasMore: false };
  }
  const safePage = normalizePage(page);
  const safeLimit = Math.min(Math.max(Number.parseInt(limit, 10) || 30, 1), 100);
  const offset = (safePage - 1) * safeLimit;
  const primarySource = sourceProjection(database);
  // Once quality metadata is ready, use the (is_indexable, id) index as a
  // range scan. The previous ORDER BY is_indexable DESC, id made SQLite sort
  // all 1.2M rows before returning the first 31 cards on production.
  const eligibility = publicBrowseFilter(database);
  const items = database.prepare(`
    SELECT id, bin, name_ru, name_kk, registration_date, address_ru,
           activity_ru, leader, status_ru, ${primarySource}
    FROM companies
    ${eligibility}
    ORDER BY id
    LIMIT ? OFFSET ?
  `).all(safeLimit + 1, offset);
  return {
    items: items.slice(0, safeLimit).map(addSlug),
    page: safePage,
    hasMore: items.length > safeLimit,
  };
}

function dedupeDetails(items, key) {
  const result = new Map();
  for (const item of items) {
    const value = key(item);
    if (!value) continue;
    const previous = result.get(value);
    if (!previous || Number(item.priority || 0) > Number(previous.priority || 0)) {
      result.set(value, item);
    }
  }
  return Array.from(result.values());
}

function legacyContacts(company) {
  const rows = [];
  const directorySource = company.contact_source === 'directory'
    || company.contact_source === 'business_directory_kz_2026';
  for (const type of ['phone', 'mobile_phone', 'email', 'website', 'whatsapp', 'viber', 'telegram']) {
    for (const contact of contactValues(type, company[type])) {
      rows.push({
        type,
        value: contact.value,
        normalized: contact.normalized,
        sourceKey: directorySource ? 'business_directory_kz_2026' : (company.contact_source || 'legacy'),
        sourceLabel: directorySource
          ? 'Пользовательская выгрузка бизнес-справочника Казахстана'
          : 'Ранее импортированные данные',
        priority: directorySource ? 40 : 20,
        verifiedAt: company.contact_updated_at || null,
      });
    }
  }
  if (company.work_hours) {
    company.attributes = [{
      type: 'work_hours',
      value: company.work_hours,
      sourceKey: directorySource ? 'business_directory_kz_2026' : (company.contact_source || 'legacy'),
      sourceLabel: directorySource
        ? 'Пользовательская выгрузка бизнес-справочника Казахстана'
        : 'Ранее импортированные данные',
      priority: directorySource ? 40 : 20,
    }];
  }
  return rows;
}

function hydrateDetails(database, rawCompany) {
  if (!rawCompany) return null;
  const company = decorateCompany(rawCompany);
  const source = sourceMetadata(company);
  let contacts = legacyContacts(company);
  let addresses = company.address_ru ? [{
    value: company.address_ru,
    rawValue: company.address_ru,
    regionSlug: company.region_slug,
    city: null,
    postalCode: null,
    latitude: source.official ? null : Number.parseFloat(company.lat) || null,
    longitude: source.official ? null : Number.parseFloat(company.lon) || null,
    sourceKey: source.key,
    sourceLabel: source.label,
    priority: source.priority,
    primary: true,
  }] : [];
  let names = [
    company.name_ru ? {
      locale: 'ru', value: company.name_ru, normalized: company.normalized_name,
      sourceKey: source.key, sourceLabel: source.label, priority: source.priority,
    } : null,
    company.display_name_kk ? {
      locale: 'kk', value: company.display_name_kk, normalized: company.normalized_name,
      sourceKey: source.key, sourceLabel: source.label, priority: source.priority,
    } : null,
  ].filter(Boolean);
  for (const displayName of [company.name_ru, company.display_name_kk]) {
    const latin = transliterateCompanyName(displayName);
    if (latin) {
      names.push({
        locale: 'Latn',
        value: latin,
        normalized: latin,
        sourceKey: 'deterministic_transliteration',
        sourceLabel: 'Вариант названия латиницей',
        priority: 10,
      });
    }
  }
  let categories = [];
  let attributes = company.attributes || [];
  if (!source.official && company.activity_ru) {
    const [category, ...subcategory] = String(company.activity_ru).split(/\s+—\s+/);
    categories.push({
      category,
      subcategory: subcategory.join(' — '),
      slug: '',
      sourceKey: source.key,
      sourceLabel: source.label,
    });
  }

  if (hasTable(database, 'organization_details')) {
    const compactRows = database.prepare(`
      SELECT d.details_json AS detailsJson, d.source_key AS sourceKey,
             os.display_name AS sourceLabel, os.trust_rank AS priority
      FROM organization_details d
      LEFT JOIN organization_sources os ON os.source_key = d.source_key
      WHERE d.company_id = ?
      ORDER BY os.trust_rank DESC, d.source_key
    `).all(company.id);
    for (const row of compactRows) {
      const hydrated = hydrateCompactDetails(row.detailsJson, {
        key: row.sourceKey,
        label: row.sourceLabel,
        priority: row.priority,
      });
      contacts = contacts.concat(hydrated.contacts);
      addresses = addresses.concat(hydrated.addresses);
      names = names.concat(hydrated.names);
      categories = categories.concat(hydrated.categories);
      attributes = attributes.concat(hydrated.attributes);
    }
  }
  if (hasTable(database, 'organization_overrides')) {
    const overrides = database.prepare(`
      SELECT field_type AS type, field_key AS key, display_value AS value,
             normalized_value AS normalized, verified_at AS verifiedAt
      FROM organization_overrides WHERE company_id = ? AND active = 1
      ORDER BY verified_at DESC
    `).all(company.id);
    for (const override of overrides) {
      if (override.type === 'contact') {
        contacts.unshift({
          type: override.key,
          value: override.value,
          normalized: override.normalized,
          sourceKey: 'verified_override',
          sourceLabel: 'Подтверждённое исправление',
          priority: 100,
          primary: true,
          verifiedAt: override.verifiedAt,
        });
      } else if (['name_ru', 'name_kk', 'address_ru', 'activity_ru', 'leader', 'status_ru'].includes(override.type)) {
        company[override.type] = override.value;
      }
    }
  }

  company.contacts = dedupeDetails(
    contacts.filter(contact => !isRegistryContactSuppressed(
      'companies',
      company.bin,
      contact.normalized || contact.value
    )),
    item => `${item.type}:${item.normalized || item.value}`
  );
  company.addresses = dedupeDetails(addresses, item => String(item.value || '').toLocaleLowerCase('ru-RU'));
  company.names = dedupeDetails(names, item => `${item.locale}:${item.normalized || item.value}`);
  company.categories = dedupeDetails(categories, item => `${item.category}:${item.subcategory}`);
  company.attributes = dedupeDetails(attributes, item => `${item.type}:${item.value}`);
  return company;
}

function findById(id) {
  const database = open();
  const numericId = Number.parseInt(id, 10);
  if (!database || !getMeta(database, 'completed_at')
      || !Number.isSafeInteger(numericId) || numericId <= 0) return null;
  return addSlug(hydrateDetails(
    database,
    database.prepare('SELECT * FROM companies WHERE id = ?').get(numericId)
  ));
}

function findByBin(bin) {
  const database = open();
  const safeBin = String(bin || '').replace(/\D/g, '');
  if (!database || !getMeta(database, 'completed_at') || !/^\d{12}$/.test(safeBin)) return null;
  return addSlug(hydrateDetails(
    database,
    database.prepare('SELECT * FROM companies WHERE bin = ? ORDER BY id LIMIT 1').get(safeBin)
  ));
}

function regionStats() {
  const database = open();
  if (!database || !getMeta(database, 'completed_at')) return [];
  const eligibility = publicBrowseFilter(database);
  const rows = database.prepare(`
    SELECT region_slug, COUNT(*) AS count FROM companies
    ${eligibility ? `${eligibility} AND` : 'WHERE'} region_slug IS NOT NULL
    GROUP BY region_slug
  `).all();
  const counts = new Map(rows.map(r => [r.region_slug, Number(r.count)]));
  return REGIONS
    .map(([slug, label]) => ({ slug, label, count: counts.get(slug) || 0 }))
    .filter(r => r.count > 0)
    .sort((a, b) => b.count - a.count);
}

function byRegion(slug, page = 1, limit = 30) {
  const database = open();
  const label = regionLabel(slug);
  if (!database || !getMeta(database, 'completed_at') || !label) {
    return { items: [], page: 1, hasMore: false, label: null };
  }
  const safePage = normalizePage(page);
  const safeLimit = Math.min(Math.max(Number.parseInt(limit, 10) || 30, 1), 100);
  const offset = (safePage - 1) * safeLimit;
  const primarySource = sourceProjection(database);
  const qualityFilter = qualityRowsAvailable(database) ? 'AND is_indexable = 1' : '';
  const items = database.prepare(`
    SELECT id, bin, name_ru, name_kk, registration_date, address_ru,
           activity_ru, leader, status_ru, ${primarySource}
    FROM companies WHERE region_slug = ? ${qualityFilter}
    ORDER BY id LIMIT ? OFFSET ?
  `).all(slug, safeLimit + 1, offset);
  return {
    items: items.slice(0, safeLimit).map(addSlug),
    page: safePage,
    hasMore: items.length > safeLimit,
    label,
  };
}

function redirectByOldSlug(oldSlug) {
  const database = open();
  if (!database || !hasTable(database, 'organization_redirects')) return null;
  const row = database.prepare(`
    SELECT c.id, c.name_ru, c.name_kk
    FROM organization_redirects r
    JOIN companies c ON c.id = r.company_id
    WHERE r.old_slug = ?
  `).get(String(oldSlug || ''));
  return addSlug(row);
}

function sitemapChunkCount() {
  const info = stats();
  return info.available && info.qualityReady ? Math.ceil(info.indexableCount / SITEMAP_LIMIT) : 0;
}

function sitemapChunk(chunk) {
  const database = open();
  const safeChunk = Number.parseInt(chunk, 10);
  if (!database || !stats().qualityReady || !Number.isInteger(safeChunk) || safeChunk < 1) return [];
  return database.prepare(`
    SELECT id, name_ru, name_kk, quality_score, is_indexable
    FROM companies WHERE is_indexable = 1 ORDER BY id LIMIT ? OFFSET ?
  `).all(SITEMAP_LIMIT, (safeChunk - 1) * SITEMAP_LIMIT).map(addSlug);
}

function quality(company) {
  return evaluateCompany(company);
}

module.exports = {
  DB_PATH,
  SITEMAP_LIMIT,
  available,
  browse,
  byRegion,
  close,
  findByBin,
  findById,
  quality,
  redirectByOldSlug,
  regionStats,
  search,
  sitemapChunk,
  sitemapChunkCount,
  stats,
};
