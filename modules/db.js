/**
 * ZakonExpert — Database Module (NeDB — pure JavaScript)
 */
'use strict';

const Datastore = require('nedb-promises');
const path      = require('path');
const fs        = require('fs');
const { compactDatastore, enableAutocompaction } = require('./db-maintenance');

const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const news = Datastore.create({
  filename: path.join(DATA_DIR, 'news.db'),
  autoload: true,
});
enableAutocompaction(news);

// Indexes
news.ensureIndex({ fieldName: 'original_url', unique: true, sparse: true }).catch(() => {});
news.ensureIndex({ fieldName: 'slug',         unique: true               }).catch(() => {});

function newsTimestamp(article) {
  return article.published_at_source || article.published_at_site || article.imported_at || '';
}

const CATEGORY_ALIASES = {
  'аресты': ['finance', 'bank', 'кредит'],
  finance: ['finance', 'bank', 'кредит', 'банкротство'],
  chsi: ['chsi', 'ЧСИ'],
  notarius: ['notarius', 'нотариус'],
  alimenty: ['alimenty', 'алименты'],
  shtrafy: ['shtrafy', 'штрафы'],
  avto: ['avto', 'авто'],
  laws: ['laws', 'законы'],
};

function categoryQuery(category) {
  const aliases = CATEGORY_ALIASES[category] || [category];
  return { $in: aliases };
}

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

  async existsByGeneratedTitle(title) {
    const norm = title.toLowerCase().trim().substring(0, 60);
    const all  = await news.find({});
    return all.some(a => a.title && a.title.toLowerCase().trim().substring(0, 60) === norm);
  },

  async getPublished(limit = 20, offset = 0) {
    const docs = await news.find({ status: 'published', category: { $ne: 'Адвокат' } });
    docs.sort((a, b) => newsTimestamp(b).localeCompare(newsTimestamp(a)));
    return docs.slice(offset, offset + limit);
  },

  async countPublished() {
    return news.count({ status: 'published', category: { $ne: 'Адвокат' } });
  },

  async getBySlug(slug) {
    return news.findOne({ slug, status: 'published' });
  },

  async getByCategory(category, limit = 20, offset = 0) {
    const docs = await news.find({ category: categoryQuery(category), status: 'published' });
    docs.sort((a, b) => newsTimestamp(b).localeCompare(newsTimestamp(a)));
    return docs.slice(offset, offset + limit);
  },

  async countByCategory(category) {
    return news.count({ category: categoryQuery(category), status: 'published' });
  },

  async getByTags(tagQuery) {
    const re = new RegExp(tagQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    const docs = await news.find({ tags: re, status: 'published' });
    docs.sort((a, b) => (b.published_at_site || '').localeCompare(a.published_at_site || ''));
    return docs.slice(0, 6);
  },

  async getLatest(limit = 6) {
    const docs = await news.find({ status: 'published', category: { $ne: 'Адвокат' } });
    docs.sort((a, b) => newsTimestamp(b).localeCompare(newsTimestamp(a)));
    return docs.slice(0, limit).map(a => ({
      title:            a.title,
      slug:             a.slug,
      source_name:      a.source_name,
      category:         a.category,
      excerpt:          a.excerpt,
      category_cover:   a.category_cover,
      og_image:         a.og_image,
      published_at_source: a.published_at_source,
      published_at_site: a.published_at_site,
      tags:             a.tags,
    }));
  },

  async getAllForSitemap() {
    const docs = await news.find({ status: 'published' });
    docs.sort((a, b) => newsTimestamp(b).localeCompare(newsTimestamp(a)));
    return docs.map(a => ({
      slug:             a.slug,
      published_at_source: a.published_at_source,
      published_at_site: a.published_at_site,
      updatedAt:        a.updatedAt,
    }));
  },

  async getStats() {
    const [published, drafts, rejected, all] = await Promise.all([
      news.count({ status: 'published' }),
      news.count({ status: 'draft' }),
      news.count({ status: 'rejected' }),
      news.count({}),
    ]);
    return { published, drafts, rejected, total: all };
  },

  async getLatestPublishedAt() {
    const docs = await news.find({ status: 'published', category: { $ne: 'Адвокат' } });
    if (!docs.length) return null;
    docs.sort((a, b) => newsTimestamp(b).localeCompare(newsTimestamp(a)));
    return newsTimestamp(docs[0]) || null;
  },

  async updateOgImage(id, ogImage) {
    return news.update({ _id: id }, { $set: { og_image: ogImage } }, {});
  },

  async getAllWithoutImage() {
    const docs = await news.find({ status: 'published', og_image: { $in: [null, undefined, ''] } });
    return docs;
  },

  /** Delete ALL news articles (full reset) */
  async clearAll() {
    await news.remove({}, { multi: true });
    await compactDatastore(news);
  },

  compact() {
    return compactDatastore(news);
  },

  /** Remove draft/rejected articles and those with obviously irrelevant titles */
  async removeIrrelevant() {
    const irrelevantPatterns = [
      'гороскоп', 'отпуск', 'туризм', 'рецепт', 'погода',
      'кино', 'спорт', 'убийств', 'убит', 'нашли тело',
      'нефть', 'опек', 'наркот',
    ];
    const all = await news.find({});
    let removed = 0;
    for (const doc of all) {
      const titleLower = (doc.title || '').toLowerCase();
      const isIrrelevant = irrelevantPatterns.some(p => titleLower.includes(p));
      // Remove rejected articles and drafts older than 7 days
      const isOldDraft = doc.status === 'draft'
        && doc.imported_at
        && (Date.now() - new Date(doc.imported_at).getTime()) > 7 * 24 * 3600 * 1000;

      if (isIrrelevant || doc.status === 'rejected' || isOldDraft) {
        await news.remove({ _id: doc._id }, {});
        removed++;
      }
    }
    return removed;
  },
};
