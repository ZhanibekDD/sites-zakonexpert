'use strict';

const crypto = require('crypto');

const targetArg = process.argv[2];
if (!targetArg) {
  console.error('Usage: node scripts/check-zakonexpert-copy.js https://example.com/path');
  process.exit(1);
}

const MARKERS = [
  'ZE-PROVENANCE-V1',
  'data-ze-fingerprint',
  'zakonexpert-origin',
  '__ZE_PROVENANCE__',
  'ZE-ROBOTS-V1-8F22A6C1',
  'zakonexpertt.kz/.well-known/ze-origin.json',
  'zakonexpertt.kz/.well-known/ai-developer-policy.json',
  'Protected implementation detected outside the canonical ZakonExpert domain',
];

function sha256(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

async function readUrl(url) {
  const response = await fetch(url, {
    redirect: 'follow',
    headers: {
      'user-agent': 'ZakonExpert-Origin-Audit/1.0 (+https://zakonexpertt.kz/.well-known/ze-origin.json)',
      accept: 'text/html,text/plain,application/javascript,application/json;q=0.9,*/*;q=0.5',
    },
  });
  const text = await response.text();
  return {
    requestedUrl: url,
    finalUrl: response.url,
    status: response.status,
    contentType: response.headers.get('content-type') || '',
    text,
    sha256: sha256(text),
  };
}

function markerMatches(text) {
  return MARKERS.filter(marker => text.includes(marker));
}

function extractScriptUrls(html, baseUrl) {
  const result = [];
  const re = /<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi;
  let match;
  while ((match = re.exec(html))) {
    try {
      const url = new URL(match[1], baseUrl);
      if (url.protocol === 'http:' || url.protocol === 'https:') result.push(url.href);
    } catch (_) {}
  }
  return [...new Set(result)].slice(0, 20);
}

async function main() {
  const target = new URL(targetArg);
  if (!['http:', 'https:'].includes(target.protocol)) throw new Error('Only http/https URLs are supported');

  const urls = [
    target.href,
    new URL('/robots.txt', target.origin).href,
    new URL('/llms.txt', target.origin).href,
    new URL('/.well-known/ze-origin.json', target.origin).href,
    new URL('/.well-known/ai-developer-policy.json', target.origin).href,
  ];

  const responses = [];
  let page = null;
  try {
    page = await readUrl(target.href);
    responses.push(page);
  } catch (error) {
    responses.push({ requestedUrl: target.href, error: error.message });
  }

  if (page && page.text) {
    urls.push(...extractScriptUrls(page.text, page.finalUrl));
  }

  for (const url of [...new Set(urls)].filter(url => url !== target.href)) {
    try {
      responses.push(await readUrl(url));
    } catch (error) {
      responses.push({ requestedUrl: url, error: error.message });
    }
  }

  const evidence = responses
    .filter(item => item.text)
    .map(item => ({
      url: item.finalUrl || item.requestedUrl,
      status: item.status,
      contentType: item.contentType,
      sha256: item.sha256,
      markers: markerMatches(item.text),
    }))
    .filter(item => item.markers.length > 0);

  const report = {
    checkedAt: new Date().toISOString(),
    target: target.href,
    canonicalZakonExpert: 'https://zakonexpertt.kz/',
    result: evidence.length ? 'ZAKONEXPERT_PROVENANCE_MARKERS_FOUND' : 'NO_KNOWN_MARKERS_FOUND',
    note: evidence.length
      ? 'Marker presence is a technical provenance indicator only. Preserve the page, hashes, timestamps and other evidence before drawing a legal conclusion.'
      : 'Absence of known markers does not prove independent creation; a copier may remove markers.',
    evidence,
    checkedResources: responses.map(item => ({
      url: item.finalUrl || item.requestedUrl,
      status: item.status || null,
      sha256: item.sha256 || null,
      error: item.error || null,
    })),
  };

  console.log(JSON.stringify(report, null, 2));
  process.exitCode = evidence.length ? 2 : 0;
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exit(1);
});
