'use strict';

const Datastore = require('nedb-promises');
const path = require('path');
const fs = require('fs');
const { enableAutocompaction } = require('./db-maintenance');

const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = Datastore.create({
  filename: path.join(DATA_DIR, 'comments.db'),
  autoload: true,
});
enableAutocompaction(db);

db.ensureIndex({ fieldName: 'slug'     }).catch(() => {});
db.ensureIndex({ fieldName: 'type'     }).catch(() => {});
db.ensureIndex({ fieldName: 'approved' }).catch(() => {});

module.exports = {
  add(comment) {
    return db.insert({ ...comment, approved: false, createdAt: new Date() });
  },
  getApproved(type, slug) {
    return db.find({ type, slug, approved: true }).sort({ createdAt: -1 });
  },
  getAll() {
    return db.find({}).sort({ createdAt: -1 });
  },
  approve(id) {
    return db.update({ _id: id }, { $set: { approved: true } });
  },
  remove(id) {
    return db.remove({ _id: id });
  },
  async stats(type, slug) {
    const docs = await db.find({ type, slug, approved: true });
    if (!docs.length) return null;
    const avg = docs.reduce((s, c) => s + (c.rating || 5), 0) / docs.length;
    return { count: docs.length, avg: Math.round(avg * 10) / 10 };
  },
  purgeModeratorIps(cutoff) {
    return db.update(
      { createdAt: { $lt: new Date(cutoff) }, ip: { $exists: true } },
      { $unset: { ip: true } },
      { multi: true },
    );
  },
};
