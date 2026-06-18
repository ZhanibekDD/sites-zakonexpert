'use strict';

const Datastore = require('nedb-promises');
const path = require('path');
const fs   = require('fs');

const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = Datastore.create({
  filename: path.join(DATA_DIR, 'lawyers.db'),
  autoload: true,
});

db.ensureIndex({ fieldName: 'slug'   }).catch(() => {});
db.ensureIndex({ fieldName: 'name'   }).catch(() => {});
db.ensureIndex({ fieldName: 'region' }).catch(() => {});

module.exports = {
  findBySlug(slug)  { return db.findOne({ slug }); },
  count()           { return db.count({}); },
  getAllSlugs()      { return db.find({}, { slug: 1, name: 1, region: 1, updatedAt: 1, _id: 0 }); },
  getLastUpdated()  { return db.findOne({}, { updatedAt: 1, _id: 0 }).then(d => d ? d.updatedAt : null); },
};
