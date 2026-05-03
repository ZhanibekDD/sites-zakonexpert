/**
 * ZakonExpert — SQLite Database Module
 * Manages news articles storage
 */
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = path.join(DATA_DIR, 'zakonexpert.db');
const db = new Database(DB_PATH);

// Enable WAL mode for better concurrency
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS news (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    source_name TEXT,
    source_url TEXT,
    original_url TEXT UNIQUE,
    excerpt TEXT,
    ai_summary TEXT,
    legal_commentary TEXT,
    category TEXT DEFAULT 'general',
    tags TEXT DEFAULT '[]',
    status TEXT DEFAULT 'draft',
    relevance_score REAL DEFAULT 0,
    published_at_source TEXT,
    published_at_site TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    meta_title TEXT,
    meta_description TEXT,
    og_image TEXT,
    image_url TEXT,
    canonical_url TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_news_status ON news(status);
  CREATE INDEX IF NOT EXISTS idx_news_category ON news(category);
  CREATE INDEX IF NOT EXISTS idx_news_slug ON news(slug);
  CREATE INDEX IF NOT EXISTS idx_news_published ON news(published_at_site DESC);

  CREATE TABLE IF NOT EXISTS news_sources (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    base_url TEXT,
    rss_url TEXT,
    enabled INTEGER DEFAULT 1,
    category TEXT DEFAULT 'general',
    fetch_interval_minutes INTEGER DEFAULT 60,
    last_fetched_at TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );
`);

// ---- News queries ----

const stmts = {
  insertNews: db.prepare(`
    INSERT OR IGNORE INTO news
      (title, slug, source_name, source_url, original_url, excerpt, ai_summary, legal_commentary,
       category, tags, status, relevance_score, published_at_source, published_at_site,
       meta_title, meta_description, og_image, image_url, canonical_url)
    VALUES
      (@title, @slug, @source_name, @source_url, @original_url, @excerpt, @ai_summary, @legal_commentary,
       @category, @tags, @status, @relevance_score, @published_at_source, @published_at_site,
       @meta_title, @meta_description, @og_image, @image_url, @canonical_url)
  `),

  getPublished: db.prepare(`
    SELECT * FROM news WHERE status = 'published'
    ORDER BY published_at_site DESC
    LIMIT ? OFFSET ?
  `),

  countPublished: db.prepare(`SELECT COUNT(*) as cnt FROM news WHERE status = 'published'`),

  getBySlug: db.prepare(`SELECT * FROM news WHERE slug = ? AND status = 'published'`),

  getByCategory: db.prepare(`
    SELECT * FROM news WHERE category = ? AND status = 'published'
    ORDER BY published_at_site DESC
    LIMIT ? OFFSET ?
  `),

  countByCategory: db.prepare(`SELECT COUNT(*) as cnt FROM news WHERE category = ? AND status = 'published'`),

  getByTags: db.prepare(`
    SELECT * FROM news WHERE tags LIKE ? AND status = 'published'
    ORDER BY published_at_site DESC
    LIMIT 6
  `),

  getLatest: db.prepare(`
    SELECT id, title, slug, source_name, category, excerpt, published_at_site, og_image
    FROM news WHERE status = 'published'
    ORDER BY published_at_site DESC
    LIMIT ?
  `),

  existsByUrl: db.prepare(`SELECT id FROM news WHERE original_url = ?`),

  getAllForSitemap: db.prepare(`
    SELECT slug, published_at_site, updated_at FROM news WHERE status = 'published'
    ORDER BY published_at_site DESC
  `),

  updateSourceFetch: db.prepare(`
    UPDATE news_sources SET last_fetched_at = datetime('now') WHERE id = ?
  `),

  getSources: db.prepare(`SELECT * FROM news_sources WHERE enabled = 1`),

  publishDraft: db.prepare(`
    UPDATE news SET status = 'published', published_at_site = datetime('now'), updated_at = datetime('now')
    WHERE id = ?
  `)
};

module.exports = {
  db,

  // Insert a news article (returns info object)
  insertNews(article) {
    return stmts.insertNews.run(article);
  },

  // Check if URL already exists
  existsByUrl(url) {
    return !!stmts.existsByUrl.get(url);
  },

  // Get published news with pagination
  getPublished(limit = 20, offset = 0) {
    return stmts.getPublished.all(limit, offset);
  },

  countPublished() {
    return stmts.countPublished.get().cnt;
  },

  // Get single article by slug
  getBySlug(slug) {
    return stmts.getBySlug.get(slug);
  },

  // Get by category with pagination
  getByCategory(category, limit = 20, offset = 0) {
    return stmts.getByCategory.all(category, limit, offset);
  },

  countByCategory(category) {
    return stmts.countByCategory.get(category).cnt;
  },

  // Get articles by tag (for related news on service pages)
  getByTags(tagQuery) {
    return stmts.getByTags.all(`%${tagQuery}%`);
  },

  getLatest(limit = 6) {
    return stmts.getLatest.all(limit);
  },

  getAllForSitemap() {
    return stmts.getAllForSitemap.all();
  },

  updateSourceFetch(id) {
    stmts.updateSourceFetch.run(id);
  },

  getSources() {
    return stmts.getSources.all();
  },

  publishDraft(id) {
    stmts.publishDraft.run(id);
  }
};
