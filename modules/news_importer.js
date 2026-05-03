/**
 * ZakonExpert — News Importer Module v2
 *
 * Philosophy: Use news as an INFORMATION OCCASION, not a copy.
 * RSS gives us title, date, excerpt, link.
 * We generate our own unique legal analysis — never publishing full copied text.
 */
'use strict';

const RSSParser = require('rss-parser');
const slugify = require('slugify');
const axios = require('axios');
const cheerio = require('cheerio');
const db = require('./db');
const sources = require('../config/news_sources.json');

// ─── ENV CONFIG ───────────────────────────────────────────────────────────────
const AUTO_PUBLISH     = process.env.AUTO_PUBLISH_NEWS !== 'false';
const MIN_RELEVANCE    = parseFloat(process.env.NEWS_MIN_RELEVANCE  || '0.55');
const IMPORT_LIMIT     = parseInt(process.env.NEWS_IMPORT_LIMIT     || '20', 10);
const USE_SOURCE_IMG   = process.env.NEWS_USE_SOURCE_IMAGES === 'true';

// ─── RSS PARSER ───────────────────────────────────────────────────────────────
const parser = new RSSParser({
  timeout: 12000,
  headers: {
    'User-Agent': 'Mozilla/5.0 (compatible; ZakonExpert-NewsBot/1.0; +https://zakonexpertt.kz)',
    'Accept': 'application/rss+xml, application/xml, text/xml',
  },
  customFields: {
    item: [
      ['media:content',   'mediaContent'],
      ['enclosure',       'enclosure'],
      ['media:thumbnail', 'mediaThumbnail'],
    ],
  },
});

// ─── RELEVANCE SCORING ────────────────────────────────────────────────────────
// Each match adds its weight to the score (max capped at 1.0).
const HIGH_WEIGHT = 5;
const MED_WEIGHT  = 2;

const HIGH_KEYWORDS = [
  'арест счет', 'арест карт', 'заблокировал', 'арестовал счет',
  'арестован счет', 'чси', 'судебный исполнитель',
  'исполнительное производство', 'исполнительная надпись',
  'взыскание задолженност', 'запрет регистрационных',
  'арест имуществ', 'арест авто', 'снятие ареста',
  'отмена исполнительной', 'возражение нотариусу',
  'kaspi арест', 'halyk арест', 'freedom арест',
  'алименты чси', 'штраф чси', 'рассрочка исполнения',
  'судебный пристав', 'банкротств',
];

const MED_KEYWORDS = [
  'банк', 'кредит', 'займ', 'заем', 'мфо', 'микрофинанс',
  'задолженность', 'должник', 'взыскатель', 'взыскание',
  'коллектор', 'суд', 'штраф', 'алименты', 'авто',
  'имущество', 'нотариус', 'ограничение', 'ипотек',
  'просрочк', 'неплатеж', 'заёмщик', 'заемщик',
  'kaspi', 'halyk', 'freedom', 'антифрод', 'мошенничество',
  'финансов',
];

// Hard-reject topics regardless of any keyword match
const REJECT_TOPICS = [
  'гороскоп', 'зодиак', 'рецепт', 'погода', 'прогноз погоды',
  'кино', 'фильм', 'сериал', 'концерт', 'музыка', 'певец',
  'певица', 'актёр', 'звезда эстрады',
  'спорт', 'футбол', 'хоккей', 'теннис', 'чемпионат', 'матч',
  'туризм', 'отдых', 'отпуск', 'курорт', 'путешестви',
  'кулинар', 'диета', 'похудени', 'красота', 'мода', 'стиль',
  'свадьба', 'праздник', 'юбилей',
  'убийств', 'убит', 'нашли тело', 'изрезанн',
  'пожар', 'авари', 'дтп без', 'стоматол', 'операция',
  'нефть', 'опек', 'уголовн', 'наркот',
];

/**
 * Compute relevance score in range 0..1.
 * High keywords: +5 pts each, medium: +2 pts.
 * Normalised so that two high matches ≈ 1.0.
 */
function calcRelevance(title, description = '') {
  const text = (title + ' ' + description).toLowerCase();

  // Hard reject
  for (const bad of REJECT_TOPICS) {
    if (text.includes(bad)) return 0;
  }

  let raw = 0;
  for (const kw of HIGH_KEYWORDS) if (text.includes(kw)) raw += HIGH_WEIGHT;
  for (const kw of MED_KEYWORDS)  if (text.includes(kw)) raw += MED_WEIGHT;

  // Normalise: 10 raw pts → score 1.0
  return Math.min(raw / 10, 1);
}

function isPrefilterRelevant(title, description, extraKeywords = []) {
  const text = (title + ' ' + (description || '')).toLowerCase();

  for (const bad of REJECT_TOPICS) {
    if (text.includes(bad)) return false;
  }

  // One high keyword is enough
  for (const kw of HIGH_KEYWORDS) {
    if (text.includes(kw)) return true;
  }
  // Extra source-level keywords
  for (const kw of extraKeywords.map(k => k.toLowerCase())) {
    if (text.includes(kw)) return true;
  }
  // Two medium keywords
  const medMatches = MED_KEYWORDS.filter(kw => text.includes(kw)).length;
  return medMatches >= 2;
}

// ─── SLUG ─────────────────────────────────────────────────────────────────────
function makeSlug(title, urlHash) {
  const base = slugify(title, { lower: true, strict: true, locale: 'ru' });
  const hash = Math.abs(urlHash).toString().slice(-6);
  return (base || 'news').substring(0, 80) + '-' + hash;
}

// ─── TAGS ─────────────────────────────────────────────────────────────────────
function detectTags(title, description) {
  const text = (title + ' ' + (description || '')).toLowerCase();
  const tags = [];
  const tagMap = {
    'Kaspi':        ['kaspi', 'каспи'],
    'Halyk':        ['halyk', 'народный банк', 'халык'],
    'Freedom':      ['freedom', 'фридом'],
    'арест счета':  ['арест счет', 'заблокировали счет', 'арест карт'],
    'ЧСИ':          ['чси', 'судебный исполнитель', 'исполнительное производство'],
    'нотариус':     ['нотариус', 'исполнительная надпись'],
    'кредит':       ['кредит', 'займ', 'заем', 'задолженность', 'мфо'],
    'авто':         ['автомобил', 'авто', 'транспортн', 'регистрационных'],
    'банк':         ['банк'],
    'штраф':        ['штраф', 'административн'],
    'алименты':     ['алимент'],
    'суд':          ['решение суда', 'судебн', 'апелляц'],
  };
  for (const [tag, patterns] of Object.entries(tagMap)) {
    if (patterns.some(p => text.includes(p))) tags.push(tag);
  }
  return tags;
}

// ─── CONTENT GENERATOR ────────────────────────────────────────────────────────

/**
 * Generate a unique SEO legal title based on original title + excerpt.
 * Appends a short differentiator so two similar topics don't get identical titles.
 */
function generateLegalTitle(origTitle, description) {
  const text = (origTitle + ' ' + (description || '')).toLowerCase();

  // Extract a short "context" phrase from the original title (first 5 words)
  const origWords = origTitle.trim().split(/\s+/).slice(0, 6).join(' ');

  if (text.includes('стоп-кредит') || text.includes('stop kredit') || text.includes('stop-kredit')) {
    return `Сервис «Стоп-кредит»: защита от мошеннических займов и арестов счетов`;
  }
  if (text.includes('мошенни') || text.includes('серых') || text.includes('сомнительн') || text.includes('нелегальн')) {
    return `Серые кредиторы и аресты счетов: ${origWords} — что это значит для должников`;
  }
  if (text.includes('арест счет') || text.includes('заблокировал') || text.includes('арест карт')) {
    const bank = text.includes('kaspi') ? 'Kaspi' : text.includes('halyk') ? 'Halyk' : text.includes('freedom') ? 'Freedom' : '';
    return bank
      ? `Арест счёта ${bank}: разбор ситуации — ${origWords}`
      : `Арест счёта или карты: разбор — ${origWords}`;
  }
  if (text.includes('исполнительн надпис') || (text.includes('нотариус') && text.includes('долг'))) {
    return `Исполнительная надпись: ${origWords} — правовой разбор`;
  }
  if (text.includes('чси') || text.includes('исполнительное производство') || text.includes('судебный исполнитель')) {
    return `ЧСИ и должники: ${origWords} — что нужно знать`;
  }
  if (text.includes('запрет регистрационных') || (text.includes('авто') && text.includes('запрет'))) {
    return `Запрет на авто от ЧСИ: ${origWords} — разбор`;
  }
  if (text.includes('алимент') && (text.includes('чси') || text.includes('арест') || text.includes('долг'))) {
    return `Алименты и ЧСИ: ${origWords} — что делать должнику`;
  }
  if (text.includes('штраф') && (text.includes('чси') || text.includes('долг') || text.includes('арест'))) {
    return `Штраф у ЧСИ: ${origWords} — правовой разбор для должников`;
  }
  if (text.includes('банкротств')) {
    return `Банкротство физлица в Казахстане: ${origWords} — что важно знать`;
  }
  if (text.includes('кредит') && (text.includes('мфо') || text.includes('микро'))) {
    return `МФО и кредитные долги: ${origWords} — разбор`;
  }
  if (text.includes('кредит') || text.includes('займ') || text.includes('задолженность')) {
    return `Долг по кредиту: ${origWords} — что делать`;
  }
  if (text.includes('закон') || text.includes('поправк') || text.includes('вступил')) {
    return `Изменения в законах: ${origWords} — что это значит для должников`;
  }
  if (text.includes('банк') || text.includes('kaspi') || text.includes('halyk') || text.includes('freedom')) {
    return `Банки и должники: ${origWords} — правовой разбор`;
  }
  if (text.includes('имуществ') || text.includes('недвижим')) {
    return `Арест имущества: ${origWords} — разбор`;
  }
  // Generic fallback — keep original title + context
  return `${origWords} — разбор для должников`;
}

function generateEventSummary(origTitle, rssExcerpt) {
  const excerpt = (rssExcerpt || '').trim();
  if (excerpt.length > 80) {
    return excerpt.substring(0, 500);
  }
  return `В казахстанских СМИ появилась публикация: «${origTitle.substring(0, 120)}». Ниже — юридический разбор того, что это может означать для должников.`;
}

function generateWhyImportant(origTitle, description) {
  const text = (origTitle + ' ' + (description || '')).toLowerCase();
  if (text.includes('закон') || text.includes('поправк') || text.includes('изменени') || text.includes('вступил')) {
    return 'Изменения в законодательстве прямо затрагивают процедуру исполнительного производства, права должников и порядок совершения исполнительных надписей. Своевременное знание позволяет использовать новые механизмы защиты и не упустить процессуальные сроки.';
  }
  if (text.includes('арест') || text.includes('заблокировал') || text.includes('счет') || text.includes('карт')) {
    return 'Арест счёта или карты — одна из самых болезненных мер принудительного исполнения. Важно понимать, что арест — не приговор: в зависимости от основания взыскания существуют правовые механизмы для его оспаривания или снятия.';
  }
  if (text.includes('банк') || text.includes('кредит') || text.includes('займ') || text.includes('мфо')) {
    return 'Банки и МФО — главные источники арестов через исполнительную надпись нотариуса или судебный порядок. Понимание того, как ведут себя кредиторы, помогает не допустить внезапной блокировки счёта и своевременно отреагировать на уведомления.';
  }
  if (text.includes('чси') || text.includes('исполнительн')) {
    return 'ЧСИ — ключевое звено в цепочке взыскания: именно он блокирует счета, накладывает запреты на авто и имущество. Понимание его действий позволяет должнику защищать свои права и не терять время на неэффективные шаги.';
  }
  if (text.includes('мошенни') || text.includes('серых') || text.includes('нелегальн')) {
    return 'Нелегальные кредиторы и мошеннические схемы — источник спорных долгов, которые нередко становятся основой для исполнительных надписей. Такие надписи зачастую можно оспорить, поскольку требование не является бесспорным.';
  }
  return 'Финансово-правовые события в Казахстане напрямую влияют на должников: меняются механизмы взыскания, условия кредитования и практика работы ЧСИ. Знание актуальных тенденций — это возможность вовремя защитить счета и имущество.';
}

function generateLegalCommentary(origTitle, description) {
  const text = (origTitle + ' ' + (description || '')).toLowerCase();
  if (text.includes('арест счет') || text.includes('заблокировал') || text.includes('арест карт')) {
    return 'Арест счёта появляется на основании постановления ЧСИ, направленного в банк. Банк обязан исполнить постановление — звонить в банк с просьбой "снять арест" бесполезно. Работать нужно с источником ареста: если основание — исполнительная надпись нотариуса, у должника есть 10 рабочих дней на возражение. Если решение суда — рассматриваются апелляция, восстановление срока, рассрочка исполнения. Мы устанавливаем основание и определяем правовой путь.';
  }
  if (text.includes('исполнительн надпис') || (text.includes('нотариус') && (text.includes('долг') || text.includes('кредит')))) {
    return 'Исполнительная надпись — нотариальный документ для взыскания по бесспорным требованиям (ст. 92-1 Закона РК «О нотариате»). Если должник не согласен с суммой, процентами, фактом уведомления или самим договором — требование содержит признаки спорного. В этом случае должник вправе направить возражение нотариусу в течение 10 рабочих дней. Нотариус рассматривает возражение в течение 3 рабочих дней. При отмене надписи — основание для исполнительного производства отпадает.';
  }
  if (text.includes('чси') || text.includes('исполнительное производство') || text.includes('судебный исполнитель')) {
    return 'ЧСИ действует строго на основании исполнительного документа. Должник вправе знать: номер ИП, основание взыскания, размер суммы и расходов производства. Если документы переданы с нарушениями, сумма завышена или основание оспорено — возможно оспаривание действий ЧСИ через жалобу или суд. Мы проверяем производство, рассчитываем законную сумму и принимаем меры по снятию ограничений.';
  }
  if (text.includes('кредит') || text.includes('займ') || text.includes('задолженность') || text.includes('мфо')) {
    return 'Кредитные долги перед банками и МФО — самая частая причина арестов счетов. Взыскание идёт через исполнительную надпись нотариуса (внесудебный путь) или решение суда. При исполнительной надписи ключевой вопрос — бесспорность требования. Если должник не получал уведомление, не согласен с суммой или расчётом — есть основания для возражения. Мы устанавливаем тип документа и определяем правовую позицию по каждому конкретному случаю.';
  }
  if (text.includes('мошенни') || text.includes('серых') || text.includes('нелегальн')) {
    return 'Займы у нелегальных или сомнительных кредиторов нередко оформляются через исполнительную надпись с нарушениями. Условия договора, проценты и комиссии могут не соответствовать законодательству. Если требование такого кредитора легло в основу исполнительной надписи — стоит проверить бесспорность долга, наличие надлежащего уведомления и соответствие суммы договору.';
  }
  if (text.includes('алимент')) {
    return 'Алименты — отдельная категория, которая не отменяется через возражение нотариусу. Однако по алиментам можно: проверить правильность расчёта задолженности, подтвердить произведённые оплаты, оспорить неправильный расчёт через ЧСИ или суд, а при изменении обстоятельств — обратиться за изменением размера алиментов. Важно действовать через правильный механизм.';
  }
  if (text.includes('штраф') || text.includes('административ')) {
    return 'Административные штрафы обжалуются по правилам КоАП РК — срок обжалования 10 суток с момента вручения постановления. Через возражение нотариусу штрафы не отменяются. Если штраф уже передан ЧСИ — нужно проверить: основание, дату, факт оплаты, законность передачи. После оплаты или отмены постановления — арест со счёта снимается.';
  }
  return 'Финансово-правовые изменения в Казахстане влияют на механизмы взыскания и права должников. При любом аресте или ограничении важно: установить тип исполнительного документа, проверить основание взыскания и выбрать правильный правовой инструмент. Мы помогаем сделать это комплексно.';
}

function generateWhatToCheck(origTitle, description) {
  const text = (origTitle + ' ' + (description || '')).toLowerCase();
  const items = [];

  if (text.includes('арест') || text.includes('заблокировал') || text.includes('счет') || text.includes('карт')) {
    items.push('Проверьте наличие исполнительных производств по ИИН через egov.kz или IIN-форму на нашем сайте');
    items.push('Уточните в банке номер постановления ЧСИ и имя взыскателя');
    items.push('Выясните, получали ли вы официальное уведомление нотариуса или ЧСИ');
  }
  if (text.includes('исполнительн надпис') || text.includes('нотариус')) {
    items.push('Проверьте, есть ли исполнительная надпись нотариуса по вашему договору');
    items.push('Сверьте сумму задолженности с расчётом взыскателя — нередко есть расхождения');
    items.push('Убедитесь, что не пропустили 10-рабочих-дневный срок на возражение');
  }
  if (text.includes('чси') || text.includes('исполнительное производство')) {
    items.push('Запросите у ЧСИ полный расчёт суммы взыскания и расходов по производству');
    items.push('Проверьте соразмерность принятых мер (арест авто, счёта, имущества) сумме долга');
  }
  if (text.includes('авто') || text.includes('запрет регистрационных')) {
    items.push('Проверьте наличие запрета регистрационных действий через портал egov.kz');
  }
  if (text.includes('кредит') || text.includes('займ') || text.includes('мфо')) {
    items.push('Проверьте, правильно ли рассчитаны проценты и пени по договору');
    items.push('Убедитесь, что все ваши платежи учтены в расчёте задолженности');
  }

  if (items.length === 0) {
    items.push('Проверьте наличие исполнительных производств по ИИН');
    items.push('Уточните, нет ли ограничений на счета, авто или имущество');
    items.push('Установите тип исполнительного документа — от него зависит путь снятия');
  }

  return items;
}

function generateWhenToSeekHelp(origTitle, description) {
  const text = (origTitle + ' ' + (description || '')).toLowerCase();
  if (text.includes('арест') || text.includes('заблокировал') || text.includes('счет') || text.includes('карт')) {
    return 'Обратитесь за анализом, если: счёт или карта внезапно заблокированы; пришло уведомление от ЧСИ; вы не понимаете, на каком основании наложен арест; сумма взыскания кажется завышенной; взыскатель — банк или МФО с которым есть спор.';
  }
  if (text.includes('кредит') || text.includes('займ') || text.includes('задолженность') || text.includes('мфо')) {
    return 'Обратитесь за анализом, если: банк или МФО угрожает исполнительной надписью; с вас требуют сумму больше, чем вы брали; производство уже возбуждено; деньги списываются, а уведомлений не было.';
  }
  if (text.includes('мошенни') || text.includes('серых') || text.includes('нелегальн')) {
    return 'Обратитесь за анализом, если: взыскание идёт через нотариуса или ЧСИ по сомнительному договору; сумма взыскания удивляет; в договоре были непрозрачные условия.';
  }
  if (text.includes('авто') || text.includes('запрет регистрационных')) {
    return 'Обратитесь, если: стало известно о запрете на авто от ЧСИ; хотите продать или переоформить авто, но есть ограничение; сумма долга по ИП кажется несоразмерной.';
  }
  return 'Обратитесь за анализом, если вы узнали себя в описанной ситуации. Первый шаг — проверка наличия исполнительных производств по ИИН. Большинство арестов выявляются именно так — до того как деньги списаны.';
}

// ─── IMAGE EXTRACTION ─────────────────────────────────────────────────────────
function extractRssImage(item) {
  if (!USE_SOURCE_IMG) return null;
  if (item.mediaContent?.['$']?.url)      return item.mediaContent['$'].url;
  if (item.mediaThumbnail?.['$']?.url)    return item.mediaThumbnail['$'].url;
  if (item.enclosure?.url)                return item.enclosure.url;
  if (item['media:thumbnail']?.['$']?.url) return item['media:thumbnail']['$'].url;
  return null;
}

/**
 * Fetch og:image and short page excerpt for relevance boosting.
 * Does NOT store full article text — only uses it for analysis.
 */
async function fetchPageMeta(url) {
  try {
    const resp = await axios.get(url, {
      timeout: 10000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; ZakonExpert-NewsBot/1.0)',
        'Accept': 'text/html,application/xhtml+xml,*/*;q=0.8',
      },
      maxRedirects: 3,
      maxContentLength: 500_000, // only read first 500 KB
    });

    const $ = cheerio.load(resp.data, { decodeEntities: true });
    const ogImage = USE_SOURCE_IMG
      ? ($('meta[property="og:image"]').attr('content') || null)
      : null;

    // Extract a short excerpt for better relevance scoring (NOT for storage)
    const descMeta = $('meta[name="description"]').attr('content')
      || $('meta[property="og:description"]').attr('content')
      || '';

    return { ogImage, pageDesc: descMeta.substring(0, 400) };
  } catch {
    return { ogImage: null, pageDesc: '' };
  }
}

// ─── FETCH SOURCE ─────────────────────────────────────────────────────────────
let totalImportedThisRun = 0;

async function fetchSource(source) {
  if (!source.enabled || !source.rss_url) return { imported: 0, rejected: 0, duplicate: 0 };

  let feed;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      feed = await parser.parseURL(source.rss_url);
      break;
    } catch (err) {
      if (attempt === 2) {
        console.error(`[NewsImporter] ${source.name}: failed after 2 attempts — ${err.message}`);
        return { imported: 0, rejected: 0, duplicate: 0 };
      }
      await new Promise(r => setTimeout(r, 3000));
    }
  }

  let imported = 0, rejected = 0, duplicate = 0;
  const now = new Date().toISOString();
  const batchTitles = new Set();

  for (const item of (feed.items || [])) {
    if (totalImportedThisRun >= IMPORT_LIMIT) break;

    const origTitle  = (item.title || '').trim();
    const origUrl    = item.link || item.guid;
    if (!origTitle || !origUrl) continue;

    // URL dedup
    if (await db.existsByUrl(origUrl)) { duplicate++; continue; }

    const rssExcerpt = (item.contentSnippet || item.content || item.summary || '')
      .replace(/<[^>]+>/g, '').trim().substring(0, 500);

    // Quick relevance pre-filter (fast, no HTTP request)
    if (!isPrefilterRelevant(origTitle, rssExcerpt, source.keywords || [])) {
      rejected++; continue;
    }

    // Fetch page meta for better relevance scoring (no full article stored)
    const { ogImage: pageOgImg, pageDesc } = await fetchPageMeta(origUrl);
    await new Promise(r => setTimeout(r, 600));

    const combinedText = `${origTitle} ${rssExcerpt} ${pageDesc}`;
    const relevanceScore = calcRelevance(origTitle, combinedText);

    if (relevanceScore < 0.2) { rejected++; continue; } // hard floor

    const tags     = detectTags(origTitle, combinedText);
    const legalTitle = generateLegalTitle(origTitle, rssExcerpt);

    // Title dedup — skip if same generated title already saved or in this batch
    const titleKey = legalTitle.toLowerCase().trim().substring(0, 60);
    if (batchTitles.has(titleKey)) { duplicate++; continue; }
    if (await db.existsByGeneratedTitle(legalTitle)) { duplicate++; continue; }
    batchTitles.add(titleKey);

    // Generate unique structured content
    const eventSummary     = generateEventSummary(origTitle, rssExcerpt);
    const whyImportant     = generateWhyImportant(origTitle, rssExcerpt);
    const legalCommentary  = generateLegalCommentary(origTitle, rssExcerpt);
    const whatToCheck      = generateWhatToCheck(origTitle, rssExcerpt);
    const whenToSeekHelp   = generateWhenToSeekHelp(origTitle, rssExcerpt);

    const excerpt = rssExcerpt.substring(0, 280) || origTitle;

    // Status based on score and env config
    let status = 'draft';
    if (AUTO_PUBLISH && relevanceScore >= MIN_RELEVANCE) status = 'published';
    else if (relevanceScore < 0.2) status = 'rejected';

    const urlHash = origUrl.split('').reduce((a, c) => ((a << 5) - a + c.charCodeAt(0)) | 0, 0);
    const slug         = makeSlug(legalTitle, Math.abs(urlHash));
    const publishedAt  = item.pubDate ? new Date(item.pubDate).toISOString() : now;
    const canonicalUrl = `https://zakonexpertt.kz/news/${slug}`;
    const metaTitle    = legalTitle.substring(0, 65) + ' | ZakonExpert';
    const metaDesc     = excerpt.substring(0, 155) || `Разбор: ${legalTitle.substring(0, 100)}`;

    const rssImg = extractRssImage(item);
    const ogImage = rssImg || (USE_SOURCE_IMG ? pageOgImg : null);

    // Category cover image (our own SVG — always available)
    const categoryCover = `/img/news/news-cover-${getCoverName(tags)}.svg`;

    const article = {
      // Original source data
      original_title:      origTitle,
      original_url:        origUrl,
      original_excerpt:    rssExcerpt.substring(0, 400),
      source_name:         source.name,
      source_domain:       source.base_url,
      published_at_source: publishedAt,

      // Our generated content
      title:               legalTitle,
      slug,
      excerpt,
      event_summary:       eventSummary,
      why_important:       whyImportant,
      legal_commentary:    legalCommentary,
      what_to_check:       JSON.stringify(whatToCheck),
      when_to_seek_help:   whenToSeekHelp,

      // Metadata
      category:          source.category || 'general',
      tags:              JSON.stringify(tags),
      relevance_score:   relevanceScore,
      status,

      // SEO
      meta_title:        metaTitle,
      meta_desc:         metaDesc,
      canonical_url:     canonicalUrl,
      og_image:          ogImage,
      category_cover:    categoryCover,

      // Timestamps
      published_at_site: status === 'published' ? now : null,
      imported_at:       now,
    };

    try {
      const result = await db.insertNews(article);
      if (result.changes > 0) {
        imported++;
        totalImportedThisRun++;
        console.log(`[NewsImporter] ✓ ${status.toUpperCase()} (score=${relevanceScore.toFixed(2)}): "${legalTitle.substring(0, 60)}"`);
      } else {
        duplicate++;
      }
    } catch (e) {
      if (!e.message?.includes('unique')) {
        console.error(`[NewsImporter] Insert error: ${e.message}`);
      } else {
        duplicate++;
      }
    }
  }

  return { imported, rejected, duplicate };
}

function getCoverName(tags) {
  if (tags.includes('Kaspi') || tags.includes('Halyk') || tags.includes('Freedom') || tags.includes('банк')) return 'bank';
  if (tags.includes('ЧСИ')) return 'chsi';
  if (tags.includes('нотариус')) return 'notarius';
  if (tags.includes('суд')) return 'sud';
  if (tags.includes('штраф')) return 'shtraf';
  if (tags.includes('алименты')) return 'alimenty';
  if (tags.includes('авто')) return 'auto';
  return 'default';
}

// ─── MAIN ENTRY POINT ─────────────────────────────────────────────────────────
let lastImportTime = null;
let lastImportStats = null;

async function importAll() {
  totalImportedThisRun = 0;
  const started = Date.now();
  console.log(`[NewsImporter] ─── Import started at ${new Date().toLocaleString('ru-RU')} ───`);

  // Clean up old drafts and rejected articles older than 7 days
  try {
    const removed = await db.removeIrrelevant();
    if (removed > 0) console.log(`[NewsImporter] Cleaned ${removed} irrelevant/old-draft articles`);
  } catch (e) {
    console.warn('[NewsImporter] Cleanup warning:', e.message);
  }

  let totals = { imported: 0, rejected: 0, duplicate: 0, errors: 0 };

  for (const source of sources) {
    if (!source.enabled) continue;
    if (totalImportedThisRun >= IMPORT_LIMIT) break;

    try {
      const stats = await fetchSource(source);
      console.log(`[NewsImporter] ${source.name}: +${stats.imported} imported, ${stats.rejected} rejected, ${stats.duplicate} dup`);
      totals.imported  += stats.imported;
      totals.rejected  += stats.rejected;
      totals.duplicate += stats.duplicate;
    } catch (e) {
      console.error(`[NewsImporter] Source error (${source.name}): ${e.message}`);
      totals.errors++;
    }

    await new Promise(r => setTimeout(r, 2000));
  }

  const elapsed = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`[NewsImporter] ─── Done in ${elapsed}s | imported: ${totals.imported}, rejected: ${totals.rejected}, dup: ${totals.duplicate} ───`);

  lastImportTime  = new Date().toISOString();
  lastImportStats = totals;

  return totals.imported;
}

function getLastImportInfo() {
  return { lastImportTime, lastImportStats };
}

module.exports = { importAll, fetchSource, getLastImportInfo };
