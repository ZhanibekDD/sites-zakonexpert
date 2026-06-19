'use strict';
const Datastore = require('nedb-promises');
const path = require('path');

const db = Datastore.create({
  filename: path.join(__dirname, '..', 'data', 'clicks.db'),
  autoload: true,
});

async function recordClick({ type, target, page, ip, ua }) {
  return db.insert({ type, target, page, ip, ua, ts: Date.now() });
}

async function getStats(since) {
  const query = since ? { ts: { $gte: since } } : {};
  const clicks = await db.find(query);
  const r = {
    total: clicks.length,
    phone_advocate: 0, phone_mediator: 0, phone_main: 0,
    wa_advocate: 0,    wa_mediator: 0,    wa_main: 0,
  };
  for (const c of clicks) {
    const key = `${c.type}_${c.target}`;
    if (key in r) r[key]++;
  }
  return r;
}

module.exports = { recordClick, getStats };
