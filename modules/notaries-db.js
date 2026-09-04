'use strict';

const Datastore = require('nedb-promises');
const path = require('path');
const fs   = require('fs');
const { enableAutocompaction } = require('./db-maintenance');
const { findArchiveDirectory } = require('./notary-archive');
const { resolvePersonSlugAlias } = require('./seo-url-policy');

const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = Datastore.create({
  filename: path.join(DATA_DIR, 'notaries.db'),
  autoload: true,
});
enableAutocompaction(db);

db.ensureIndex({ fieldName: 'slug'   }).catch(() => {});
db.ensureIndex({ fieldName: 'name'   }).catch(() => {});
db.ensureIndex({ fieldName: 'active' }).catch(() => {});
db.ensureIndex({ fieldName: 'region' }).catch(() => {});

module.exports = {
  async findBySlug(slug) {
    const exact = await db.findOne({ slug });
    if (exact) return exact;
    const storedAlias = await db.findOne({ legacySlugs: slug });
    if (storedAlias) return storedAlias;
    const candidates = await db.find({}, { slug: 1, legacySlugs: 1, _id: 0 });
    const inferred = resolvePersonSlugAlias(candidates, slug);
    return inferred ? db.findOne({ slug: inferred.slug }) : null;
  },
  count()           { return db.count({}); },
  getAllSlugs()      { return db.find({}, { slug: 1, name: 1, region: 1, updatedAt: 1, _id: 0 }); },
  getLastUpdated()  { return db.findOne({}, { updatedAt: 1, _id: 0 }).then(d => d ? d.updatedAt : null); },
  async search(query, limit = 30) {
    if (!query || query.trim().length < 2) return [];
    const q = query.trim().toUpperCase();
    const words = q.split(/\s+/).filter(w => w.length >= 2);
    const all = await db.find({}, {
      name: 1, slug: 1, region: 1, address: 1, phone: 1, email: 1, license: 1, _id: 0,
    });
    return all.filter(d => {
      const searchable = [d.name, d.region, d.address, d.phone, d.email, d.license]
        .filter(Boolean).join(' ').toUpperCase();
      return words.every(w => searchable.includes(w));
    }).slice(0, limit);
  },

  async fuzzySearch(query, limit = 3) {
    if (!query || query.trim().length < 2) return [];
    const firstWord = query.trim().toUpperCase().split(/\s+/)[0];
    if (firstWord.length < 3) return [];
    const all = await db.find({}, { name: 1, slug: 1, region: 1, _id: 0 });
    function lev(a, b) {
      const m = a.length, n = b.length;
      const dp = Array.from({ length: m + 1 }, (_, i) => [i]);
      for (let j = 0; j <= n; j++) dp[0][j] = j;
      for (let i = 1; i <= m; i++)
        for (let j = 1; j <= n; j++)
          dp[i][j] = a[i-1] === b[j-1] ? dp[i-1][j-1] : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
      return dp[m][n];
    }
    return all
      .map(d => {
        const nameFirst = (d.name || '').toUpperCase().split(/\s+/)[0] || '';
        const dist = lev(firstWord, nameFirst);
        const sim = 1 - dist / Math.max(firstWord.length, nameFirst.length, 1);
        return { doc: d, sim };
      })
      .filter(x => x.sim >= 0.68)
      .sort((a, b) => b.sim - a.sim)
      .slice(0, limit)
      .map(x => x.doc);
  },
  async getRegions() {
    const all = await db.find({}, { region: 1, _id: 0 });
    const counts = {};
    all.forEach(d => { if (d.region) counts[d.region] = (counts[d.region] || 0) + 1; });
    return Object.entries(counts).map(([region, count]) => ({ region, count })).sort((a, b) => b.count - a.count);
  },
  countByRegion(region) {
    return db.count({ region: region.trim() });
  },
  findByRegion(region, limit = 60, skip = 0) {
    return db.find({ region: region.trim() }, {
      name: 1,
      slug: 1,
      active: 1,
      license: 1,
      licenseDate: 1,
      address: 1,
      phone: 1,
      email: 1,
      schedule: 1,
      archiveFor: 1,
      archiveEvidence: 1,
      sourceChamberUrl: 1,
      updatedAt: 1,
      _id: 0,
    }).sort({ name: 1 }).skip(skip).limit(limit);
  },
  async getArchiveDirectory(query = '') {
    const all = await db.find({}, {
      name: 1,
      slug: 1,
      region: 1,
      active: 1,
      license: 1,
      licenseDate: 1,
      address: 1,
      phone: 1,
      email: 1,
      archiveFor: 1,
      archiveEvidence: 1,
      sourceChamberUrl: 1,
      schedule: 1,
      updatedAt: 1,
      _id: 0,
    });
    return findArchiveDirectory(all, query);
  },
};
