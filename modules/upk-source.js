'use strict';

const crypto = require('crypto');
const { parseAdiletArticles, makeSnippet } = require('./adilet-articles');

const LAW = Object.freeze({
  code: 'upk', codeName: 'УПК РК', shortName: 'upk-rk',
  fullName: 'Уголовно-процессуальный кодекс Республики Казахстан',
  url: 'https://adilet.zan.kz/rus/docs/K1400000231',
});
const API_URL = 'https://adilet.zan.kz/api/documents/by-ngr/K1400000231?language=rus';
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');

function validateUpkArticles(articles) {
  if (!Array.isArray(articles) || articles.length < 674) throw new Error('UPK source is incomplete');
  const seen = new Set();
  for (const article of articles) {
    if (article.code !== 'upk' || article.slug !== `upk-rk-${article.num.replace(/\./g, '-')}`
      || seen.has(article.num) || !article.title || !article.text?.trim()) {
      throw new Error('UPK article identity/body validation failed');
    }
    if (/^Статья\s+\d+(?:[.-]\d+)?\./m.test(article.text)) {
      throw new Error(`UPK ${article.num} contains another article heading`);
    }
    seen.add(article.num);
  }
  for (let number = 1; number <= 674; number++) {
    // The current official consolidated text omits the former chapter 50
    // (448–469), with an explicit repeal note before article 470.
    if (number >= 448 && number <= 469) continue;
    if (!seen.has(String(number))) throw new Error(`UPK article ${number} is missing`);
  }
  const a64 = articles.find(a => a.num === '64');
  const a162 = articles.find(a => a.num === '162');
  if (a64.title !== 'Подозреваемый' || !a64.text.startsWith('1. Подозреваемым является лицо:')
    || !a64.text.includes('право') || a64.text.length < 5000
    || a162.title !== 'Порядок наложения ареста на имущество'
    || !a162.text.startsWith('1. При необходимости наложения ареста на имущество')
    || a162.text.length < 2000) {
    throw new Error('UPK 64/162 content validation failed');
  }
  return articles;
}

function parseUpkDocument(document) {
  if (document.group_number !== 'K1400000231' || document.language !== 'rus'
    || document.is_actual !== true || typeof document.text_content !== 'string') {
    throw new Error('Adilet did not return the current Russian UPK document');
  }
  if (!document.text_content.includes('Глава 50 исключена')) throw new Error('UPK chapter 50 source marker missing');
  return validateUpkArticles(parseAdiletArticles(document.text_content, LAW));
}

function buildUpkSnapshot(document, fetchedAt) {
  const articles = parseUpkDocument(document).map(article => ({
    ...article, snippet: makeSnippet(article.text),
  }));
  return {
    version: 'upk-content-repair-2026-10-28-v1',
    source: {
      url: LAW.url, apiUrl: API_URL, fetchedAt,
      documentId: document.id, groupNumber: document.group_number,
      isActual: document.is_actual, status: document.status,
      // Preserve the official API's dates verbatim; they are not fetch dates.
      endDate: document.end_date, sourceUpdatedAt: document.updated_at,
      htmlSha256: sha256(document.text_content),
    },
    articleCount: articles.length,
    articlesSha256: sha256(JSON.stringify(articles)), articles,
  };
}

module.exports = { LAW, API_URL, sha256, validateUpkArticles, parseUpkDocument, buildUpkSnapshot };
