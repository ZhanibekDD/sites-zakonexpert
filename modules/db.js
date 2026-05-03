/**
 * ZakonExpert — Database Module (NeDB — pure JavaScript)
 */
const Datastore = require('nedb-promises');
const path = require('path');
const fs = require('fs');

const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const news = Datastore.create({
  filename: path.join(DATA_DIR, 'news.db'),
  autoload: true,
});

// Setup indexes on startup
news.ensureIndex({ fieldName: 'original_url', unique: true, sparse: true }).catch(() => {});
news.ensureIndex({ fieldName: 'slug', unique: true }).catch(() => {});

module.exports = {
  async insertNews(article) {
    try {
      await news.insert(article);
      return { changes: 1 };
    } catch (e) {
      if (e.errorType === 'uniqueViolated') return { changes: 0 };
      throw e;
    }
  },

  async existsByUrl(url) {
    const doc = await news.findOne({ original_url: url });
    return !!doc;
  },

  async getPublished(limit = 20, offset = 0) {
    const docs = await news.find({ status: 'published' });
    docs.sort((a, b) => (b.published_at_site || '').localeCompare(a.published_at_site || ''));
    return docs.slice(offset, offset + limit);
  },

  async countPublished() {
    return news.count({ status: 'published' });
  },

  async getBySlug(slug) {
    return news.findOne({ slug, status: 'published' });
  },

  async getByCategory(category, limit = 20, offset = 0) {
    const docs = await news.find({ category, status: 'published' });
    docs.sort((a, b) => (b.published_at_site || '').localeCompare(a.published_at_site || ''));
    return docs.slice(offset, offset + limit);
  },

  async countByCategory(category) {
    return news.count({ category, status: 'published' });
  },

  async getByTags(tagQuery) {
    const re = new RegExp(tagQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    const docs = await news.find({ tags: re, status: 'published' });
    docs.sort((a, b) => (b.published_at_site || '').localeCompare(a.published_at_site || ''));
    return docs.slice(0, 6);
  },

  async getLatest(limit = 6) {
    const docs = await news.find({ status: 'published' });
    docs.sort((a, b) => (b.published_at_site || '').localeCompare(a.published_at_site || ''));
    return docs.slice(0, limit).map(a => ({
      title: a.title, slug: a.slug, source_name: a.source_name,
      category: a.category, excerpt: a.excerpt,
      published_at_site: a.published_at_site, og_image: a.og_image
    }));
  },

  async getAllForSitemap() {
    const docs = await news.find({ status: 'published' });
    docs.sort((a, b) => (b.published_at_site || '').localeCompare(a.published_at_site || ''));
    return docs.map(a => ({ slug: a.slug, published_at_site: a.published_at_site, updatedAt: a.updatedAt }));
  },
};
