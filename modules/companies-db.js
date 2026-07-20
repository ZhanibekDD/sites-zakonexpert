'use strict';

const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const { companySlug } = require('./company-slug');
const { REGIONS, regionLabel } = require('./company-region');

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

function stats() {
  const database = open();
  if (!database) return { available: false, count: 0, updatedAt: null, source: null };
  const completedAt = getMeta(database, 'completed_at');
  if (!completedAt) return { available: false, count: 0, updatedAt: null, source: null };
  const row = database.prepare('SELECT COUNT(*) AS count FROM companies').get();
  return {
    available: true,
    count: Number(row.count || 0),
    updatedAt: getMeta(database, 'source_updated_at'),
    source: getMeta(database, 'source_url'),
  };
}

function addSlug(company) {
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
  return query
    .trim()
    .split(/\s+/)
    .map(part => part.replace(/["'():*+\-^~{}[\]\\]/g, '').trim())
    .filter(part => part.length >= 2)
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
    items = database.prepare(`
      SELECT id, bin, name_ru, name_kk, registration_date, address_ru,
             activity_ru, leader, status_ru
      FROM companies WHERE bin = ? ORDER BY id LIMIT ? OFFSET ?
    `).all(q, safeLimit + 1, offset);
  } else {
    const match = ftsQuery(q);
    if (!match) return { items: [], page: safePage, hasMore: false };
    items = database.prepare(`
      SELECT c.id, c.bin, c.name_ru, c.name_kk, c.registration_date,
             c.address_ru, c.activity_ru, c.leader, c.status_ru
      FROM companies_fts f
      JOIN companies c ON c.id = f.rowid
      WHERE companies_fts MATCH ?
      ORDER BY rank LIMIT ? OFFSET ?
    `).all(match, safeLimit + 1, offset);
  }

  return {
    items: items.slice(0, safeLimit).map(addSlug),
    page: safePage,
    hasMore: items.length > safeLimit,
  };
}

function findById(id) {
  const database = open();
  const numericId = Number.parseInt(id, 10);
  if (!database || !getMeta(database, 'completed_at')
      || !Number.isSafeInteger(numericId) || numericId <= 0) return null;
  return addSlug(database.prepare('SELECT * FROM companies WHERE id = ?').get(numericId));
}

function regionStats() {
  const database = open();
  if (!database || !getMeta(database, 'completed_at')) return [];
  const rows = database.prepare(`
    SELECT region_slug, COUNT(*) AS count FROM companies
    WHERE region_slug IS NOT NULL GROUP BY region_slug
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
  const items = database.prepare(`
    SELECT id, bin, name_ru, name_kk, registration_date, address_ru,
           activity_ru, leader, status_ru
    FROM companies WHERE region_slug = ? ORDER BY id LIMIT ? OFFSET ?
  `).all(slug, safeLimit + 1, offset);
  return {
    items: items.slice(0, safeLimit).map(addSlug),
    page: safePage,
    hasMore: items.length > safeLimit,
    label,
  };
}

function sitemapChunkCount() {
  const info = stats();
  return info.available ? Math.ceil(info.count / SITEMAP_LIMIT) : 0;
}

function sitemapChunk(chunk) {
  const database = open();
  const safeChunk = Number.parseInt(chunk, 10);
  if (!database || !Number.isInteger(safeChunk) || safeChunk < 1) return [];
  return database.prepare(`
    SELECT id, name_ru, name_kk FROM companies ORDER BY id LIMIT ? OFFSET ?
  `).all(SITEMAP_LIMIT, (safeChunk - 1) * SITEMAP_LIMIT).map(addSlug);
}

module.exports = {
  DB_PATH,
  SITEMAP_LIMIT,
  available,
  byRegion,
  close,
  findById,
  regionStats,
  search,
  sitemapChunk,
  sitemapChunkCount,
  stats,
};
