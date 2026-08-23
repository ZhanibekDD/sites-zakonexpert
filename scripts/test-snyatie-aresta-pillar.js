'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PAGE_PATH = path.join(ROOT, 'public', 'snyatie-aresta-so-scheta.html');
const html = fs.readFileSync(PAGE_PATH, 'utf8');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function textContent(source) {
  return source.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

const title = (html.match(/<title>([^<]+)<\/title>/i) || [])[1] || '';
const description = (html.match(/<meta name="description" content="([^"]+)"/i) || [])[1] || '';
const h1 = textContent((html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) || [])[1] || '');
const jsonBlocks = Array.from(html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/gi));

assert(title.startsWith('Снять арест со счёта'), 'Primary query is missing at the start of the title');
assert(title.length <= 60, `Title is too long: ${title.length}`);
assert(description.length >= 120 && description.length <= 170, `Description length is outside the target range: ${description.length}`);
assert(h1.includes('Снять арест со счёта'), 'Primary query is missing from H1');
assert(html.includes('<link rel="canonical" href="https://zakonexpertt.kz/snyatie-aresta-so-scheta">'), 'Canonical URL changed');
assert(html.includes('max-image-preview:large'), 'Large image preview directive is missing');
assert(html.includes('/img/seo-v2/bank-arrest-hero.webp'), 'Hero and social image are missing');
assert(fs.existsSync(path.join(ROOT, 'public', 'img', 'seo-v2', 'bank-arrest-hero.webp')), 'Hero image file does not exist');
assert(html.includes('/css/snyatie-aresta-pillar.css'), 'Pillar page stylesheet is missing');
assert(html.includes('/js/arrest-route.js'), 'Diagnostic script is missing');
assert((html.match(/data-arrest-route=/g) || []).length === 4, 'Diagnostic must offer exactly four routes');
assert((html.match(/<details>/g) || []).length === 7, 'Visible FAQ must contain seven questions');
assert((html.match(/class="zg-bank-tile"/g) || []).length >= 6, 'Bank cluster links are incomplete');

[
  '/arest-scheta-v-bankah-kazahstana',
  '/arest-kaspi',
  '/arest-halyk-bank',
  '/arest-freedom-bank',
  '/otmena-ispolnitelnoi-nadpisi',
  '/snyatie-ogranichenii-chsi',
  '/chsi-ne-snimaet-arest-posle-oplaty',
  '/arest-zarplatnoy-karty',
  '/arest-snyat-no-schet-zablokirovan',
  '/srok-snyatiya-aresta-so-scheta',
  '/neskolko-arestov-na-schete',
  '/marshrut-dolzhnika',
].forEach((href) => assert(html.includes(`href="${href}"`), `Required internal link is missing: ${href}`));

assert(html.includes('https://adilet.zan.kz/rus/docs/Z100000261_'), 'Official law source is missing');
assert(html.includes('статье 118') && html.includes('Статья 47'), 'Legal explanation must reference Articles 47 and 118');
assert(!html.includes('"totalTime"'), 'Fixed HowTo duration must not be published');

[
  /в течение 1[–-]3 рабочих дней/i,
  /от нескольких дней до 2[–-]3 недель/i,
  /снять арест за \d/i,
  /нотариус (?:наложил|накладывает) арест/i,
  /отмена всегда (?:убирает|освобождает)/i,
].forEach((pattern) => assert(!pattern.test(html), `Risky universal claim found: ${pattern}`));

assert(jsonBlocks.length === 1, `Expected one JSON-LD graph, found ${jsonBlocks.length}`);
const graph = JSON.parse(jsonBlocks[0][1]);
const entities = graph['@graph'] || [];
const types = new Set(entities.map((entity) => entity['@type']));
['Article', 'BreadcrumbList', 'HowTo', 'FAQPage'].forEach((type) => assert(types.has(type), `Structured data is missing ${type}`));

const faq = entities.find((entity) => entity['@type'] === 'FAQPage');
assert(faq && faq.mainEntity.length === 7, 'FAQ schema must match the seven visible questions');

console.log('Account-arrest pillar page OK: intent, schema, legal guard, bank cluster and conversion routes.');
