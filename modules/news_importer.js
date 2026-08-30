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
const fs = require('fs');
const path = require('path');
const db = require('./db');
const sources = require('../config/news_sources.json');

// ─── ENV CONFIG ───────────────────────────────────────────────────────────────
const AUTO_PUBLISH     = process.env.AUTO_PUBLISH_NEWS !== 'false';
const MIN_RELEVANCE    = parseFloat(process.env.NEWS_MIN_RELEVANCE  || '0.45');
const IMPORT_LIMIT     = parseInt(process.env.NEWS_IMPORT_LIMIT     || '50', 10);
const MAX_AGE_DAYS     = parseInt(process.env.NEWS_MAX_AGE_DAYS     || '30', 10);
// RSS/Open Graph images stay on the publisher's host, so they do not consume
// our disk quota. Every page also has a generated local fallback.
const USE_SOURCE_IMAGES = process.env.NEWS_USE_SOURCE_IMAGES !== 'false';
const IMPORT_STATUS_FILE = path.join(__dirname, '..', 'data', 'news-import-status.json');

function cleanText(value = '') {
  const decoded = cheerio.load(`<div>${String(value)}</div>`)('div').text();
  return decoded
    .replace(/[\u00a0\u2007\u202f]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .trim();
}

function truncateAtWord(value, maxLength) {
  const text = cleanText(value);
  if (text.length <= maxLength) return text;
  const cut = text.substring(0, maxLength + 1);
  const lastSpace = cut.lastIndexOf(' ');
  return `${cut.substring(0, lastSpace > maxLength * 0.65 ? lastSpace : maxLength).trim()}…`;
}

function cleanHeadline(value = '') {
  return truncateAtWord(
    cleanText(value)
      .replace(/\s+[|—–-]\s+(?:[\w.-]+\.)?(?:kz|ru|com|org|net)$/iu, '')
      .replace(/\s+(?:[\w-]+\.)+(?:kz|ru|com|org|net)$/iu, ''),
    118
  );
}

function cleanExcerpt(value = '', headline = '') {
  const text = truncateAtWord(
    cleanText(value).replace(/\s+(?:[\w-]+\.)+(?:kz|ru|com|org|net)$/iu, ''),
    300
  );
  if (text.length < 45 || text.toLowerCase() === cleanText(headline).toLowerCase()) return '';
  return text;
}

function buildExcerpt(rssExcerpt, pageDesc, headline) {
  const rss = cleanExcerpt(rssExcerpt, headline);
  const page = cleanExcerpt(pageDesc, headline);
  if (page.length > rss.length + 25) return page;
  if (rss) return rss;
  if (page) return page;
  return `Что произошло и как эта ситуация может повлиять на должников в Казахстане — объясняем простым языком и даём практический алгоритм действий.`;
}

function normalizeCategory(category = '', tags = []) {
  const value = String(category).toLowerCase();
  if (value === 'адвокат') return 'Адвокат';
  if (['bank', 'finance', 'кредит', 'банкротство'].includes(value)) return 'finance';
  if (['чси', 'chsi'].includes(value)) return 'chsi';
  if (['нотариус', 'notarius'].includes(value)) return 'notarius';
  if (['штрафы', 'shtrafy'].includes(value)) return 'shtrafy';
  if (['алименты', 'alimenty'].includes(value)) return 'alimenty';
  if (['авто', 'avto'].includes(value)) return 'avto';
  if (['законы', 'laws'].includes(value)) return 'laws';
  if (tags.includes('ЧСИ')) return 'chsi';
  if (tags.includes('нотариус')) return 'notarius';
  return 'general';
}

// ─── RSS PARSER ───────────────────────────────────────────────────────────────
const parser = new RSSParser({
  timeout: 12000,
  headers: {
    'User-Agent': 'Mozilla/5.0 (compatible; ZakonExpert-NewsBot/1.0; +https://zakonexpert.kz)',
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
  'запрет выезда', 'запрет на авто', 'арест на имущество',
  'взыскал долг', 'взыскали долг', 'взыскали деньги',
  'принудительное взыскание', 'списали деньги со счета',
  'заблокировали карту', 'заблокировали счет',
  'исполнительный сбор', 'стоп-кредит',
];

const MED_KEYWORDS = [
  'банк', 'кредит', 'займ', 'заем', 'мфо', 'микрофинанс',
  'задолженность', 'должник', 'взыскатель', 'взыскание',
  'коллектор', 'суд', 'штраф', 'алименты', 'авто',
  'имущество', 'нотариус', 'ограничение', 'ипотек',
  'просрочк', 'неплатеж', 'заёмщик', 'заемщик',
  'kaspi', 'halyk', 'freedom', 'антифрод', 'мошенничество',
  'финансов', 'долг', 'задолж', 'взыскан',
  'закон о банках', 'закон о кредит', 'финрег', 'агфин',
  'нацбанк', 'национальный банк', 'банковск',
  'исполнительн', 'нотариальн', 'право требован',
  'потребительск кредит', 'микрозайм', 'рефинансирован',
  'реструктуризац', 'просрочен', 'пени', 'неустойк',
  'черный список', 'бюро кредитных историй', 'пкб',
  'судебн', 'решение суда', 'апелляц', 'иск', 'исков',
];

// Hard-reject topics regardless of any keyword match
const REJECT_TOPICS = [
  'гороскоп', 'зодиак', 'рецепт', 'погода', 'прогноз погоды',
  'кино', 'фильм', 'сериал', 'концерт', 'музыка', 'певец',
  'певица', 'актёр', 'звезда эстрады', 'шоу-бизнес',
  'спорт', 'футбол', 'хоккей', 'теннис', 'чемпионат', 'матч',
  'туризм', 'отдых', 'отпуск', 'курорт', 'путешестви',
  'кулинар', 'диета', 'похудени', 'красота', 'мода', 'стиль',
  'свадьба', 'праздник', 'юбилей', 'день рождения',
  'убийств', 'убит', 'нашли тело', 'изрезанн', 'маньяк',
  'пожар', 'стоматол', 'дтп', 'авиакатастроф',
  'нефть', 'опек', 'нефтяной', 'нефтедобыч',
  'наркот', 'терроризм', 'теракт',
  'миграц', 'визов', 'гражданств', 'паспорт',
  'выборы', 'партия', 'президент', 'политик',
  'погиб', 'жертв', 'трагеди', 'катастроф',
  'медицин', 'больниц', 'операция', 'лекарств',
  'образован', 'школ', 'университет', 'студент',
  'сельск', 'агро', 'зерн', 'урожай',
  'нашли клад', 'ufо', 'нло',
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

  if (HIGH_KEYWORDS.some(kw => text.includes(kw))) return true;

  // Broad RSS feeds used to accept any item containing one word such as
  // "банк" or "суд". Require a financial subject plus a debt/enforcement
  // signal so lifestyle and general crime stories do not become legal news.
  const financialSignals = [
    'банк', 'кредит', 'займ', 'заем', 'мфо', 'микрофинанс', 'ипотек',
    'коллектор', 'долг', 'задолж', 'заёмщик', 'заемщик', 'банкротств',
  ];
  const enforcementSignals = [
    'арест', 'взыскан', 'должник', 'чси', 'исполнительн', 'нотариус',
    'просроч', 'реструктуризац', 'рефинансирован', 'списали деньги',
    'запрет выезда', 'запрет на авто',
  ];
  const publicLawSignals = ['закон', 'поправк', 'правил', 'нацбанк', 'аррфр', 'агентство'];

  const hasFinancial = financialSignals.some(kw => text.includes(kw));
  const hasEnforcement = enforcementSignals.some(kw => text.includes(kw));
  const hasPublicLaw = publicLawSignals.some(kw => text.includes(kw));

  return (hasFinancial && hasEnforcement) || (hasPublicLaw && (hasFinancial || hasEnforcement));
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

// ─── CONTENT GENERATORS ───────────────────────────────────────────────────────
// Each function produces a full paragraph block (150-300 words) — not a single sentence.

/**
 * Generate a unique SEO legal title based on original title + excerpt.
 * Appends a short differentiator so two similar topics don't get identical titles.
 */
function generateLegalTitle(origTitle, description) {
  // Preserve the actual news headline. The previous generator kept only six
  // words and glued on a template, producing unreadable and misleading titles.
  return cleanHeadline(origTitle);
}

function generateEventSummary(origTitle, rssExcerpt) {
  const excerpt = (rssExcerpt || '').trim();
  const intro = excerpt.length > 80
    ? excerpt.substring(0, 600)
    : `В казахстанских СМИ появилась публикация: «${origTitle.substring(0, 150)}».`;

  return `${intro}\n\nЭта новость представляет интерес для людей, столкнувшихся с арестами счетов, ограничениями на имущество или автомобиль, исполнительными производствами и взысканиями в Казахстане. Ниже — юридический разбор ZakonExpert: что происходит, почему это важно для должников и что стоит проверить прямо сейчас.`;
}

function generateWhyImportant(origTitle, description) {
  const text = (origTitle + ' ' + (description || '')).toLowerCase();

  if (text.includes('закон') || text.includes('поправк') || text.includes('изменени') || text.includes('вступил')) {
    return `Изменения в законодательстве напрямую влияют на права должников и механизмы взыскания. Когда принимаются новые нормы или вносятся поправки в существующие законы — это меняет порядок работы ЧСИ, нотариусов, банков и судов.\n\nДолжнику важно следить за такими изменениями по нескольким причинам. Во-первых, новые нормы могут открывать дополнительные механизмы защиты — например, новые основания для обжалования или сокращённые сроки для принятия мер. Во-вторых, изменения в порядке совершения исполнительных надписей, работы ЧСИ или судебных процедур напрямую определяют, какой путь снятия ареста доступен в конкретной ситуации.\n\nЕсли вы не следите за актуальным законодательством — вы рискуете пропустить сроки или использовать неподходящий инструмент. Правовой анализ должен опираться на действующую редакцию закона, а не на устаревшие знания.`;
  }

  if (text.includes('арест') || text.includes('заблокировал') || text.includes('счет') || text.includes('карт')) {
    return `Арест счёта или карты — одна из самых болезненных мер принудительного исполнения. Человек внезапно обнаруживает, что не может снять деньги, оплатить коммунальные услуги или рассчитаться в магазине. Это создаёт острую жизненную ситуацию.\n\nПри этом многие должники допускают первую ошибку: начинают звонить в банк с просьбой снять арест. Банк не может этого сделать — он лишь исполняет постановление ЧСИ и не является стороной, принявшей решение. Работать нужно с источником ареста.\n\nВажно понимать: арест — это мера принудительного исполнения, а не окончательный вердикт. В зависимости от того, какой документ лежит в основе взыскания — исполнительная надпись нотариуса, решение суда, штраф или алименты — существуют разные правовые механизмы. В ряде случаев арест можно снять, оспорив само основание взыскания.`;
  }

  if (text.includes('банк') || text.includes('кредит') || text.includes('займ') || text.includes('мфо')) {
    return `Банки и МФО — главный источник арестов счетов в Казахстане. Большинство случаев блокировки счёта возникает именно по требованиям кредиторов, которые используют два основных инструмента: исполнительную надпись нотариуса (внесудебный путь) и решение суда (судебный путь).\n\nИсполнительная надпись — более быстрый способ взыскания, который применяется при наличии бесспорного долга. Если кредитор считает, что должник не оспаривает ни сумму, ни факт задолженности, ни условия договора — он может обратиться к нотариусу и получить исполнительный документ без суда.\n\nОднако ключевое слово здесь — «бесспорный». Если должник не согласен с суммой, расчётом процентов и пеней, датой уведомления или самим договором — требование уже содержит признаки спорного. Это меняет правовую картину и открывает возможность для возражения.`;
  }

  if (text.includes('чси') || text.includes('исполнительн')) {
    return `Частный судебный исполнитель (ЧСИ) — центральное звено в механизме принудительного взыскания в Казахстане. Именно ЧСИ возбуждает исполнительное производство, направляет постановления в банки для ареста счетов, накладывает запреты на автомобили, недвижимость и другое имущество.\n\nМногие должники не знают своих прав в отношениях с ЧСИ. Между тем закон предусматривает целый ряд прав должника: знать основание и сумму взыскания, получать копии постановлений, обжаловать действия или бездействие ЧСИ, участвовать в исполнительных действиях.\n\nПонимание того, как работает система ЧСИ, позволяет должнику не паниковать при получении постановления, а действовать осознанно: проверить документы, сверить суммы, убедиться в соразмерности принятых мер и при необходимости — оспорить действия исполнителя.`;
  }

  if (text.includes('мошенни') || text.includes('серых') || text.includes('нелегальн')) {
    return `Нелегальные и сомнительные кредиторы — серьёзная проблема для потребителей финансовых услуг в Казахстане. Такие организации работают вне рамок лицензионного регулирования, предлагают займы на непрозрачных условиях, начисляют незаконные комиссии и проценты, а затем пытаются взыскать долг через нотариуса или суд.\n\nОсобую опасность представляет ситуация, когда долг по договору с таким кредитором превращается в исполнительную надпись нотариуса. Нотариус совершает надпись, полагая, что требование бесспорно — но на практике условия договора могут противоречить закону, а сумма задолженности быть существенно завышена.\n\nВ таких ситуациях важно не соглашаться с требованием автоматически. Наличие задолженности — не всегда означает её бесспорность. Если условия договора были нарушены кредитором, возможен правовой анализ и оспаривание исполнительной надписи.`;
  }

  return `Финансово-правовые события в Казахстане напрямую влияют на должников: меняются механизмы взыскания, практика работы банков, ЧСИ и нотариусов. Должник, который следит за актуальной ситуацией, лучше подготовлен к защите своих прав.\n\nКаждая новость из банковской, правовой или финансовой сферы может содержать информацию, важную для понимания того, как развивается взыскание в Казахстане: какие банки активнее используют исполнительные надписи, как суды трактуют спорные ситуации, какие изменения происходят в работе ЧСИ.\n\nЗнание этих тенденций позволяет своевременно принять меры: проверить наличие производств по ИИН, уточнить основание взыскания и при необходимости — начать правовую защиту до того, как средства будут списаны со счёта.`;
}

function generateLegalCommentary(origTitle, description) {
  const text = (origTitle + ' ' + (description || '')).toLowerCase();

  if (text.includes('арест счет') || text.includes('заблокировал') || text.includes('арест карт')) {
    return `Арест счёта — это мера принудительного исполнения, которую ЧСИ применяет на основании исполнительного документа. Банк получает постановление и обязан его исполнить: заблокировать счёт или удерживать деньги в пределах суммы взыскания.\n\nЧтобы снять арест, необходимо работать с источником — с самим исполнительным производством и документом, который лежит в его основе.\n\nЕсли это **исполнительная надпись нотариуса**: должник вправе направить письменное возражение нотариусу в течение 10 рабочих дней с момента получения уведомления. Нотариус обязан рассмотреть возражение в течение 3 рабочих дней. Если нотариус отменяет надпись — основание для исполнительного производства по ней отпадает, и ЧСИ должен снять арест.\n\nЕсли это **решение суда**: арест снимается только при отмене или изменении самого решения, либо при прекращении производства по иным основаниям (оплата, рассрочка, поворот исполнения). Просто «не соглашаться» с решением суда недостаточно — нужны процессуальные механизмы: апелляция, заявление об отмене, восстановление срока.\n\nЕсли это **штраф или алименты**: применяются отдельные механизмы, характерные для каждого вида взыскания.\n\nМы определяем тип документа, анализируем законность его совершения и разрабатываем конкретный план действий.`;
  }

  if (text.includes('исполнительн надпис') || (text.includes('нотариус') && (text.includes('долг') || text.includes('кредит')))) {
    return `Исполнительная надпись нотариуса — это внесудебный исполнительный документ, который нотариус вправе совершить только по бесспорным требованиям (статья 92-1 Закона РК «О нотариате»). Это означает, что требование кредитора должно быть документально подтверждено, понятно по сумме, и должник не должен оспаривать ни факт долга, ни его размер.\n\nОднако на практике нотариусы нередко совершают надписи и в тех случаях, когда бесспорность сомнительна. Должник может не получить надлежащего уведомления, не согласиться с расчётом процентов, считать договор незаконным или оспаривать факт самого обязательства.\n\n**Что даёт возражение должника?**\nДолжник вправе направить нотариусу письменное возражение в течение **10 рабочих дней** с момента получения уведомления о совершённой надписи. Нотариус обязан рассмотреть возражение в течение **3 рабочих дней** и вынести постановление: либо сохранить надпись, либо отменить её.\n\nЕсли нотариус отменяет исполнительную надпись — основание для исполнительного производства по ней исчезает. ЧСИ должен прекратить или окончить производство, снять аресты со счетов и ограничения на имущество, наложенные именно по этой надписи.\n\nЕсли взыскатель не согласен с отменой — он вправе защищать свою позицию только в судебном порядке, где должник уже сможет полноценно представить доказательства.`;
  }

  if (text.includes('чси') || text.includes('исполнительное производство') || text.includes('судебный исполнитель')) {
    return `Частный судебный исполнитель (ЧСИ) действует на основании исполнительного документа и в рамках Закона РК «Об исполнительном производстве и статусе судебных исполнителей». При этом должник имеет широкий круг прав, которыми многие не пользуются.\n\n**Права должника в исполнительном производстве:**\n— Знать номер исполнительного производства, основание и сумму взыскания\n— Получать копии всех постановлений ЧСИ\n— Знакомиться с материалами исполнительного производства\n— Представлять доказательства оплаты и других обстоятельств\n— Обжаловать действия или бездействие ЧСИ\n— Заявлять об отводе ЧСИ при наличии оснований\n— Просить рассрочку, отсрочку или изменение порядка исполнения\n\n**Когда действия ЧСИ можно оспорить?**\nЕсли ЧСИ превысил полномочия, применил несоразмерные меры, неправильно рассчитал сумму взыскания или расходы производства, нарушил процессуальные сроки — это основания для жалобы. Жалоба подаётся вышестоящему должностному лицу или в суд.\n\nМы анализируем производство, проверяем расчёты и принимаем меры по устранению нарушений.`;
  }

  if (text.includes('кредит') || text.includes('займ') || text.includes('задолженность') || text.includes('мфо')) {
    return `Кредитные долги перед банками и МФО — самая частая причина арестов счетов в Казахстане. Взыскание по таким долгам идёт двумя основными путями: через исполнительную надпись нотариуса (внесудебный, более быстрый) или через решение суда (судебный, с полноценным разбирательством).\n\n**Исполнительная надпись нотариуса** применяется, когда кредитор считает долг бесспорным. При этом бесспорность — ключевой вопрос. Если должник:\n— не получил надлежащего уведомления,\n— не согласен с суммой или расчётом процентов и пеней,\n— считает, что договор нарушает законодательство,\n— уже произвёл часть оплат, не учтённых в расчёте,\n\nто требование содержит признаки спорного, и должник вправе направить возражение нотариусу.\n\n**Решение суда** отменяется только процессуальными средствами: апелляция, заявление об отмене, восстановление срока, рассрочка или отсрочка исполнения. Простое несогласие с решением не меняет ситуацию — нужны конкретные процессуальные действия в установленные сроки.\n\nПервый шаг — установить, на основании какого именно документа возбуждено производство и наложен арест.`;
  }

  if (text.includes('алимент')) {
    return `Алименты занимают особое место среди оснований для исполнительного производства. Они не относятся к требованиям, которые можно оспорить через возражение нотариусу в стандартном порядке — у них своя правовая природа и свои механизмы работы.\n\n**Что можно сделать по алиментному производству:**\n\n1. **Проверить расчёт задолженности.** ЧСИ рассчитывает сумму задолженности на основе решения суда или нотариального соглашения. В расчёт должны быть включены все произведённые платежи. Нередко платежи не учитываются, что приводит к завышенной сумме.\n\n2. **Подтвердить произведённые оплаты.** Если часть алиментов была выплачена неофициально (наличными), доказать это сложнее. Важно предоставить ЧСИ все доступные подтверждающие документы.\n\n3. **Оспорить неправильный расчёт.** Если расчёт ЧСИ содержит ошибки — это можно оспорить через жалобу или в суде.\n\n4. **Изменить размер алиментов.** При существенном изменении материального или семейного положения — можно обратиться в суд с заявлением об изменении размера алиментов.\n\nМы анализируем расчёт, проверяем документы и предлагаем конкретный план действий.`;
  }

  if (text.includes('штраф') || text.includes('административ')) {
    return `Административные штрафы — одна из частых причин арестов счетов. При этом многие должники не знают, что штраф нельзя «отменить через нотариуса» — у него совершенно другой правовой механизм.\n\n**Как работает взыскание штрафа:**\n1. Выносится постановление по делу об административном правонарушении.\n2. Должник получает постановление и имеет **10 суток** на его обжалование по КоАП РК.\n3. Если штраф не оплачен и не обжалован — постановление передаётся ЧСИ для принудительного взыскания.\n4. ЧСИ возбуждает исполнительное производство и может арестовать счёт.\n\n**Что можно сделать:**\n— Если постановление ещё не вступило в силу — обжаловать его в установленный срок.\n— Если срок пропущен — проверить основания для его восстановления (не получили, болезнь, другие уважительные причины).\n— Если штраф уже у ЧСИ — проверить факт оплаты, законность передачи, корректность суммы.\n— После оплаты или отмены штрафа — добиваться прекращения производства и снятия ареста.\n\nВажно: возражение нотариусу при штрафе не применяется — это другой механизм, предназначенный для гражданских денежных обязательств.`;
  }

  return `При любом аресте счёта, запрете на авто или ограничении на имущество первый и важнейший шаг — установить тип исполнительного документа. От этого зависит всё: какой механизм применим, какие сроки действуют, что можно сделать и что нельзя.\n\n**Основные типы исполнительных документов в Казахстане:**\n\n— **Исполнительная надпись нотариуса** (по гражданским обязательствам: кредиты, займы, аренда). Оспаривается через возражение нотариусу в течение 10 рабочих дней.\n\n— **Решение суда** (вынесено в исковом, приказном или упрощённом порядке). Отменяется только процессуальными механизмами: апелляция, заявление об отмене, восстановление срока.\n\n— **Постановление по КоАП** (административные штрафы). Обжалуется в течение 10 суток по правилам КоАП РК.\n\n— **Исполнительный лист по алиментам**. Работа идёт через проверку расчёта, подтверждение оплат, обращение в суд при наличии оснований.\n\nМы устанавливаем тип документа, проверяем его законность и определяем оптимальный правовой путь для конкретной ситуации.`;
}

function generateWhatToCheck(origTitle, description) {
  const text = (origTitle + ' ' + (description || '')).toLowerCase();
  const items = [];

  if (text.includes('арест') || text.includes('заблокировал') || text.includes('счет') || text.includes('карт')) {
    items.push('Проверьте наличие исполнительных производств по ИИН через форму на нашем сайте или egov.kz');
    items.push('Уточните в банке номер постановления ЧСИ, имя взыскателя и основание ареста');
    items.push('Выясните, получали ли вы официальное уведомление от нотариуса или ЧСИ — и когда именно');
    items.push('Проверьте, не истёк ли 10-дневный срок на возражение (если основание — исполнительная надпись)');
  }
  if (text.includes('исполнительн надпис') || text.includes('нотариус')) {
    items.push('Найдите договор, по которому совершена исполнительная надпись — проверьте условия');
    items.push('Сравните сумму в надписи с реальным расчётом: проценты, пени, комиссии — нет ли расхождений');
    items.push('Проверьте, правильно ли определён срок уведомления и соблюдены ли требования к нему');
    items.push('Убедитесь, что все ваши платежи учтены — запросите выписку по счёту');
  }
  if (text.includes('чси') || text.includes('исполнительное производство')) {
    items.push('Запросите у ЧСИ постановление о возбуждении производства и полный расчёт суммы');
    items.push('Проверьте соразмерность мер: арест всех счетов при небольшом долге может быть оспорен');
    items.push('Уточните, начислены ли расходы по исполнению и на каком основании — нередко они завышены');
  }
  if (text.includes('авто') || text.includes('запрет регистрационных')) {
    items.push('Проверьте наличие запрета регистрационных действий на авто через портал egov.kz или гос. услуги');
    items.push('Уточните, по какому конкретно производству наложен запрет — их может быть несколько');
  }
  if (text.includes('кредит') || text.includes('займ') || text.includes('мфо')) {
    items.push('Запросите в банке или МФО полный расчёт задолженности с разбивкой по основному долгу, процентам и пеням');
    items.push('Убедитесь, что все ваши платежи зафиксированы — соберите квитанции и выписки');
    items.push('Проверьте дату последнего уведомления и срок исполнительной надписи');
  }

  if (items.length === 0) {
    items.push('Проверьте наличие исполнительных производств по ИИН на нашем сайте или egov.kz');
    items.push('Установите тип исполнительного документа — от него зависит весь дальнейший план');
    items.push('Выясните имя взыскателя, сумму взыскания и дату возбуждения производства');
    items.push('Проверьте, нет ли ограничений на счета, автомобиль или имущество');
  }

  return items;
}

function generateWhenToSeekHelp(origTitle, description) {
  const text = (origTitle + ' ' + (description || '')).toLowerCase();

  if (text.includes('арест') || text.includes('заблокировал') || text.includes('счет') || text.includes('карт')) {
    return `Обратитесь за анализом, если вы оказались в одной из следующих ситуаций:\n\n• Счёт или карта внезапно заблокированы, а причина непонятна\n• Вы получили уведомление от ЧСИ и не знаете, что делать дальше\n• Вы не согласны с суммой взыскания — она кажется завышенной или содержит незаконные комиссии\n• Вы не получали никаких уведомлений, но деньги уже списываются\n• Взыскатель — банк или МФО, по расчётам которого у вас есть возражения\n• Вы хотите понять, есть ли правовые основания для оспаривания\n\nЧем раньше вы обратитесь — тем больше вариантов действий. Некоторые механизмы защиты (например, возражение нотариусу) имеют строгие сроки: 10 рабочих дней с момента уведомления.`;
  }

  if (text.includes('кредит') || text.includes('займ') || text.includes('задолженность') || text.includes('мфо')) {
    return `Обратитесь за анализом, если:\n\n• Банк или МФО угрожает передать документы нотариусу для исполнительной надписи\n• Исполнительное производство уже возбуждено и счёт арестован\n• С вас требуют сумму значительно больше, чем вы брали — за счёт процентов, пеней и штрафов\n• Вы не получали официальных уведомлений, но деньги исчезают со счёта\n• Вы хотите проверить, бесспорно ли требование кредитора — и есть ли основания для возражения\n• У вас есть документы, подтверждающие оплату части долга, которую кредитор не учитывает\n\nЧем раньше вы проверите ситуацию — тем больше инструментов доступно. Пропущенные сроки существенно сужают возможности.`;
  }

  if (text.includes('авто') || text.includes('запрет регистрационных')) {
    return `Обратитесь, если:\n\n• Вы узнали о запрете регистрационных действий на ваш автомобиль\n• Вы хотите продать, подарить или переоформить авто, но столкнулись с ограничением\n• Сумма долга по исполнительному производству кажется несоразмерной стоимости автомобиля\n• Вы уже погасили долг, но запрет не снят\n• Вы получили несколько запретов от разных производств и не понимаете, как с ними работать\n\nЗапрет на автомобиль снимается только после устранения основания: оплаты долга, отмены исполнительного документа или прекращения производства. Мы помогаем установить основание каждого запрета и определить, что можно сделать.`;
  }

  if (text.includes('мошенни') || text.includes('серых') || text.includes('нелегальн')) {
    return `Обратитесь за анализом, если:\n\n• Взыскание идёт через нотариуса или ЧСИ по договору с МФО или частным займодателем, условия которого вас удивляют\n• Сумма к взысканию значительно превышает сумму займа — за счёт комиссий, штрафов и процентов\n• В договоре были непрозрачные условия или вы подписывали его под давлением\n• Вы сомневаетесь в законности деятельности кредитора\n• Вы хотите проверить, бесспорно ли требование или оно содержит признаки спорности\n\nВажно: наличие задолженности само по себе не означает, что исполнительная надпись совершена законно. Условия договора, расчёт суммы, порядок уведомления — всё это имеет значение при оценке бесспорности требования.`;
  }

  return `Обратитесь за анализом, если вы узнали себя в описанной ситуации или хотите заранее проверить своё положение.\n\nПервый шаг прост: проверьте наличие исполнительных производств по своему ИИН. Большинство арестов выявляются именно так — ещё до того, как деньги фактически списаны или движимость заблокирована.\n\nМы помогаем установить:\n— Основание взыскания (исполнительная надпись, решение суда, штраф, алименты)\n— Имя взыскателя и сумму производства\n— Действия ЧСИ и их соответствие закону\n— Правовой путь: есть ли основания для оспаривания или снятия ограничений\n\nОбращайтесь удобным способом: через форму на сайте, по ИИН или напрямую в WhatsApp.`;
}

/**
 * Build the complete original ZakonExpert analysis for a source item.
 * Kept as one public helper so old database rows that predate the structured
 * fields can be completed at render time without deleting or re-importing them.
 */
function buildGeneratedContent(origTitle, excerpt) {
  return {
    event_summary: generateEventSummary(origTitle, excerpt),
    why_important: generateWhyImportant(origTitle, excerpt),
    legal_commentary: generateLegalCommentary(origTitle, excerpt),
    what_to_check: generateWhatToCheck(origTitle, excerpt),
    when_to_seek_help: generateWhenToSeekHelp(origTitle, excerpt),
  };
}

// ─── IMAGE EXTRACTION ─────────────────────────────────────────────────────────
function normalizeSourceImage(value) {
  if (!value) return null;
  let url = String(value).trim();
  if (url.startsWith('//')) url = `https:${url}`;
  if (!/^https:\/\//i.test(url)) return null;
  if (/\b(?:logo|favicon|icon|avatar|sprite|pixel)\b/i.test(url)) return null;
  if (/(?:news\.google|gstatic|googleusercontent)\./i.test(url)) return null;
  return url;
}

function extractRssImage(item) {
  const candidates = [
    item.mediaContent?.['$']?.url,
    item.mediaThumbnail?.['$']?.url,
    item.enclosure?.url,
    item['media:thumbnail']?.['$']?.url,
  ];
  const rawHtml = item['content:encoded'] || item.content || item.summary || '';
  if (/<img\b/i.test(rawHtml)) {
    const $ = cheerio.load(rawHtml);
    candidates.push($('img').first().attr('src'));
  }
  for (let value of candidates) {
    if (!value) continue;
    const normalized = normalizeSourceImage(value);
    if (normalized) return normalized;
  }
  return null;
}

/**
 * Fetch Open Graph data and a short factual lead for relevance/summary.
 * We deliberately do not copy a publisher's full article: the saved page is
 * an original ZakonExpert analysis with a visible link to the source.
 */
async function fetchPageMeta(url) {
  return new Promise((resolve) => {
    const CancelToken = axios.CancelToken;
    const source = CancelToken.source();
    let chunks = [];
    let totalBytes = 0;
    const MAX_BYTES = 300_000; // enough for heavy heads and the first article paragraphs

    axios.get(url, {
      timeout: 10000,
      responseType: 'stream',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml,*/*;q=0.8',
        'Accept-Encoding': 'gzip, deflate',
      },
      maxRedirects: 5,
      cancelToken: source.token,
    }).then(resp => {
      resp.data.on('data', chunk => {
        chunks.push(chunk);
        totalBytes += chunk.length;
        if (totalBytes >= MAX_BYTES) {
          source.cancel('head_read');
        }
      });
      resp.data.on('end', () => parse(Buffer.concat(chunks)));
      resp.data.on('error', () => resolve({ ogImage: null, pageDesc: '' }));
    }).catch(err => {
      if (axios.isCancel(err) || chunks.length > 0) {
        parse(Buffer.concat(chunks));
      } else {
        resolve({ ogImage: null, pageDesc: '' });
      }
    });

    function parse(buf) {
      try {
        const html = buf.toString('utf8');
        const $ = cheerio.load(html, { decodeEntities: true });
        const ogImage = $('meta[property="og:image"]').attr('content') || null;
        const descMeta = $('meta[name="description"]').attr('content')
          || $('meta[property="og:description"]').attr('content')
          || '';
        const articleLead = $('article p, main p, [itemprop="articleBody"] p')
          .map((_, el) => cleanText($(el).text()))
          .get()
          .find(text => text.length >= 80) || '';
        resolve({ ogImage, pageDesc: cleanText(descMeta || articleLead).substring(0, 600) });
      } catch {
        resolve({ ogImage: null, pageDesc: '' });
      }
    }
  });
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

    // Google News titles sometimes contain " - Source Name" suffix — clean it
    let origTitle = cleanHeadline((item.title || '').trim().replace(/\s+-\s+[^-]{3,40}$/, '').trim());
    if (!origTitle) origTitle = cleanHeadline(item.title || '');

    // Google News RSS links are redirects — use guid as stable dedup key
    const origUrl = item.guid || item.link;
    const displayUrl = item.link || item.guid;
    if (!origTitle || !origUrl) continue;

    // URL dedup
    if (await db.existsByUrl(origUrl)) { duplicate++; continue; }

    const rssExcerpt = cleanText(item.contentSnippet || item.content || item.summary || '')
      .substring(0, 500);

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

    const excerpt = buildExcerpt(rssExcerpt, pageDesc, origTitle);

    // Generate unique structured content from the best available summary,
    // including the source page description when RSS only contains a title.
    const generated = buildGeneratedContent(origTitle, excerpt);

    // Status based on score and env config
    let status = 'draft';
    if (AUTO_PUBLISH && relevanceScore >= MIN_RELEVANCE) status = 'published';
    else if (relevanceScore < 0.2) status = 'rejected';

    const urlHash = origUrl.split('').reduce((a, c) => ((a << 5) - a + c.charCodeAt(0)) | 0, 0);
    const slug         = makeSlug(legalTitle, Math.abs(urlHash));
    const parsedPublishedAt = item.pubDate ? new Date(item.pubDate) : new Date(now);
    const safePublishedAt = Number.isNaN(parsedPublishedAt.getTime()) ? new Date(now) : parsedPublishedAt;
    if (item.pubDate && Date.now() - safePublishedAt.getTime() > MAX_AGE_DAYS * 86400000) {
      rejected++;
      continue;
    }
    const publishedAt  = safePublishedAt.toISOString();
    const canonicalUrl = `https://zakonexpert.kz/news/${slug}`;
    const metaTitle    = legalTitle.substring(0, 65) + ' | ZakonExpert';
    const metaDesc     = excerpt.substring(0, 155) || `Разбор: ${legalTitle.substring(0, 100)}`;

    const rssImg = extractRssImage(item);
    const ogImage = USE_SOURCE_IMAGES
      ? (normalizeSourceImage(rssImg) || normalizeSourceImage(pageOgImg) || null)
      : null;

    // Category cover image (our own SVG — always available)
    const categoryCover = `/img/news/news-cover-${getCoverName(tags)}.svg`;

    const article = {
      // Original source data
      original_title:      origTitle,
      original_url:        origUrl,
      source_url:          displayUrl,
      original_excerpt:    rssExcerpt.substring(0, 400),
      source_name:         source.name,
      source_domain:       source.base_url,
      published_at_source: publishedAt,

      // Our generated content
      title:               legalTitle,
      slug,
      excerpt,
      event_summary:       generated.event_summary,
      why_important:       generated.why_important,
      legal_commentary:    generated.legal_commentary,
      what_to_check:       JSON.stringify(generated.what_to_check),
      when_to_seek_help:   generated.when_to_seek_help,

      // Metadata
      category:          normalizeCategory(source.category, tags),
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
      published_at_site: status === 'published' ? publishedAt : null,
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
let importInProgress = false;

try {
  const savedStatus = JSON.parse(fs.readFileSync(IMPORT_STATUS_FILE, 'utf8'));
  lastImportTime = savedStatus.lastImportTime || null;
  lastImportStats = savedStatus.lastImportStats || null;
} catch (_) {}

async function importAll() {
  if (importInProgress) {
    console.log('[NewsImporter] Import already running; duplicate trigger skipped');
    return 0;
  }
  importInProgress = true;
  try {
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

    const totals = { imported: 0, rejected: 0, duplicate: 0, errors: 0 };

    // Direct publisher feeds usually contain a factual lead and media:content.
    // Process them before Google News search feeds so deduplication keeps the
    // richer original record (with its publisher URL and image).
    const orderedSources = [...sources].sort((a, b) => {
      const aIsAggregator = /news\.google\.com/i.test(a.rss_url || '');
      const bIsAggregator = /news\.google\.com/i.test(b.rss_url || '');
      return Number(aIsAggregator) - Number(bIsAggregator);
    });

    for (const source of orderedSources) {
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

    try {
      fs.writeFileSync(IMPORT_STATUS_FILE, JSON.stringify({ lastImportTime, lastImportStats }, null, 2));
    } catch (e) {
      console.warn('[NewsImporter] Could not persist import status:', e.message);
    }

    await db.compact();

    return totals.imported;
  } finally {
    importInProgress = false;
  }
}

function getLastImportInfo() {
  return { lastImportTime, lastImportStats, importInProgress };
}

module.exports = {
  importAll,
  fetchSource,
  getLastImportInfo,
  buildGeneratedContent,
  fetchPageMeta,
  normalizeSourceImage,
  __test: {
    cleanText,
    cleanHeadline,
    cleanExcerpt,
    buildExcerpt,
    normalizeCategory,
    isPrefilterRelevant,
    buildGeneratedContent,
    normalizeSourceImage,
    extractRssImage,
  },
};
