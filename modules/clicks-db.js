'use strict';
const Datastore = require('nedb-promises');
const fs = require('fs');
const path = require('path');
const { enableAutocompaction } = require('./db-maintenance');

const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = Datastore.create({
  filename: process.env.CLICKS_DB_PATH || path.join(DATA_DIR, 'clicks.db'),
  autoload: true,
});
enableAutocompaction(db);

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

async function getEventStats(since) {
  const query = since ? { ts: { $gte: since } } : {};
  const clicks = await db.find(query);
  const result = {
    totalEvents: clicks.length,
    companyCtaClicks: 0,
    companyCtaByPosition: {},
  };
  for (const click of clicks) {
    if (click.type !== 'click_cta_company') continue;
    result.companyCtaClicks += 1;
    const position = String(click.cta_position || 'unknown').slice(0, 50);
    result.companyCtaByPosition[position] = (result.companyCtaByPosition[position] || 0) + 1;
  }
  return result;
}

function emptyFunnelBucket() {
  return { pageViews: 0, ctaImpressions: 0, whatsappClicks: 0 };
}

function addToBucket(bucket, type) {
  if (type === 'view_company_page') bucket.pageViews += 1;
  if (type === 'view_company_cta') bucket.ctaImpressions += 1;
  if (type === 'click_cta_company') bucket.whatsappClicks += 1;
}

function roundedRate(numerator, denominator, multiplier = 100) {
  if (!denominator) return null;
  return Math.round((numerator / denominator) * multiplier * 100) / 100;
}

function finishFunnelBucket(bucket) {
  return {
    ...bucket,
    clicksPer1000Views: roundedRate(bucket.whatsappClicks, bucket.pageViews, 1000),
    ctaClickThroughRatePct: roundedRate(bucket.whatsappClicks, bucket.ctaImpressions),
  };
}

function summarizeCompanyFunnel(clicks) {
  const overall = emptyFunnelBucket();
  const pageBuckets = {};
  const segments = {
    byPosition: {},
    byVariant: {},
    byDevice: {},
    byLocale: {},
    byPageType: {},
  };
  let trackedCompanyEvents = 0;

  function addSegment(group, key, type) {
    if (!group[key]) group[key] = emptyFunnelBucket();
    addToBucket(group[key], type);
  }

  for (const click of clicks || []) {
    const type = String(click.type || '');
    if (!['view_company_page', 'view_company_cta', 'click_cta_company'].includes(type)) continue;
    if (click.funnel_version !== 'v2') continue;
    trackedCompanyEvents += 1;
    addToBucket(overall, type);
    addSegment(segments.byVariant, click.offer_variant === 'b' ? 'b' : 'a', type);
    addSegment(segments.byDevice, String(click.device_type || 'unknown').slice(0, 30), type);
    addSegment(segments.byLocale, String(click.page_locale || 'ru').slice(0, 10), type);
    addSegment(segments.byPageType, String(click.page_type || 'other').slice(0, 40), type);
    addSegment(pageBuckets, String(click.page || '/').slice(0, 300), type);

    if (type === 'view_company_cta' || type === 'click_cta_company') {
      addSegment(
        segments.byPosition,
        String(click.cta_position || 'unknown').slice(0, 50),
        type
      );
    }
  }

  const result = { trackedCompanyEvents, ...finishFunnelBucket(overall) };
  for (const [groupName, group] of Object.entries(segments)) {
    result[groupName] = Object.fromEntries(
      Object.entries(group).map(([key, bucket]) => [key, finishFunnelBucket(bucket)])
    );
  }
  result.topPages = Object.entries(pageBuckets)
    .map(([page, bucket]) => ({ page, ...finishFunnelBucket(bucket) }))
    .sort((left, right) => (
      right.whatsappClicks - left.whatsappClicks
      || right.pageViews - left.pageViews
      || left.page.localeCompare(right.page)
    ))
    .slice(0, 20);
  return result;
}

async function getCompanyFunnelStats(since) {
  const query = since ? { ts: { $gte: since } } : {};
  return summarizeCompanyFunnel(await db.find(query));
}

module.exports = {
  getCompanyFunnelStats,
  getEventStats,
  getStats,
  recordClick,
  summarizeCompanyFunnel,
};
