'use strict';

// Submits changed/high-priority URLs to IndexNow. A full 800k+ submission is
// deliberately opt-in with --all; repeatedly resending the whole registry
// wastes crawl capacity and hides failed batches.
// (fans out to Yandex, Bing and other participating engines). Google does
// not support IndexNow — this script intentionally does not touch it.
//
// Usage:
//   node scripts/submit-indexnow.js                         # pages + news
//   node scripts/submit-indexnow.js --sitemap=sitemap-laws.xml
//   node scripts/submit-indexnow.js --all                  # exceptional full run

const HOST = 'zakonexpertt.kz';
const KEY = '666b24a135bdeacb4dd7376da5267f9a';
const KEY_LOCATION = `https://${HOST}/${KEY}.txt`;
const BATCH_SIZE = 10000;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchText(url, attempts = 3) {
  let lastError;
  for (let i = 1; i <= attempts; i++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
      return await res.text();
    } catch (error) {
      lastError = error;
      if (i < attempts) await sleep(2000 * i);
    }
  }
  throw lastError;
}

function extractLocs(xml) {
  const matches = xml.matchAll(/<loc>([^<]+)<\/loc>/g);
  return Array.from(matches, m => m[1].trim());
}

function parseArgs(argv = process.argv.slice(2)) {
  const baseUrl = (argv.find(arg => /^https?:\/\//i.test(arg)) || `https://${HOST}`).replace(/\/$/, '');
  const sitemap = argv.find(arg => arg.startsWith('--sitemap='))?.slice('--sitemap='.length) || '';
  return { baseUrl, all: argv.includes('--all'), sitemap };
}

async function collectAllUrls(baseUrl, options = {}) {
  const indexXml = await fetchText(`${baseUrl}/sitemap-index.xml`);
  const allChildSitemaps = extractLocs(indexXml);
  let childSitemaps = allChildSitemaps;
  if (options.sitemap) {
    childSitemaps = allChildSitemaps.filter(url => url.endsWith('/' + options.sitemap.replace(/^\//, '')));
    if (!childSitemaps.length) throw new Error(`Sitemap not found in index: ${options.sitemap}`);
  } else if (!options.all) {
    childSitemaps = allChildSitemaps.filter(url => /\/sitemap-(?:pages|news)\.xml$/.test(url));
  }
  console.log(`[IndexNow] ${allChildSitemaps.length} child sitemaps found; ${childSitemaps.length} selected`);

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
    await sleep(300);
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
  const options = parseArgs();
  const { baseUrl } = options;

  const keyCheck = await fetch(KEY_LOCATION).catch(() => null);
  if (!keyCheck || !keyCheck.ok) {
    throw new Error(`Key file not reachable at ${KEY_LOCATION} — deploy it before submitting.`);
  }

  const urls = [...new Set(await collectAllUrls(baseUrl, options))];
  console.log(`[IndexNow] ${urls.length} urls total, submitting in batches of ${BATCH_SIZE}`);

  let attempted = 0;
  let accepted = 0;
  let failed = 0;
  for (let i = 0; i < urls.length; i += BATCH_SIZE) {
    const batch = urls.slice(i, i + BATCH_SIZE);
    const result = await submitBatch(batch);
    attempted += batch.length;
    if (result.ok) accepted += batch.length;
    else failed += batch.length;
    console.log(`[IndexNow] batch ${Math.floor(i / BATCH_SIZE) + 1}: ${result.status} (${attempted}/${urls.length})`);
    if (!result.ok) console.warn(`[IndexNow] batch rejected: HTTP ${result.status}`);
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  console.log(`[IndexNow] Done. Accepted: ${accepted}; failed: ${failed}; attempted: ${attempted}.`);
  if (failed) throw new Error(`${failed} URLs were not accepted by IndexNow`);
}

if (require.main === module) {
  main().catch(error => {
    console.error('[IndexNow] Failed:', error.message);
    process.exitCode = 1;
  });
}

module.exports = { collectAllUrls, parseArgs, submitBatch };
