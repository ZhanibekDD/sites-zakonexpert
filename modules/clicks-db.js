'use strict';
const Datastore = require('nedb-promises');
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = Datastore.create({
  filename: path.join(DATA_DIR, 'clicks.db'),
  autoload: true,
});

const MAX_FIELD_LEN = 300;
function clip(v) {
  if (typeof v !== 'string') return v;
  return v.length > MAX_FIELD_LEN ? v.slice(0, MAX_FIELD_LEN) : v;
}

async function recordClick({ type, target, page, ip, ua, ...extra }) {
  const safeExtra = {};
  for (const [k, v] of Object.entries(extra)) safeExtra[k] = clip(v);
  return db.insert({
    type: clip(type), target: clip(target), page: clip(page),
    ip: clip(ip), ua: clip(ua), ts: Date.now(), ...safeExtra,
  });
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
    const t = (c.type === 'whatsapp') ? 'wa' : c.type;
    const key = `${t}_${c.target}`;
    if (key in r) r[key]++;
  }
  return r;
}

module.exports = { recordClick, getStats };
