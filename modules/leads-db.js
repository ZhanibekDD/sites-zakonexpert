'use strict';
const Datastore = require('nedb-promises');
const path = require('path');

const db = Datastore.create({
  filename: path.join(__dirname, '..', 'data', 'leads.db'),
  autoload: true,
});

async function recordLead({ name, phone, issue, question, page, ip, ua }) {
  return db.insert({ name, phone, issue, question, page, ip, ua, ts: Date.now(), status: 'new' });
}

async function getRecent(limit = 10) {
  return db.find({}).sort({ ts: -1 }).limit(limit);
}

async function getCount(since) {
  const q = since ? { ts: { $gte: since } } : {};
  return db.count(q);
}

module.exports = { recordLead, getRecent, getCount };
