'use strict';

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const cheerio = require('cheerio');
const { BANK_ARREST_PAGES } = require('../modules/bank-arrest-pages');

const ROOT = path.resolve(__dirname, '..');
const OUTPUT_DIR = path.join(ROOT, 'public', 'img', 'banks');
const MANIFEST_PATH = path.join(OUTPUT_DIR, 'manifest.json');
const CONTACT_SHEET_PATH = path.join(ROOT, 'docs', 'bank-logos-contact-sheet.svg');
const SOURCES_PATH = path.join(ROOT, 'docs', 'BANK_LOGO_SOURCES.md');

const DOMAIN_OVERRIDES = Object.freeze({
  'kaspi-bank': 'kaspi.kz',
  'halyk-bank': 'halykbank.kz',
  'freedom-bank': 'bankffin.kz',
  'bank-centercredit': 'bcc.kz',
  'fortebank': 'forte.kz',
  'eurasian-bank': 'eubank.kz',
  'bereke-bank': 'berekebank.kz',
  'alatau-city-bank': 'alataucitybank.kz',
  'bank-rbk': 'bankrbk.kz',
  'home-credit-bank': 'home.kz',
  'nurbank': 'nurbank.kz',
  'otbasy-bank': 'hcsbk.kz',
  'altyn-bank': 'altynbank.kz',
  'vtb-bank': 'vtb-bank.kz',
  'kzi-bank': 'kzibank.kz',
  'bnk-commercial-bank': 'bnkcommercialbank.kz',
  'kmf-bank': 'kmf.kz',
  'shinhan-bank': 'shinhan.kz',
  'bank-of-china': 'boc.kz',
  'icbc-kazakhstan': 'kz.icbc.com.cn',
  'citibank-kazakhstan': 'citigroup.com',
  'adcb-kazakhstan': 'adcb.com',
  'zaman-bank': 'zamanbank.kz',
});

const USER_AGENT = 'ZakonExpertBankLogoCache/1.0 (+https://zakonexpert.kz)';
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function escapeXml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function domainFor(page) {
  if (DOMAIN_OVERRIDES[page.bankSlug]) return DOMAIN_OVERRIDES[page.bankSlug];
  return new URL(page.officialSite).hostname.replace(/^www\./i, '');
}

async function fetchBuffer(url, timeoutMs = 15000) {
  const response = await fetch(url, {
    redirect: 'follow',
    headers: {
      'user-agent': USER_AGENT,
      accept: 'image/avif,image/webp,image/png,image/svg+xml,image/*,*/*;q=0.8',
    },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return {
    buffer: Buffer.from(await response.arrayBuffer()),
    contentType: String(response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase(),
    finalUrl: response.url,
  };
}

function isPng(buffer) {
  return buffer.length >= PNG_SIGNATURE.length && buffer.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE);
}

function weservUrl(sourceUrl) {
  const endpoint = new URL('https://images.weserv.nl/');
  endpoint.searchParams.set('url', sourceUrl.replace(/^https?:\/\//i, ''));
  endpoint.searchParams.set('w', '512');
  endpoint.searchParams.set('h', '256');
  endpoint.searchParams.set('fit', 'contain');
  endpoint.searchParams.set('output', 'png');
  endpoint.searchParams.set('n', '-1');
  return endpoint.toString();
}

function addCandidate(list, url, sourceType, baseUrl) {
  if (!url || /^data:/i.test(url)) return;
  let resolved;
  try {
    resolved = new URL(url, baseUrl).toString();
  } catch (_) {
    return;
  }
  if (!/^https?:\/\//i.test(resolved)) return;
  if (list.some(item => item.url === resolved)) return;
  list.push({ url: resolved, sourceType });
}

async function discoverOfficialCandidates(page) {
  const candidates = [];
  let response;
  try {
    response = await fetch(page.officialSite, {
      redirect: 'follow',
      headers: { 'user-agent': USER_AGENT, accept: 'text/html,application/xhtml+xml' },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return candidates;
  } catch (_) {
    return candidates;
  }

  const html = await response.text();
  const baseUrl = response.url || page.officialSite;
  const $ = cheerio.load(html);

  $('script[type="application/ld+json"]').each((_, node) => {
    const text = $(node).text();
    const matches = [...text.matchAll(/"logo"\s*:\s*(?:\{[^}]*"url"\s*:\s*)?"([^"]+)"/gi)];
    matches.forEach(match => addCandidate(candidates, match[1].replace(/\\\//g, '/'), 'official-jsonld-logo', baseUrl));
  });

  ['meta[property="og:logo"]', 'meta[name="logo"]', 'meta[itemprop="logo"]'].forEach(selector => {
    $(selector).each((_, node) => addCandidate(candidates, $(node).attr('content'), 'official-meta-logo', baseUrl));
  });

  $('img').each((_, node) => {
    const attrs = [
      $(node).attr('src'),
      $(node).attr('data-src'),
      $(node).attr('data-lazy-src'),
      $(node).attr('class'),
      $(node).attr('id'),
      $(node).attr('alt'),
    ].filter(Boolean).join(' ');
    if (!/logo|brand|logotype|логотип/i.test(attrs)) return;
    addCandidate(candidates, $(node).attr('src') || $(node).attr('data-src') || $(node).attr('data-lazy-src'), 'official-html-logo', baseUrl);
  });

  $('link[rel~="apple-touch-icon"], link[rel="icon"], link[rel="shortcut icon"]').each((_, node) => {
    addCandidate(candidates, $(node).attr('href'), 'official-icon', baseUrl);
  });

  return candidates.slice(0, 8);
}

async function tryLogoCandidate(domain, candidate, errors) {
  try {
    const convertedUrl = weservUrl(candidate.url);
    const result = await fetchBuffer(convertedUrl, 18000);
    if (!isPng(result.buffer)) throw new Error(`not PNG (${result.contentType || 'unknown'})`);
    if (result.buffer.length < 900) throw new Error(`image too small (${result.buffer.length} bytes)`);
    if (result.buffer.length > 2_500_000) throw new Error(`image too large (${result.buffer.length} bytes)`);
    return {
      domain,
      buffer: result.buffer,
      sourceUrl: candidate.url,
      sourceType: candidate.sourceType,
      convertedUrl,
    };
  } catch (error) {
    errors.push(`${candidate.sourceType}: ${error.message}`);
    return null;
  }
}

async function downloadLogo(page) {
  const domain = domainFor(page);
  const errors = [];

  const hunter = await tryLogoCandidate(domain, {
    url: `https://logos.hunter.io/${domain}`,
    sourceType: 'hunter-domain-logo',
  }, errors);
  if (hunter) return hunter;

  const official = await discoverOfficialCandidates(page);
  for (const candidate of official) {
    const result = await tryLogoCandidate(domain, candidate, errors);
    if (result) return result;
    await sleep(60);
  }

  const favicon = await tryLogoCandidate(domain, {
    url: `https://www.google.com/s2/favicons?domain_url=https://${domain}&sz=256`,
    sourceType: 'google-domain-icon',
  }, errors);
  if (favicon) return favicon;

  throw new Error(`${page.brand}: no usable logo. ${errors.join(' | ')}`);
}

function buildContactSheet(items) {
  const columns = 4;
  const cellWidth = 300;
  const cellHeight = 150;
  const rows = Math.ceil(items.length / columns);
  const width = columns * cellWidth;
  const height = rows * cellHeight + 64;
  const cells = items.map((item, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const x = column * cellWidth;
    const y = row * cellHeight + 64;
    const data = item.buffer.toString('base64');
    return `
  <g transform="translate(${x},${y})">
    <rect x="10" y="10" width="280" height="130" rx="16" fill="#ffffff" stroke="#dbe4ed"/>
    <image x="38" y="25" width="224" height="72" preserveAspectRatio="xMidYMid meet" href="data:image/png;base64,${data}"/>
    <text x="150" y="118" text-anchor="middle" font-family="Arial, sans-serif" font-size="14" font-weight="700" fill="#071426">${escapeXml(item.brand)}</text>
    <text x="150" y="135" text-anchor="middle" font-family="Arial, sans-serif" font-size="10" fill="#66788c">${escapeXml(item.domain)}</text>
  </g>`;
  }).join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="100%" height="100%" fill="#f3f6f9"/>
  <text x="24" y="38" font-family="Arial, sans-serif" font-size="24" font-weight="700" fill="#071426">ZakonExpert — bank logos QA sheet</text>${cells}
</svg>
`;
}

async function main() {
  await fsp.mkdir(OUTPUT_DIR, { recursive: true });
  await fsp.mkdir(path.dirname(CONTACT_SHEET_PATH), { recursive: true });

  const results = [];
  for (const page of BANK_ARREST_PAGES) {
    process.stdout.write(`Fetching ${page.brand}... `);
    const result = await downloadLogo(page);
    const fileName = `${page.bankSlug}.png`;
    const filePath = path.join(OUTPUT_DIR, fileName);
    await fsp.writeFile(filePath, result.buffer);
    const item = {
      slug: page.bankSlug,
      brand: page.brand,
      domain: result.domain,
      path: `/img/banks/${fileName}`,
      sourceType: result.sourceType,
      sourceUrl: result.sourceUrl,
      sha256: sha256(result.buffer),
      bytes: result.buffer.length,
      buffer: result.buffer,
    };
    results.push(item);
    console.log(`${result.sourceType}, ${item.bytes} bytes`);
    await sleep(80);
  }

  const duplicates = new Map();
  results.forEach(item => {
    const list = duplicates.get(item.sha256) || [];
    list.push(item.brand);
    duplicates.set(item.sha256, list);
  });
  const duplicateGroups = [...duplicates.values()].filter(group => group.length > 1);
  if (duplicateGroups.length) {
    throw new Error(`Duplicate logo images detected: ${duplicateGroups.map(group => group.join(', ')).join(' | ')}`);
  }

  const manifest = {
    generatedAt: new Date().toISOString(),
    generator: 'scripts/fetch-bank-logos.js',
    note: 'Bank names and logos are trademarks of their respective owners. Local copies are used for identification in the ZakonExpert directory.',
    count: results.length,
    logos: results.map(({ buffer, ...item }) => item),
  };
  await fsp.writeFile(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  await fsp.writeFile(CONTACT_SHEET_PATH, buildContactSheet(results), 'utf8');

  const sourceRows = results.map(item => `| ${item.brand} | ${item.domain} | ${item.sourceType} | ${item.sourceUrl} | \`${item.sha256.slice(0, 16)}…\` |`).join('\n');
  await fsp.writeFile(SOURCES_PATH, `# Bank logo sources\n\nGenerated: ${manifest.generatedAt}\n\nThe logos are displayed only to identify the corresponding banks. All names and trademarks belong to their respective owners. ZakonExpert is independent from the listed banks.\n\n| Bank | Official domain | Retrieval method | Source URL | SHA-256 |\n|---|---|---|---|---|\n${sourceRows}\n`, 'utf8');

  console.log(`Saved ${results.length} local PNG logos, manifest and QA contact sheet.`);
}

main().catch(error => {
  console.error(error.stack || error.message || error);
  process.exit(1);
});
