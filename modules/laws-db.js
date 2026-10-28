'use strict';

const Datastore = require('nedb-promises');
const path = require('path');
const fs   = require('fs');
const { compactDatastore, enableAutocompaction } = require('./db-maintenance');
const { repairUpkContent } = require('./upk-content-repair');

const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = Datastore.create({
  filename: path.join(DATA_DIR, 'laws.db'),
  autoload: true,
});
enableAutocompaction(db);

// Use the application's existing NeDB writer. Do not replace the live file or
// run a second writer alongside Passenger. Every public operation waits for
// this one idempotent, source-validated repair before reading article content.
const ready = (async () => {
  await db.load();
  await db.ensureIndex({ fieldName: 'slug', unique: true });
  await db.ensureIndex({ fieldName: 'code' });
  await db.ensureIndex({ fieldName: 'numInt' });
  const snapshot = require('../config/law-sources/upk-rk-repair-2026-10-28.json');
  return repairUpkContent(db, snapshot);
})();
ready.catch(error => console.error('[Laws] UPK repair validation/initialization failed:', error.message));

let _codesCache = null;
let _codesCacheAt = 0;

module.exports = {
  ready,

  async compact() {
    await ready;
    return compactDatastore(db);
  },

  async upsert(article) {
    await ready;
    return db.update({ slug: article.slug }, { $set: article }, { upsert: true });
  },

  async findBySlug(slug) {
    await ready;
    return db.findOne({ slug });
  },

  async findByCode(code, limit = 500) {
    await ready;
    return db.find({ code }, { text: 0 }).sort({ numInt: 1 }).limit(limit);
  },

  async findByCodePage(code, limit = 30, skip = 0) {
    await ready;
    return db.find({ code }, { text: 0 })
      .sort({ numInt: 1 })
      .skip(Math.max(0, skip))
      .limit(Math.max(1, Math.min(100, limit)));
  },

  async count(query = {}) {
    await ready;
    return db.count(query);
  },

  async getAllSlugs() {
    await ready;
    return db.find({}, { slug: 1, updatedAt: 1, _id: 0 });
  },

  // Called on every /statyi and /statya/:slug request — cache briefly so a
  // full-collection scan doesn't run on each page view.
  async getCodes() {
    await ready;
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
  async search(q, code, limit = 40) {
    await ready;
    if (!q || q.trim().length < 2) return Promise.resolve([]);
    const safe = q.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re   = new RegExp(safe, 'i');
    const filter = code
      ? { code, $or: [{ title: re }, { num: re }, { text: re }] }
      : {         $or: [{ title: re }, { num: re }, { text: re }] };
    return db.find(filter, { text: 0 }).sort({ numInt: 1 }).limit(limit);
  },

  // Search by article number only (faster for "96" queries)
  async searchByNum(num, code) {
    await ready;
    const filter = code ? { code, num: num.toString() } : { num: num.toString() };
    return db.find(filter, { text: 0 }).limit(10);
  },

  // Adjacent articles for "Related" sidebar
  async adjacent(code, numInt) {
    await ready;
    const prev = await db.findOne({ code, numInt: { $lt: numInt } }, { text: 0 }).sort({ numInt: -1 });
    const next = await db.findOne({ code, numInt: { $gt: numInt } }, { text: 0 }).sort({ numInt:  1 });
    return { prev, next };
  },
};
