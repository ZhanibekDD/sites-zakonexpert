/**
 * ZakonExpert — News Importer Module
 * Fetches and processes news from RSS feeds
 */
const RSSParser = require('rss-parser');
const slugify = require('slugify');
const db = require('./db');
const sources = require('../config/news_sources.json');

const parser = new RSSParser({
  timeout: 15000,
  headers: {
    'User-Agent': 'ZakonExpert-NewsBot/1.0 (+https://zakonexpertt.kz)',
    'Accept': 'application/rss+xml, application/xml, text/xml'
  },
  customFields: {
    item: [['media:content', 'mediaContent'], ['enclosure', 'enclosure']]
  }
});

const RELEVANT_KEYWORDS = [
  'арест', 'счет', 'должник', 'чси', 'нотариус', 'исполнительн',
  'банк', 'кредит', 'долг', 'ограничение', 'взыскание', 'задолженность',
  'заблокировали', 'карту', 'имущество', 'автомобил', 'регистрационн',
  'судебн', 'финансовый', 'мошенничество', 'антифрод',
  'kaspi', 'halyk', 'freedom', 'займ', 'заем'
];

const CATEGORY_LINKS = {
  laws: [
    { text: 'Отмена исполнительной надписи', url: '/otmena-ispolnitelnoi-nadpisi' },
    { text: 'Возражение на исполнительную надпись', url: '/vozrazhenie-na-ispolnitelnuyu-nadpis' }
  ],
  finance: [
    { text: 'Снятие ареста со счёта', url: '/snyatie-aresta-so-scheta' },
    { text: 'Ограничения ЧСИ', url: '/snyatie-ogranichenii-chsi' }
  ],
  general: [
    { text: 'Снятие ареста со счёта', url: '/snyatie-aresta-so-scheta' },
    { text: 'График оплаты задолженности', url: '/grafik-oplaty-zadolzhennosti' }
  ]
};

function calcRelevance(title, description = '') {
  const text = (title + ' ' + description).toLowerCase();
  let score = 0;
  for (const kw of RELEVANT_KEYWORDS) {
    if (text.includes(kw.toLowerCase())) score += 1;
  }
  return Math.min(score / 4, 1);
}

function isRelevant(title, description, keywords = []) {
  const text = (title + ' ' + (description || '')).toLowerCase();
  const allKw = [...RELEVANT_KEYWORDS, ...keywords.map(k => k.toLowerCase())];
  return allKw.some(kw => text.includes(kw.toLowerCase()));
}

function makeSlug(title, suffix) {
  const base = slugify(title, { lower: true, strict: true, locale: 'ru' });
  return (base || 'news').substring(0, 80) + '-' + suffix;
}

function extractImage(item) {
  if (item.mediaContent?.['$']?.url) return item.mediaContent['$'].url;
  if (item.enclosure?.url) return item.enclosure.url;
  if (item['media:thumbnail']?.['$']?.url) return item['media:thumbnail']['$'].url;
  return null;
}

function generateLegalCommentary(title, description) {
  const text = (title + ' ' + (description || '')).toLowerCase();
  if (text.includes('арест счет') || text.includes('арест на счет') || text.includes('заблокировал')) {
    return 'Если счёт арестован, важно установить основание — исполнительная надпись нотариуса, решение суда или иной документ. От этого зависит дальнейший путь. Мы проверяем основание и готовим документы.';
  }
  if (text.includes('исполнительн надпис') || text.includes('нотариус')) {
    return 'Исполнительная надпись применяется только по бесспорным требованиям. Если есть основания для возражения, можно запустить процедуру отмены. Мы анализируем документы и подаём возражение сами.';
  }
  if (text.includes('чси') || text.includes('исполнительное производство')) {
    return 'При работе с ЧСИ важно проверить законность производства, правильность расчёта расходов и соразмерность мер. Мы помогаем снять необоснованные ограничения.';
  }
  if (text.includes('кредит') || text.includes('банк') || text.includes('kaspi') || text.includes('halyk')) {
    return 'Аресты по кредитным долгам чаще всего связаны с исполнительной надписью нотариуса или решением суда. Важно установить источник взыскания и проверить наличие оснований для оспаривания.';
  }
  return 'Ситуации, связанные с арестами и ограничениями, требуют индивидуального анализа. Важно установить правовое основание и проверить документы.';
}

function detectTags(title, description) {
  const text = (title + ' ' + (description || '')).toLowerCase();
  const tags = [];
  const tagMap = {
    'Kaspi': ['kaspi', 'каспи'],
    'Halyk': ['halyk', 'народный банк', 'халык'],
    'Freedom': ['freedom', 'фридом'],
    'арест счета': ['арест счет', 'заблокировали счет', 'заморожен счет'],
    'ЧСИ': ['чси', 'судебный исполнитель', 'исполнительное производство'],
    'нотариус': ['нотариус', 'исполнительная надпись'],
    'кредит': ['кредит', 'займ', 'заем', 'задолженность'],
    'авто': ['автомобил', 'авто', 'транспортн'],
    'банк': ['банк']
  };
  for (const [tag, patterns] of Object.entries(tagMap)) {
    if (patterns.some(p => text.includes(p))) tags.push(tag);
  }
  return tags;
}

async function fetchSource(source) {
  if (!source.rss_url || !source.enabled) return 0;

  let feed;
  try {
    feed = await parser.parseURL(source.rss_url);
  } catch (err) {
    console.error(`[NewsImporter] Failed to fetch ${source.name}: ${err.message}`);
    return 0;
  }

  let imported = 0;
  const now = new Date().toISOString();

  for (const item of (feed.items || [])) {
    const title = (item.title || '').trim();
    const originalUrl = item.link || item.guid;
    if (!title || !originalUrl) continue;

    if (await db.existsByUrl(originalUrl)) continue;

    const description = (item.contentSnippet || item.content || item.summary || '').substring(0, 500);
    if (!isRelevant(title, description, source.keywords || [])) continue;

    const relevanceScore = calcRelevance(title, description);
    const tags = detectTags(title, description);
    const imageUrl = extractImage(item);
    const legalCommentary = generateLegalCommentary(title, description);
    const status = relevanceScore >= 0.5 ? 'published' : 'draft';

    const slug = makeSlug(title, Date.now() + imported);
    const publishedAt = item.pubDate ? new Date(item.pubDate).toISOString() : now;
    const metaTitle = title.substring(0, 65) + ' | ZakonExpert';
    const metaDescription = description.substring(0, 155) || `Разбор новости: ${title.substring(0, 100)}`;
    const canonicalUrl = `https://zakonexpertt.kz/news/${slug}`;

    const article = {
      title,
      slug,
      source_name: source.name,
      source_url: source.base_url,
      original_url: originalUrl,
      excerpt: description.substring(0, 280),
      ai_summary: description.substring(0, 400),
      legal_commentary: legalCommentary,
      category: source.category,
      tags: JSON.stringify(tags),
      status,
      relevance_score: relevanceScore,
      published_at_source: publishedAt,
      published_at_site: status === 'published' ? now : null,
      meta_title: metaTitle,
      meta_description: metaDescription,
      og_image: imageUrl,
      image_url: imageUrl,
      canonical_url: canonicalUrl,
      created_at: now,
    };

    const result = await db.insertNews(article);
    if (result.changes > 0) imported++;
  }

  return imported;
}

async function importAll() {
  console.log('[NewsImporter] Starting import...');
  let total = 0;
  for (const source of sources) {
    if (!source.enabled) continue;
    const count = await fetchSource(source);
    console.log(`[NewsImporter] ${source.name}: imported ${count} articles`);
    total += count;
    await new Promise(r => setTimeout(r, 2000));
  }
  console.log(`[NewsImporter] Done. Total imported: ${total}`);
  return total;
}

module.exports = { importAll, fetchSource };
