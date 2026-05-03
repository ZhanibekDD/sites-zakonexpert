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
    return 'Если счёт арестован, важно установить основание — исполнительная надпись нотариуса, решение суда или иной документ. От этого зависит дальнейший путь. При исполнительной надписи — можно подать возражение нотариусу в течение 10 рабочих дней. Мы проверяем документы и принимаем меры сами.';
  }
  if (text.includes('исполнительн надпис') || text.includes('нотариус')) {
    return 'Исполнительная надпись применяется только по бесспорным требованиям. Если должник не согласен с суммой, основанием, уведомлением или расчётом — есть основания для анализа. Мы изучаем документы, определяем правовую позицию и подаём возражение сами.';
  }
  if (text.includes('чси') || text.includes('исполнительное производство')) {
    return 'При работе с ЧСИ важно проверить: кем и на каком основании возбуждено производство, правильность расчёта суммы и расходов, соразмерность мер. Незаконные или необоснованные действия ЧСИ можно оспорить. Мы помогаем разобраться с производством и снять излишние ограничения.';
  }
  if (text.includes('кредит') || text.includes('займ') || text.includes('заем') || text.includes('задолженность')) {
    return 'Аресты по кредитным долгам чаще всего появляются через исполнительную надпись нотариуса или решение суда. Важно понять: была ли надпись законной, соответствует ли сумма, получал ли должник уведомление. В ряде случаев есть основания для оспаривания — при наличии спорных обстоятельств.';
  }
  if (text.includes('банк') || text.includes('kaspi') || text.includes('halyk') || text.includes('freedom')) {
    return 'Банк исполняет постановление ЧСИ и самостоятельно снять арест не может. Решение проблемы — через ЧСИ или нотариуса. Сначала нужно установить, кто взыскатель, на каком основании возник арест, и есть ли возможность оспаривания.';
  }
  if (text.includes('мошенни') || text.includes('антифрод') || text.includes('серых') || text.includes('сомнительн')) {
    return 'Деятельность нелегальных кредиторов и мошенников часто приводит к спорным задолженностям, незаконным исполнительным надписям и арестам. Если долг возник из сомнительного договора — стоит проверить законность основания взыскания.';
  }
  return 'Новости в сфере финансов и права напрямую влияют на должников и тех, кто столкнулся с арестами и ограничениями. Важно следить за изменениями законодательства и своевременно реагировать на действия взыскателей и ЧСИ.';
}

function generateWhyImportant(title, description) {
  const text = (title + ' ' + (description || '')).toLowerCase();
  if (text.includes('закон') || text.includes('поправк') || text.includes('изменени')) {
    return 'Изменения в законодательстве могут затронуть процедуру исполнительного производства, права должников и порядок снятия арестов. Следить за актуальными нормами — важно для защиты своих прав.';
  }
  if (text.includes('банк') || text.includes('кредит') || text.includes('займ')) {
    return 'Ситуации с банками и кредиторами — прямой источник арестов счетов. Понимание того, как действуют кредиторы, помогает вовремя среагировать и не допустить блокировки счёта или имущества.';
  }
  if (text.includes('чси') || text.includes('исполнительн')) {
    return 'Действия ЧСИ и исполнительные производства — основная причина арестов счетов, карт, авто и имущества. Знание своих прав в этой ситуации позволяет принимать правильные решения.';
  }
  return 'Понимание актуальных событий в финансово-правовой сфере помогает своевременно защитить свои активы и счета от возможных арестов и ограничений.';
}

function generateHowItAffects(title, description) {
  const text = (title + ' ' + (description || '')).toLowerCase();
  if (text.includes('арест') || text.includes('блокир') || text.includes('заморозили')) {
    return 'Если у вас уже есть арест — эта ситуация может означать, что подобных случаев становится больше. Важно действовать оперативно: установить основание ареста и принять меры до того, как взыскатель заберёт средства.';
  }
  if (text.includes('кредит') || text.includes('банк') || text.includes('займ')) {
    return 'Кредитные споры и задолженности перед банками — частый путь к аресту счетов через исполнительную надпись нотариуса или решение суда. Если у вас есть просроченный долг — стоит проверить наличие ИП по своему ИИН.';
  }
  if (text.includes('закон') || text.includes('норматив')) {
    return 'Изменения в нормативной базе могут как упростить, так и усложнить процедуру снятия ареста. Мы следим за актуальными нормами и применяем только действующие механизмы.';
  }
  return 'Любые изменения в банковской и правовой сфере могут косвенно повлиять на вашу ситуацию с задолженностями и арестами. Полезно знать актуальный контекст, чтобы правильно оценить свои риски.';
}

function generateWhenToSeekHelp(title, description) {
  const text = (title + ' ' + (description || '')).toLowerCase();
  if (text.includes('арест') || text.includes('блокир') || text.includes('счет') || text.includes('карт')) {
    return 'Обратитесь за помощью, если: счёт или карта заблокированы, ЧСИ удерживает деньги, вы не понимаете основания взыскания, сумма долга кажется завышенной, или взыскатель не предоставил уведомления. Мы проверим ситуацию и объясним шаги.';
  }
  if (text.includes('кредит') || text.includes('займ') || text.includes('задолженность')) {
    return 'Обратитесь, если: банк или МФО подали на исполнительную надпись, ЧСИ уже начал производство, с вас взыскивают больше, чем вы ожидали, или есть спор по сумме долга.';
  }
  return 'Если вы видите себя в похожей ситуации — проверьте наличие исполнительных производств по своему ИИН. Раннее обнаружение позволяет принять меры до блокировки счетов и имущества.';
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
    const whyImportant = generateWhyImportant(title, description);
    const howItAffects = generateHowItAffects(title, description);
    const whenToSeekHelp = generateWhenToSeekHelp(title, description);
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
      why_important: whyImportant,
      how_it_affects: howItAffects,
      when_to_seek_help: whenToSeekHelp,
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
