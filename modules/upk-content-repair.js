'use strict';

const { sha256, validateUpkArticles } = require('./upk-source');

function validateSnapshot(snapshot) {
  if (snapshot?.version !== 'upk-content-repair-2026-10-28-v1'
    || snapshot.source?.groupNumber !== 'K1400000231' || snapshot.source.isActual !== true
    || !/^https:\/\/adilet\.zan\.kz\//.test(snapshot.source.url || '')
    || !/^[a-f0-9]{64}$/.test(snapshot.source.htmlSha256 || '')
    || snapshot.articleCount !== snapshot.articles?.length
    || sha256(JSON.stringify(snapshot.articles)) !== snapshot.articlesSha256) {
    throw new Error('UPK snapshot integrity validation failed');
  }
  validateUpkArticles(snapshot.articles);
  return snapshot;
}

// These are the two exact legacy scraper failure signatures observed in the
// production backup. Short valid articles and manually corrected text survive.
function isLegacyCorruption(article) {
  if (article.code !== 'upk' || !/^upk-rk-/.test(article.slug || '')) return false;
  const text = String(article.text || '').trim();
  const heading = text.match(/^Статья\s+(\d+(?:[.-]\d+)?)\.\s+[^\n]+$/);
  if (heading && heading[1] !== String(article.num)) return true;
  return String(article.num) === '674' && text.startsWith('Если Вы обнаружили на странице ошибку,')
    && text.includes('Ctrl+Enter') && text.includes('поиск по странице');
}

async function repairUpkContent(db, snapshot, log = console) {
  // Complete validation precedes the first read/write. A damaged bundle must
  // never produce a partial import or change adjacent codes.
  validateSnapshot(snapshot);
  const rows = await db.find({ code: 'upk' });
  const existing = new Map(rows.map(row => [row.slug, row]));
  let repaired = 0;
  let inserted = 0;
  let preserved = 0;
  for (const article of snapshot.articles) {
    const old = existing.get(article.slug);
    if (old && !isLegacyCorruption(old)) { preserved++; continue; }
    const patch = {
      ...article,
      sourceUrl: `${snapshot.source.url}${article.sourceFragment ? `#${article.sourceFragment}` : ''}`,
      sourceFetchedAt: snapshot.source.fetchedAt,
      sourceHtmlSha256: snapshot.source.htmlSha256,
      contentRepairVersion: snapshot.version,
      contentRepairedAt: new Date(),
      updatedAt: new Date(),
    };
    if (old) {
      // $set keeps _id and unrelated references/metadata. Conditional update
      // also protects a manual edit made after the initial scan.
      const changed = await db.update({ _id: old._id, code: 'upk', text: old.text }, { $set: patch });
      repaired += Number(changed) || 0;
    } else {
      // Never overwrite another code if a malformed record occupies the slug.
      const occupied = await db.findOne({ slug: article.slug });
      if (!occupied) { await db.insert(patch); inserted++; }
    }
  }
  if (repaired || inserted) log.info(`[Laws] UPK repair: repaired=${repaired}, inserted=${inserted}, preserved=${preserved}; source=${snapshot.source.htmlSha256}`);
  return { repaired, inserted, preserved };
}

module.exports = { validateSnapshot, isLegacyCorruption, repairUpkContent };
