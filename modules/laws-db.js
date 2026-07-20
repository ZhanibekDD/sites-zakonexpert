'use strict';

const Datastore = require('nedb-promises');
const path = require('path');
const fs   = require('fs');
const { compactDatastore, enableAutocompaction } = require('./db-maintenance');

const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = Datastore.create({
  filename: path.join(DATA_DIR, 'laws.db'),
  autoload: true,
});
enableAutocompaction(db);

db.ensureIndex({ fieldName: 'slug',    unique: true }).catch(() => {});
db.ensureIndex({ fieldName: 'code'                  }).catch(() => {});
db.ensureIndex({ fieldName: 'numInt'                }).catch(() => {});

let _codesCache = null;
let _codesCacheAt = 0;

module.exports = {
  compact() {
    return compactDatastore(db);
  },

  async upsert(article) {
    return db.update({ slug: article.slug }, { $set: article }, { upsert: true });
  },

  findBySlug(slug) {
    return db.findOne({ slug });
  },

  findByCode(code, limit = 500) {
    return db.find({ code }, { text: 0 }).sort({ numInt: 1 }).limit(limit);
  },

  findByCodePage(code, limit = 30, skip = 0) {
    return db.find({ code }, { text: 0 })
      .sort({ numInt: 1 })
      .skip(Math.max(0, skip))
      .limit(Math.max(1, Math.min(100, limit)));
  },

  count(query = {}) {
    return db.count(query);
  },

  getAllSlugs() {
    return db.find({}, { slug: 1, updatedAt: 1, _id: 0 });
  },

  // Called on every /statyi and /statya/:slug request — cache briefly so a
  // full-collection scan doesn't run on each page view.
  getCodes() {
    const now = Date.now();
    if (_codesCache && now - _codesCacheAt < 5 * 60 * 1000) return Promise.resolve(_codesCache);
    return db.find({}, { code: 1, codeName: 1, shortName: 1, _id: 0 }).then(docs => {
      const seen = {};
      docs.forEach(d => { seen[d.code] = { code: d.code, codeName: d.codeName, shortName: d.shortName }; });
      _codesCache = Object.values(seen);
      _codesCacheAt = now;
      return _codesCache;
    });
  },

  // Full-text search across title + text
  search(q, code, limit = 40) {
    if (!q || q.trim().length < 2) return Promise.resolve([]);
    const safe = q.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re   = new RegExp(safe, 'i');
    const filter = code
      ? { code, $or: [{ title: re }, { num: re }, { text: re }] }
      : {         $or: [{ title: re }, { num: re }, { text: re }] };
    return db.find(filter, { text: 0 }).sort({ numInt: 1 }).limit(limit);
  },

  // Search by article number only (faster for "96" queries)
  searchByNum(num, code) {
    const filter = code ? { code, num: num.toString() } : { num: num.toString() };
    return db.find(filter, { text: 0 }).limit(10);
  },

  // Adjacent articles for "Related" sidebar
  async adjacent(code, numInt) {
    const prev = await db.findOne({ code, numInt: { $lt: numInt } }, { text: 0 }).sort({ numInt: -1 });
    const next = await db.findOne({ code, numInt: { $gt: numInt } }, { text: 0 }).sort({ numInt:  1 });
    return { prev, next };
  },
};
