'use strict';
const Datastore = require('nedb-promises');
const path = require('path');
const { enableAutocompaction } = require('./db-maintenance');

const db = Datastore.create({
  filename: process.env.LEADS_DB_PATH || path.join(__dirname, '..', 'data', 'leads.db'),
  autoload: true,
});
enableAutocompaction(db);

async function recordLead({ name, phone, issue, question, page, source, campaign, ip, ua }) {
  return db.insert({ name, phone, issue, question, page, source, campaign, ip, ua, ts: Date.now(), status: 'new' });
}

async function getRecent(limit = 10) {
  return db.find({}).sort({ ts: -1 }).limit(limit);
}

async function getCount(since) {
  const q = since ? { ts: { $gte: since } } : {};
  return db.count(q);
}

function summarizeLeads(leads) {
  const result = { total: 0, byPage: {}, byIssue: {}, bySource: {} };
  for (const lead of leads || []) {
    result.total += 1;
    const page = String(lead.page || '/').slice(0, 300);
    const issue = String(lead.issue || 'other').slice(0, 80);
    const source = String(lead.source || 'не определён').slice(0, 120);
    result.byPage[page] = (result.byPage[page] || 0) + 1;
    result.byIssue[issue] = (result.byIssue[issue] || 0) + 1;
    result.bySource[source] = (result.bySource[source] || 0) + 1;
  }
  return result;
}

async function getSummary(since) {
  const query = since ? { ts: { $gte: since } } : {};
  return summarizeLeads(await db.find(query));
}

async function purgeOlderThan(cutoff) {
  return db.remove({ ts: { $lt: cutoff } }, { multi: true });
}

module.exports = { recordLead, getRecent, getCount, getSummary, purgeOlderThan, summarizeLeads };
