'use strict';

const Datastore = require('nedb-promises');
const path = require('path');
const fs   = require('fs');

const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = Datastore.create({
  filename: path.join(DATA_DIR, 'notaries.db'),
  autoload: true,
});

db.ensureIndex({ fieldName: 'slug'   }).catch(() => {});
db.ensureIndex({ fieldName: 'name'   }).catch(() => {});
db.ensureIndex({ fieldName: 'active' }).catch(() => {});

module.exports = {
  findBySlug(slug)  { return db.findOne({ slug }); },
  count()           { return db.count({}); },
  getAllSlugs()      { return db.find({}, { slug: 1, name: 1, region: 1, updatedAt: 1, _id: 0 }); },
  getLastUpdated()  { return db.findOne({}, { updatedAt: 1, _id: 0 }).then(d => d ? d.updatedAt : null); },
  search(query, limit = 30) {
    if (!query || query.trim().length < 2) return Promise.resolve([]);
    const safe = query.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return db.find({ name: new RegExp(safe, 'i') }, { name: 1, slug: 1, region: 1, _id: 0 }).limit(limit);
  },
  async getRegions() {
    const all = await db.find({}, { region: 1, _id: 0 });
    const counts = {};
    all.forEach(d => { if (d.region) counts[d.region] = (counts[d.region] || 0) + 1; });
    return Object.entries(counts).map(([region, count]) => ({ region, count })).sort((a, b) => b.count - a.count);
  },
  findByRegion(region, limit = 200) {
    const safe = region.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return db.find({ region: new RegExp('^' + safe + '$', 'i') }, { name: 1, slug: 1, phone: 1, email: 1, _id: 0 }).limit(limit);
  },
};
