'use strict';

// Submits every URL currently listed in the site's sitemaps to IndexNow
// (fans out to Yandex, Bing and other participating engines). Google does
// not support IndexNow — this script intentionally does not touch it.
//
// Usage: node scripts/submit-indexnow.js [https://zakonexpertt.kz]

const HOST = 'zakonexpertt.kz';
const KEY = '666b24a135bdeacb4dd7376da5267f9a';
const KEY_LOCATION = `https://${HOST}/${KEY}.txt`;
const BATCH_SIZE = 10000;

async function fetchText(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return res.text();
}

function extractLocs(xml) {
  const matches = xml.matchAll(/<loc>([^<]+)<\/loc>/g);
  return Array.from(matches, m => m[1].trim());
}

async function collectAllUrls(baseUrl) {
  const indexXml = await fetchText(`${baseUrl}/sitemap-index.xml`);
  const childSitemaps = extractLocs(indexXml);
  console.log(`[IndexNow] ${childSitemaps.length} child sitemaps found`);

  const urls = [];
  for (const sitemapUrl of childSitemaps) {
    try {
      const xml = await fetchText(sitemapUrl);
      const locs = extractLocs(xml);
      urls.push(...locs);
      console.log(`[IndexNow] ${sitemapUrl} -> ${locs.length} urls (total ${urls.length})`);
    } catch (error) {
      console.warn(`[IndexNow] skip ${sitemapUrl}: ${error.message}`);
    }
  }
  return urls;
}

async function submitBatch(urlList) {
  const res = await fetch('https://api.indexnow.org/indexnow', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ host: HOST, key: KEY, keyLocation: KEY_LOCATION, urlList }),
  });
  return { status: res.status, ok: res.ok };
}

async function main() {
  const baseUrl = (process.argv[2] || `https://${HOST}`).replace(/\/$/, '');

  const keyCheck = await fetch(KEY_LOCATION).catch(() => null);
  if (!keyCheck || !keyCheck.ok) {
    throw new Error(`Key file not reachable at ${KEY_LOCATION} — deploy it before submitting.`);
  }

  const urls = await collectAllUrls(baseUrl);
  console.log(`[IndexNow] ${urls.length} urls total, submitting in batches of ${BATCH_SIZE}`);

  let submitted = 0;
  for (let i = 0; i < urls.length; i += BATCH_SIZE) {
    const batch = urls.slice(i, i + BATCH_SIZE);
    const result = await submitBatch(batch);
    submitted += batch.length;
    console.log(`[IndexNow] batch ${Math.floor(i / BATCH_SIZE) + 1}: ${result.status} (${submitted}/${urls.length})`);
    if (!result.ok) console.warn('[IndexNow] batch failed, continuing with the rest');
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  console.log(`[IndexNow] Done. Submitted ${submitted} urls.`);
}

if (require.main === module) {
  main().catch(error => {
    console.error('[IndexNow] Failed:', error.message);
    process.exitCode = 1;
  });
}

module.exports = { collectAllUrls, submitBatch };
