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

// Relevance keywords — if article contains these, it's relevant
const RELEVANT_KEYWORDS = [
  'арест', 'счет', 'должник', 'чси', 'нотариус', 'исполнительн',
  'банк', 'кредит', 'долг', 'ограничение', 'взыскание', 'задолженность',
  'касательно долгов', 'заблокировали', 'карту', 'имущество',
  'автомобил', 'регистрационн', 'судебн', 'финансовый', 'деньги',
  'мошенничество', 'антифрод', 'kaspi', 'halyk', 'freedom',
  'исполнительное производство', 'нотариальн', 'заем', 'займ'
];

// Category → service page mapping for internal links
const CATEGORY_LINKS = {
  laws: [
    { text: 'Отмена исполнительной надписи', url: '/otmena-ispolnitelnoi-nadpisi' },
    { text: 'Возражение на исполнительную надпись', url: '/vozrazhenie-na-ispolnitelnuyu-nadpis' }
  ],
  finance: [
    { text: 'Снятие ареста со счёта', url: '/snyatie-aresta-so-scheta' },
    { text: 'Ограничения ЧСИ', url: '/snyatie-ogranichenii-chsi' }
  ],
  news: [
    { text: 'Снятие ареста со счёта', url: '/snyatie-aresta-so-scheta' },
    { text: 'Снятие ограничений ЧСИ', url: '/snyatie-ogranichenii-chsi' }
  ],
  general: [
    { text: 'Снятие ареста со счёта', url: '/snyatie-aresta-so-scheta' },
    { text: 'График оплаты задолженности', url: '/grafik-oplaty-zadolzhennosti' }
  ]
};

/**
 * Calculate relevance score (0–1)
 */
function calcRelevance(title, description = '') {
  const text = (title + ' ' + description).toLowerCase();
  let score = 0;
  for (const kw of RELEVANT_KEYWORDS) {
    if (text.includes(kw.toLowerCase())) score += 1;
  }
  return Math.min(score / 4, 1);
}

/**
 * Check if article is relevant enough to import
 */
function isRelevant(title, description, keywords = []) {
  const text = (title + ' ' + (description || '')).toLowerCase();
  const allKw = [...RELEVANT_KEYWORDS, ...keywords.map(k => k.toLowerCase())];
  return allKw.some(kw => text.includes(kw.toLowerCase()));
}

/**
 * Generate unique slug
 */
function makeSlug(title, id) {
  const base = slugify(title, { lower: true, strict: true, locale: 'ru' });
  const short = base.substring(0, 80);
  return short + '-' + id;
}

/**
 * Extract image URL from RSS item
 */
function extractImage(item) {
  if (item.mediaContent?.['$']?.url) return item.mediaContent['$'].url;
  if (item.enclosure?.url) return item.enclosure.url;
  if (item['media:thumbnail']?.['$']?.url) return item['media:thumbnail']['$'].url;
  return null;
}

/**
 * Generate legal commentary based on article content
 */
function generateLegalCommentary(title, description, category) {
  const text = (title + ' ' + (description || '')).toLowerCase();

  if (text.includes('арест счет') || text.includes('арест на счет') || text.includes('заблокировал')) {
    return 'Если счёт арестован, важно установить, на каком основании — исполнительная надпись нотариуса, решение суда или иной документ. От этого зависит дальнейший путь. Мы проверяем основание и готовим документы.';
  }
  if (text.includes('исполнительн надпис') || text.includes('нотариус') || text.includes('исполнительной надписи')) {
    return 'Исполнительная надпись применяется только по бесспорным требованиям. Если есть основания для возражения, можно запустить процедуру отмены. Мы анализируем документы и подаём возражение сами.';
  }
  if (text.includes('чси') || text.includes('судебн исполн') || text.includes('исполнительное производство')) {
    return 'При работе с ЧСИ важно проверить законность исполнительного производства, правильность расчёта расходов и соразмерность мер. Мы помогаем снять необоснованные ограничения.';
  }
  if (text.includes('кредит') || text.includes('банк') || text.includes('kaspi') || text.includes('halyk')) {
    return 'Аресты по кредитным долгам чаще всего связаны с исполнительной надписью нотариуса или решением суда. Важно установить источник взыскания и проверить наличие оснований для оспаривания.';
  }
  if (text.includes('автомобил') || text.includes('авто') || text.includes('регистрационн')) {
    return 'Запрет регистрационных действий на авто или имущество — мера ЧСИ по исполнительному производству. Снятие возможно при отмене основания или погашении долга. Мы анализируем ситуацию и принимаем меры.';
  }
  return 'Ситуации, связанные с арестами и ограничениями, требуют индивидуального анализа. Прежде чем принимать решения, важно установить правовое основание и проверить документы.';
}

/**
 * Generate "What to check for yourself" block
 */
function generateWhatToCheck(title, description) {
  const text = (title + ' ' + (description || '')).toLowerCase();
  const checks = [];

  if (text.includes('банк') || text.includes('счет') || text.includes('карт')) {
    checks.push('Проверьте по ИИН — есть ли активные исполнительные производства');
    checks.push('Уточните в банке, кем именно был наложен арест (ЧСИ, налоговая, суд)');
  }
  if (text.includes('кредит') || text.includes('долг') || text.includes('задолженность')) {
    checks.push('Проверьте, есть ли исполнительная надпись нотариуса по вашему договору');
    checks.push('Сверьте сумму задолженности с расчётом кредитора');
  }
  if (text.includes('авто') || text.includes('автомобил') || text.includes('имущество')) {
    checks.push('Проверьте наличие запрета регистрационных действий через базу данных ТС');
    checks.push('Установите, по какому исполнительному производству наложено ограничение');
  }
  if (checks.length === 0) {
    checks.push('Проверьте наличие исполнительных производств по своему ИИН');
    checks.push('Уточните, нет ли ограничений на счета, авто или имущество');
  }
  return checks;
}

/**
 * Detect tags from article content
 */
function detectTags(title, description) {
  const text = (title + ' ' + (description || '')).toLowerCase();
  const tags = [];
  const tagMap = {
    'Kaspi': ['kaspi', 'каспи'],
    'Halyk': ['halyk', 'народный банк', 'халык'],
    'Freedom': ['freedom', 'фридом'],
    'арест счета': ['арест счет', 'заблокировали счет', 'заморожен счет'],
    'ЧСИ': ['чси', 'судебный исполнитель', 'исполнительное производство'],
    'нотариус': ['нотариус', 'исполнительная надпись', 'нотариальн'],
    'кредит': ['кредит', 'займ', 'заем', 'долг', 'задолженность'],
    'авто': ['автомобил', 'авто', 'транспортн'],
    'имущество': ['имущество', 'недвижим'],
    'банк': ['банк']
  };
  for (const [tag, patterns] of Object.entries(tagMap)) {
    if (patterns.some(p => text.includes(p))) tags.push(tag);
  }
  return tags;
}

/**
 * Fetch and import news from a single RSS source
 */
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

    // Skip if already exists
    if (db.existsByUrl(originalUrl)) continue;

    const description = (item.contentSnippet || item.content || item.summary || '').substring(0, 500);

    // Check relevance
    if (!isRelevant(title, description, source.keywords || [])) continue;

    const relevanceScore = calcRelevance(title, description);
    const tags = detectTags(title, description);
    const imageUrl = extractImage(item);
    const legalCommentary = generateLegalCommentary(title, description, source.category);
    const whatToCheck = generateWhatToCheck(title, description);

    // Auto-determine status based on relevance
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
      canonical_url: canonicalUrl
    };

    const result = db.insertNews(article);
    if (result.changes > 0) imported++;
  }

  return imported;
}

/**
 * Run full import from all enabled sources
 */
async function importAll() {
  console.log('[NewsImporter] Starting import...');
  let total = 0;
  for (const source of sources) {
    if (!source.enabled) continue;
    const count = await fetchSource(source);
    console.log(`[NewsImporter] ${source.name}: imported ${count} articles`);
    total += count;
    // Rate limiting — wait between sources
    await new Promise(r => setTimeout(r, 2000));
  }
  console.log(`[NewsImporter] Done. Total imported: ${total}`);
  return total;
}

module.exports = { importAll, fetchSource };
