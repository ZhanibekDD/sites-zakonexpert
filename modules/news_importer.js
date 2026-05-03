/**
 * ZakonExpert — News Importer Module
 * Fetches RSS feeds, scrapes full article content, stores in NeDB
 */
const RSSParser = require('rss-parser');
const slugify = require('slugify');
const axios = require('axios');
const cheerio = require('cheerio');
const db = require('./db');
const sources = require('../config/news_sources.json');

const parser = new RSSParser({
  timeout: 15000,
  headers: {
    'User-Agent': 'Mozilla/5.0 (compatible; ZakonExpert-NewsBot/1.0; +https://zakonexpertt.kz)',
    'Accept': 'application/rss+xml, application/xml, text/xml'
  },
  customFields: {
    item: [['media:content', 'mediaContent'], ['enclosure', 'enclosure'], ['media:thumbnail', 'mediaThumbnail']]
  }
});

// Generic + per-source fallback selectors for article body
const GENERIC_SELECTORS = [
  '[itemprop="articleBody"]',
  '.article-body', '.article__body', '.article-text', '.article__text',
  '.article-content', '.article__content',
  '.content-text', '.content-article',
  '.entry-content', '.post-content',
  '.field-body', '.material-text',
  'article .content', 'article p'
];

const RELEVANT_KEYWORDS = [
  'арест', 'счет', 'должник', 'чси', 'нотариус', 'исполнительн',
  'банк', 'кредит', 'долг', 'ограничение', 'взыскание', 'задолженность',
  'заблокировали', 'карту', 'карт', 'имущество', 'автомобил',
  'судебн', 'финансов', 'мошенничество', 'антифрод',
  'kaspi', 'halyk', 'freedom', 'займ', 'заем', 'рассрочк', 'штраф'
];

function calcRelevance(title, description = '') {
  const text = (title + ' ' + description).toLowerCase();
  let score = 0;
  for (const kw of RELEVANT_KEYWORDS) {
    if (text.includes(kw.toLowerCase())) score += 1;
  }
  return Math.min(score / 3, 1);
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

function extractImageFromRss(item) {
  if (item.mediaContent?.['$']?.url) return item.mediaContent['$'].url;
  if (item.mediaThumbnail?.['$']?.url) return item.mediaThumbnail['$'].url;
  if (item.enclosure?.url) return item.enclosure.url;
  if (item['media:thumbnail']?.['$']?.url) return item['media:thumbnail']['$'].url;
  return null;
}

/**
 * Fetch full article text and og:image from source URL using cheerio.
 * Returns { fullText, ogImage }.
 */
async function fetchFullContent(url, sourceSelectors = []) {
  try {
    const resp = await axios.get(url, {
      timeout: 12000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'ru-RU,ru;q=0.9,en;q=0.5',
      },
      maxRedirects: 5,
    });

    const $ = cheerio.load(resp.data);

    // Remove noise elements
    $('script, style, nav, header, footer, .sidebar, .ads, .advertisement, .social-share, .comments, .related, iframe, noscript').remove();

    // Extract og:image
    const ogImage = $('meta[property="og:image"]').attr('content') || null;

    // Try selectors in order: source-specific first, then generic
    const allSelectors = [...(sourceSelectors || []), ...GENERIC_SELECTORS];
    let fullText = '';

    for (const sel of allSelectors) {
      const el = $(sel).first();
      if (el.length) {
        // Extract text from all paragraphs inside
        const paragraphs = [];
        el.find('p, li, h2, h3, h4, blockquote').each((i, node) => {
          const t = $(node).text().trim();
          if (t.length > 40) paragraphs.push(t);
        });
        if (paragraphs.length === 0) {
          const t = el.text().trim().replace(/\s+/g, ' ');
          if (t.length > 100) paragraphs.push(t);
        }
        if (paragraphs.length > 0) {
          fullText = paragraphs.join('\n\n');
          break;
        }
      }
    }

    // Fallback: collect all meaningful <p> from page
    if (!fullText || fullText.length < 200) {
      const paragraphs = [];
      $('p').each((i, el) => {
        const t = $(el).text().trim();
        if (t.length > 60) paragraphs.push(t);
      });
      if (paragraphs.length > 0) fullText = paragraphs.join('\n\n');
    }

    // Limit to ~6000 chars
    fullText = fullText.substring(0, 6000).trim();

    return { fullText: fullText || null, ogImage };
  } catch (err) {
    return { fullText: null, ogImage: null };
  }
}

function detectTags(title, description) {
  const text = (title + ' ' + (description || '')).toLowerCase();
  const tags = [];
  const tagMap = {
    'Kaspi': ['kaspi', 'каспи'],
    'Halyk': ['halyk', 'народный банк', 'халык'],
    'Freedom': ['freedom', 'фридом'],
    'арест счета': ['арест счет', 'заблокировали счет', 'заморожен счет', 'арест карт'],
    'ЧСИ': ['чси', 'судебный исполнитель', 'исполнительное производство'],
    'нотариус': ['нотариус', 'исполнительная надпись'],
    'кредит': ['кредит', 'займ', 'заем', 'задолженность', 'мфо'],
    'авто': ['автомобил', 'авто', 'транспортн'],
    'банк': ['банк'],
    'штраф': ['штраф', 'административн'],
    'алименты': ['алимент']
  };
  for (const [tag, patterns] of Object.entries(tagMap)) {
    if (patterns.some(p => text.includes(p))) tags.push(tag);
  }
  return tags;
}

function generateLegalCommentary(title, description, fullText) {
  const text = (title + ' ' + (description || '') + ' ' + (fullText || '')).toLowerCase().substring(0, 1500);
  if (text.includes('арест счет') || text.includes('арест на счет') || text.includes('заблокировал') || text.includes('арест карт')) {
    return 'Арест счёта или карты появляется на основании исполнительного документа, который ЧСИ направляет в банк. Банк обязан исполнить постановление, поэтому звонить в банк с просьбой "снять арест" бесполезно. Нужно работать с источником: если это исполнительная надпись нотариуса — можно подать возражение в течение 10 рабочих дней. Если решение суда — рассматриваются другие механизмы (апелляция, восстановление срока, рассрочка). Мы проверяем основание, устанавливаем путь и действуем.';
  }
  if (text.includes('исполнительн надпис') || text.includes('нотариус') || text.includes('нотариальн')) {
    return 'Исполнительная надпись — это нотариальный документ, который может быть использован для взыскания только при наличии бесспорного долга. Если долг спорный (должник не согласен с суммой, процентами, фактом договора или уведомлением), есть основания для анализа. Должник вправе направить возражение нотариусу. Нотариус обязан рассмотреть его в течение 3 рабочих дней. При отмене надписи — основание для исполнительного производства отпадает. Мы анализируем документы и ведём процедуру.';
  }
  if (text.includes('чси') || text.includes('исполнительное производство') || text.includes('судебный исполнитель')) {
    return 'ЧСИ действует на основании исполнительного документа. Должник вправе знать: номер исполнительного производства, основание взыскания, размер суммы и расходов. Если документы переданы с нарушениями, сумма завышена или основание оспаривается — возможно оспаривание действий ЧСИ. Мы помогаем проверить производство, рассчитать законную сумму и снять излишние меры.';
  }
  if (text.includes('кредит') || text.includes('займ') || text.includes('заем') || text.includes('задолженность') || text.includes('мфо')) {
    return 'Кредитные долги перед банками и МФО — самая частая причина арестов счетов в Казахстане. Взыскание обычно проходит через исполнительную надпись нотариуса (внесудебный путь) или решение суда. При исполнительной надписи ключевой вопрос — бесспорность требования. Если должник не получал уведомление, не согласен с суммой или расчётом процентов — есть основания для возражения. Мы устанавливаем тип документа и определяем правовую позицию.';
  }
  if (text.includes('мошенни') || text.includes('серых') || text.includes('сомнительн') || text.includes('нелегальн')) {
    return 'Долги перед нелегальными или сомнительными кредиторами нередко оформляются через исполнительную надпись нотариуса на основании договора займа. При этом условия договора, проценты и комиссии могут не соответствовать законодательству. Если долг возник из такого договора — стоит проверить: соответствует ли он требованиям закона, правильно ли рассчитана сумма, было ли надлежащее уведомление.';
  }
  if (text.includes('банк') || text.includes('kaspi') || text.includes('halyk') || text.includes('freedom')) {
    return 'Крупные банки (Kaspi, Halyk, Freedom и другие) используют механизм исполнительной надписи нотариуса или обращаются в суд для взыскания задолженностей. При исполнительной надписи — должник вправе подать возражение в течение 10 рабочих дней. Ключевой вопрос: бесспорно ли требование банка? Если есть спор по сумме, уведомлению или расчёту — есть основания для анализа.';
  }
  return 'Финансовые новости напрямую связаны с правами должников и механизмами взыскания. Каждое изменение в банковском или правовом поле влияет на то, каким путём пойдёт взыскание и какие инструменты защиты доступны должнику. Мы следим за актуальной практикой и применяем только действующие правовые механизмы.';
}

function generateWhyImportant(title, description, fullText) {
  const text = (title + ' ' + (description || '') + ' ' + (fullText || '')).toLowerCase().substring(0, 1000);
  if (text.includes('закон') || text.includes('поправк') || text.includes('изменени') || text.includes('приняли') || text.includes('вступил')) {
    return 'Изменения в законодательстве могут напрямую затронуть процедуру исполнительного производства, права должников, порядок совершения исполнительных надписей и снятия арестов. Это важно знать, чтобы своевременно использовать новые механизмы защиты или не упустить сроки.';
  }
  if (text.includes('банк') || text.includes('кредит') || text.includes('займ') || text.includes('мфо')) {
    return 'Действия банков и МФО — основной источник арестов счетов через исполнительную надпись нотариуса или судебный порядок. Понимание того, как ведут себя кредиторы на рынке, помогает не допустить неожиданной блокировки счета и своевременно отреагировать.';
  }
  if (text.includes('чси') || text.includes('исполнительн')) {
    return 'ЧСИ — ключевое звено в цепочке взыскания. Именно ЧСИ блокирует счета, накладывает запреты на авто и имущество. Знание того, как работает эта система, позволяет должнику понять свои права и не терять время на неэффективные действия.';
  }
  if (text.includes('мошенни') || text.includes('серых') || text.includes('обман') || text.includes('нелегальн')) {
    return 'Рост числа нелегальных кредиторов и мошеннических схем напрямую связан с появлением незаконных и спорных долгов. Такие долги нередко становятся основой для исполнительных надписей, которые можно оспорить. Важно уметь распознать подобные ситуации.';
  }
  return 'Понимание актуальных событий в финансово-правовой сфере Казахстана помогает своевременно защитить свои счета, карты и имущество от арестов и ограничений. Должник, который знает свои права — защищённый должник.';
}

function generateWhenToSeekHelp(title, description, fullText) {
  const text = (title + ' ' + (description || '') + ' ' + (fullText || '')).toLowerCase().substring(0, 800);
  if (text.includes('арест') || text.includes('блокир') || text.includes('счет') || text.includes('карт')) {
    return 'Обратитесь за анализом, если: счёт или карта внезапно заблокированы; пришло уведомление от ЧСИ; вы не понимаете, на каком основании наложен арест; сумма взыскания кажется завышенной; взыскатель — банк или МФО, с которым есть спор по расчётам.';
  }
  if (text.includes('кредит') || text.includes('займ') || text.includes('задолженность') || text.includes('мфо')) {
    return 'Обратитесь за анализом, если: банк или МФО грозит подать документы нотариусу; исполнительное производство уже возбуждено; с вас требуют сумму больше, чем вы брали; вы не получали уведомлений, но деньги исчезают со счёта.';
  }
  if (text.includes('мошенни') || text.includes('серых') || text.includes('нелегальн')) {
    return 'Обратитесь за анализом, если: вы брали займ в небольшой компании или у частного лица и теперь с вас взыскивают через нотариуса или ЧСИ; сумма взыскания вас удивляет; в договоре были непонятные условия.';
  }
  return 'Обратитесь за анализом, если вы узнали себя в описанной ситуации — проверьте наличие исполнительных производств по своему ИИН. Большинство арестов выявляются именно так, ещё до того как деньги списаны.';
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

    const rssDescription = (item.contentSnippet || item.content || item.summary || '').replace(/<[^>]+>/g, '').trim().substring(0, 600);
    if (!isRelevant(title, rssDescription, source.keywords || [])) continue;

    // --- Fetch full article content ---
    console.log(`[NewsImporter] Fetching full content: ${originalUrl}`);
    const { fullText, ogImage: scrapedImage } = await fetchFullContent(originalUrl, source.content_selectors || []);
    await new Promise(r => setTimeout(r, 800)); // polite delay

    // Use scraped content or fall back to RSS description
    const articleContent = fullText && fullText.length > 200 ? fullText : rssDescription;

    // Extract first paragraph as excerpt
    const firstParagraph = articleContent.split('\n\n')[0] || rssDescription;
    const excerpt = firstParagraph.substring(0, 350).trim();

    const rssImage = extractImageFromRss(item);
    const imageUrl = rssImage || scrapedImage || null;

    const relevanceScore = calcRelevance(title, articleContent);
    const tags = detectTags(title, articleContent);
    const legalCommentary = generateLegalCommentary(title, rssDescription, fullText);
    const whyImportant = generateWhyImportant(title, rssDescription, fullText);
    const whenToSeekHelp = generateWhenToSeekHelp(title, rssDescription, fullText);
    const status = relevanceScore >= 0.25 ? 'published' : 'draft';

    const slug = makeSlug(title, Date.now() + imported);
    const publishedAt = item.pubDate ? new Date(item.pubDate).toISOString() : now;
    const metaTitle = title.substring(0, 65) + ' | ZakonExpert';
    const metaDesc = excerpt.substring(0, 155) || `Разбор новости: ${title.substring(0, 100)}`;
    const canonicalUrl = `https://zakonexpertt.kz/news/${slug}`;

    const article = {
      title,
      slug,
      source_name: source.name,
      source_url: source.base_url,
      original_url: originalUrl,
      excerpt,
      full_content: articleContent,
      ai_summary: rssDescription.substring(0, 500),
      legal_commentary: legalCommentary,
      why_important: whyImportant,
      when_to_seek_help: whenToSeekHelp,
      category: source.category,
      tags: JSON.stringify(tags),
      status,
      relevance_score: relevanceScore,
      published_at_source: publishedAt,
      published_at_site: status === 'published' ? now : null,
      meta_title: metaTitle,
      meta_description: metaDesc,
      og_image: imageUrl,
      image_url: imageUrl,
      canonical_url: canonicalUrl,
      created_at: now,
    };

    const result = await db.insertNews(article);
    if (result.changes > 0) {
      imported++;
      console.log(`[NewsImporter] Saved: "${title.substring(0, 60)}" (${articleContent.length} chars)`);
    }
  }

  return imported;
}

async function importAll() {
  console.log('[NewsImporter] Starting import at ' + new Date().toLocaleString('ru-RU'));
  let total = 0;
  for (const source of sources) {
    if (!source.enabled) continue;
    const count = await fetchSource(source);
    console.log(`[NewsImporter] ${source.name}: imported ${count} articles`);
    total += count;
    await new Promise(r => setTimeout(r, 3000)); // pause between sources
  }
  console.log(`[NewsImporter] Done. Total imported: ${total}`);
  return total;
}

module.exports = { importAll, fetchSource };
