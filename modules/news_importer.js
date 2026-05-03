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
  'kaspi', 'halyk', 'freedom', 'займ', 'заем', 'рассрочк', 'штраф',
  'банкротств', 'коллектор', 'приставы', 'взыскател', 'дебитор',
  'просрочк', 'неплатёж', 'неплатеж', 'ипотек', 'поручитель'
];

// Topics that are always irrelevant regardless of any keyword match
const IRRELEVANT_TOPICS = [
  'гороскоп', 'зодиак', 'рецепт', 'погода', 'прогноз погоды',
  'кино', 'фильм', 'сериал', 'концерт', 'музыка', 'певец', 'певица',
  'спорт', 'футбол', 'хоккей', 'теннис', 'чемпионат', 'матч',
  'туризм', 'отдых', 'отпуск', 'курорт', 'путешестви',
  'кулинар', 'диета', 'похудени', 'красот', 'мода', 'стиль',
  'свадьба', 'праздник', 'юбилей'
];

function calcRelevance(title, description = '') {
  const text = (title + ' ' + description).toLowerCase();
  // Strong negative check first
  for (const bad of IRRELEVANT_TOPICS) {
    if (text.includes(bad)) return 0;
  }
  let score = 0;
  for (const kw of RELEVANT_KEYWORDS) {
    if (text.includes(kw.toLowerCase())) score += 1;
  }
  return Math.min(score / 3, 1);
}

function isRelevant(title, description, keywords = []) {
  const text = (title + ' ' + (description || '')).toLowerCase();
  // Reject obviously irrelevant topics
  for (const bad of IRRELEVANT_TOPICS) {
    if (text.includes(bad)) return false;
  }
  // Require at least 2 keyword matches for weak sources, 1 for specific sources
  const allKw = [...RELEVANT_KEYWORDS, ...keywords.map(k => k.toLowerCase())];
  const matches = allKw.filter(kw => text.includes(kw.toLowerCase())).length;
  return matches >= 1;
}

function makeSlug(title, suffix) {
  const base = slugify(title, { lower: true, strict: true, locale: 'ru' });
  // Use a short hash of the title for stable slugs (not timestamp-based)
  const hash = suffix.toString().slice(-6);
  return (base || 'news').substring(0, 80) + '-' + hash;
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

/**
 * Transform news title into a legal-angle SEO headline unique to ZakonExpert.
 * Never copies the original title verbatim.
 */
function generateLegalTitle(title, description) {
  const text = (title + ' ' + (description || '')).toLowerCase();

  if (text.includes('мошенни') || text.includes('серых') || text.includes('сомнительн') || text.includes('нелегальн')) {
    return 'Займ у серого кредитора — что грозит вашим счетам и как проверить долг';
  }
  if (text.includes('стоп-кредит') || text.includes('stop kredit') || text.includes('stop-kredit')) {
    return 'Сервис «Стоп-кредит» в Казахстане: как защититься от мошеннических займов и арестов';
  }
  if (text.includes('лицензир') && text.includes('банк')) {
    return 'Лицензирование банков в Казахстане: что изменилось для должников и заёмщиков';
  }
  if (text.includes('арест счет') || text.includes('заблокировал') || text.includes('арест карт')) {
    const bank = text.includes('kaspi') ? 'Kaspi' : text.includes('halyk') ? 'Halyk' : text.includes('freedom') ? 'Freedom' : 'банк';
    return `Арест счёта в ${bank}: почему заблокировали и как снять ограничение`;
  }
  if (text.includes('исполнительн надпис') || text.includes('нотариус')) {
    return 'Исполнительная надпись нотариуса в Казахстане: когда можно оспорить и снять арест';
  }
  if ((text.includes('штраф') && (text.includes('водител') || text.includes('пдд') || text.includes('дорог'))) || text.includes('штраф') && text.includes('нов')) {
    return 'Новые штрафы в Казахстане: что делать, если долг по штрафу попал к ЧСИ';
  }
  if (text.includes('штраф') || text.includes('административ')) {
    return 'Административный штраф у ЧСИ в Казахстане: как снять арест счёта после оплаты';
  }
  if (text.includes('доллар') || text.includes('инфляци') || text.includes('курс') || text.includes('тенге')) {
    return 'Рост курса доллара в Казахстане: как инфляция влияет на долги и аресты счетов';
  }
  if (text.includes('кредит') && (text.includes('мфо') || text.includes('микро'))) {
    return 'МФО и кредитные долги в Казахстане: когда банк подаёт на исполнительную надпись';
  }
  if (text.includes('кредит') || text.includes('займ') || text.includes('задолженность')) {
    return 'Долг по кредиту в Казахстане: что делать, если банк передал дело в ЧСИ';
  }
  if (text.includes('банк') && (text.includes('лицензи') || text.includes('измен') || text.includes('регулир'))) {
    return 'Изменения в банковской сфере Казахстана: что важно знать должнику';
  }
  if (text.includes('банк')) {
    return 'Банки и должники в Казахстане: актуальная ситуация и права заёмщиков';
  }
  if (text.includes('имуществ') || text.includes('недвижим')) {
    return 'Арест имущества в Казахстане: как снять ограничение и запрет на продажу';
  }
  if (text.includes('авто') || text.includes('транспорт')) {
    return 'Запрет на авто в Казахстане: как снять ограничение от ЧСИ на регистрационные действия';
  }
  if (text.includes('алимент')) {
    return 'Долг по алиментам в Казахстане: что делать, если ЧСИ арестовал счёт';
  }
  if (text.includes('самоуправлен') || text.includes('бюджет') || text.includes('финансиров')) {
    return 'Финансирование и долги в Казахстане: как бюджетные изменения влияют на взыскание';
  }
  // generic fallback — add legal angle to original title
  return title.substring(0, 70) + ' — разбор для должников';
}

/**
 * Generate unique article content based on news summary.
 * Does NOT copy original article. Creates our own legal analysis piece.
 */
function generateUniqueContent(originalTitle, rssDescription, scrapedSummary) {
  const text = (originalTitle + ' ' + (rssDescription || '')).toLowerCase();
  const intro = rssDescription ? rssDescription.substring(0, 300).trim() : '';

  let sections = [];

  // Opening: news context (short, attributed)
  sections.push(`Поводом для этого материала послужила публикация в казахстанских СМИ о следующем: ${intro || originalTitle}. Ниже — разбор того, что это означает для людей с долгами и арестами счетов.`);

  // Middle: legal analysis based on topic
  if (text.includes('мошенни') || text.includes('серых') || text.includes('сомнительн')) {
    sections.push('Займы у нелегальных или сомнительных кредиторов — особая зона риска. Такие кредиторы нередко оформляют задолженность через нотариуса в виде исполнительной надписи. При этом условия договора, проценты и комиссии могут быть оформлены с нарушениями. Главный вопрос — бесспорен ли долг? Если нет — есть основания для правового анализа и, при наличии оснований, для возражения на исполнительную надпись.');
    sections.push('Исполнительная надпись применяется только по бесспорным требованиям (ст. 92-1 Закона РК «О нотариате»). Если должник не согласен с суммой, условиями или самим фактом долга — требование уже содержит признаки спорного. В таком случае у должника есть 10 рабочих дней с момента получения уведомления для подачи возражения нотариусу.');
    sections.push('Важно понимать: возражение не означает автоматическую отмену исполнительной надписи. Нотариус рассматривает возражение и, если видит признаки спорности, выносит постановление об отмене в течение 3 рабочих дней. После этого взыскатель может защищать свою позицию только в судебном порядке — уже с полноценным рассмотрением доказательств.');
  } else if (text.includes('стоп-кредит') || text.includes('стоп кредит')) {
    sections.push('Сервис «Стоп-кредит» позволяет гражданам Казахстана запретить выдачу займов на своё имя — это защита от мошеннических кредитов. Однако важно понимать: если мошеннический кредит уже был выдан и по нему вынесена исполнительная надпись или возбуждено исполнительное производство — одного подключения к «Стоп-кредит» недостаточно.');
    sections.push('В случае если арест счёта наложен по долгу, который вы не брали, необходимо: 1) установить номер исполнительного производства; 2) выяснить, на основании какого документа (исполнительная надпись или решение суда); 3) собрать доказательства того, что договор подписан не вами; 4) подать заявление о мошенничестве в правоохранительные органы; 5) одновременно начать процедуру оспаривания исполнительного документа.');
    sections.push('Сам факт мошенничества — если подтверждён документально — является основанием для оспаривания долга. Но процедура зависит от типа документа: исполнительная надпись оспаривается через нотариуса или суд, судебное решение — через апелляцию или заявление об отмене в порядке ГПК РК.');
  } else if (text.includes('доллар') || text.includes('инфляци') || text.includes('курс') || text.includes('тенге')) {
    sections.push('Рост курса доллара и инфляция в Казахстане прямо влияют на должников. Долги, номинированные в тенге, в реальном выражении могут меняться, но исполнительные производства и суммы взыскания фиксируются в тенге по документам. При этом банки и МФО иногда начисляют дополнительные проценты и комиссии в период просрочки — суммы могут существенно расти.');
    sections.push('Если вы видите, что сумма взыскания значительно превышает сумму основного долга — стоит запросить у ЧСИ или нотариуса подробный расчёт. Проценты, неустойки, комиссии банка и расходы ЧСИ — всё это должно быть прозрачно указано. При наличии ошибок в расчёте или завышенных сумм возможно оспаривание.');
    sections.push('Особенно внимательно нужно проверять расходы ЧСИ — оплату деятельности частного судебного исполнителя. Эти суммы регулируются законодательством и не должны быть произвольными. Если расходы завышены или произведённые действия не соответствуют реальным — это повод для оспаривания постановления ЧСИ.');
  } else if (text.includes('штраф') && (text.includes('водител') || text.includes('новые штрафы'))) {
    sections.push('Новые штрафы для водителей — это административные санкции, которые, при неоплате, передаются на исполнение ЧСИ. В отличие от долгов по кредитам, административные штрафы не отменяются через возражение нотариусу — это отдельная правовая процедура.');
    sections.push('Если штраф уже передан ЧСИ и на счёт наложен арест, важно понять: оплачен ли штраф ранее (нередко бывает, что оплата была, но информация не дошла до ЧСИ); не пропущен ли срок обжалования постановления (10 суток по КоАП РК); нет ли ошибок в передаче штрафа на исполнение.');
    sections.push('После полной оплаты штрафа ЧСИ обязан прекратить производство и снять арест. Если этого не происходит — можно подать жалобу на действия ЧСИ. Мы помогаем разобраться в ситуации и убедиться, что снятие ареста произошло корректно и своевременно.');
  } else if (text.includes('лицензир') && text.includes('банк')) {
    sections.push('Изменения в системе лицензирования банков влияют на правила выдачи кредитов, требования к договорам и процедуры взыскания. Для должников это важно: если кредитор работал с нарушениями требований регулятора — это может быть аргументом при оспаривании условий договора или расчёта задолженности.');
    sections.push('Исполнительная надпись нотариуса совершается на основании договора. Если договор заключён с организацией, у которой не было соответствующей лицензии или полномочий, — это ставит под сомнение правомерность самого обязательства. Такие обстоятельства требуют правового анализа документов.');
    sections.push('Практика показывает: многие должники не знают, с кем именно заключили договор — с банком, МФО, коллектором или иной организацией. Уточнение правового статуса взыскателя — первый шаг при работе с долгом.');
  } else if (text.includes('кредит') || text.includes('займ') || text.includes('задолженность')) {
    sections.push('Задолженность по кредиту или займу — самая распространённая причина арестов счетов в Казахстане. Банки и МФО используют два основных пути взыскания: исполнительная надпись нотариуса (внесудебный путь) или обращение в суд. От типа документа зависит, какой инструмент защиты доступен должнику.');
    sections.push('При исполнительной надписи — ключевой вопрос бесспорность требования. Долг является бесспорным, если: есть договор, должник был надлежаще уведомлён, сумма понятна и не оспаривается, срок платежа наступил, требование входит в перечень для исполнительной надписи. Если хотя бы один из этих элементов вызывает сомнение — есть основания для анализа.');
    sections.push('При судебном взыскании — нужно смотреть на тип производства (упрощённое письменное или исковое), был ли ответчик надлежаще извещён, вступило ли решение в силу. Если должник не знал о суде — в ряде случаев можно поставить вопрос об отмене решения или восстановлении срока на обжалование.');
  } else {
    sections.push('Финансовая ситуация в Казахстане напрямую влияет на долговую нагрузку граждан. Изменения в банковской системе, рост инфляции, новые регуляторные решения — всё это меняет условия, при которых банки и МФО взыскивают долги. Должнику важно понимать не только сумму долга, но и механизм взыскания.');
    sections.push('Большинство арестов счетов в Казахстане происходит на основании исполнительной надписи нотариуса или решения суда, переданных ЧСИ. Проверить наличие исполнительных производств можно по ИИН на портале egov.kz. Если производство есть — важно сразу установить: кто взыскатель, какой документ лежит в основе, какова сумма и расходы ЧСИ.');
    sections.push('Законодательство Казахстана предоставляет должнику ряд инструментов защиты — возражение на исполнительную надпись, оспаривание решения суда, жалоба на действия ЧСИ, заявление о рассрочке исполнения. Выбор инструмента зависит от конкретной ситуации, документов и сроков.');
  }

  // Closing
  sections.push('Если вы читаете эту публикацию и узнаёте себя в описанной ситуации — первый шаг прост: проверьте наличие исполнительных производств по своему ИИН. Мы поможем установить основание ареста, определить правовую позицию и принять меры в рамках закона.');

  return sections.join('\n\n');
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

  // Track generated titles in this batch to avoid same-batch duplicates
  const batchTitles = new Set();

  for (const item of (feed.items || [])) {
    const title = (item.title || '').trim();
    const originalUrl = item.link || item.guid;
    if (!title || !originalUrl) continue;

    if (await db.existsByUrl(originalUrl)) continue;

    const rssDescription = (item.contentSnippet || item.content || item.summary || '').replace(/<[^>]+>/g, '').trim().substring(0, 600);
    if (!isRelevant(title, rssDescription, source.keywords || [])) continue;

    // --- Fetch og:image from article page ---
    console.log(`[NewsImporter] Fetching: ${originalUrl}`);
    const { fullText, ogImage: scrapedImage } = await fetchFullContent(originalUrl, source.content_selectors || []);
    await new Promise(r => setTimeout(r, 800)); // polite delay

    const rssImage = extractImageFromRss(item);
    const imageUrl = rssImage || scrapedImage || null;

    // Use RSS description + scraped first sentences as news summary (NOT full copy)
    const scrapedSummary = fullText ? fullText.split('\n\n').slice(0, 3).join('\n\n').substring(0, 600) : '';
    const newsSummary = rssDescription || scrapedSummary;

    const relevanceScore = calcRelevance(title, newsSummary + ' ' + (scrapedSummary || ''));
    const tags = detectTags(title, newsSummary + ' ' + (scrapedSummary || ''));

    // Generate UNIQUE legal-angle content (our own article, not a copy)
    const uniqueTitle = generateLegalTitle(title, newsSummary);

    // Dedup by generated title — skip if same headline already saved or in this batch
    const titleKey = uniqueTitle.toLowerCase().trim().substring(0, 60);
    if (batchTitles.has(titleKey)) continue;
    if (await db.existsByGeneratedTitle(uniqueTitle)) continue;
    batchTitles.add(titleKey);
    const uniqueContent = generateUniqueContent(title, newsSummary, scrapedSummary);
    const legalCommentary = generateLegalCommentary(title, newsSummary, scrapedSummary);
    const whyImportant = generateWhyImportant(title, newsSummary, scrapedSummary);
    const whenToSeekHelp = generateWhenToSeekHelp(title, newsSummary, scrapedSummary);

    const excerpt = newsSummary.substring(0, 280).trim();
    const status = relevanceScore >= 0.25 ? 'published' : 'draft';

    // Generate stable slug from URL hash so re-import doesn't change slugs
    const urlHash = originalUrl.split('').reduce((a, c) => ((a << 5) - a + c.charCodeAt(0)) | 0, 0);
    const slug = makeSlug(uniqueTitle, Math.abs(urlHash));
    const publishedAt = item.pubDate ? new Date(item.pubDate).toISOString() : now;
    const metaTitle = title.substring(0, 65) + ' | ZakonExpert';
    const metaDesc = excerpt.substring(0, 155) || `Разбор новости: ${title.substring(0, 100)}`;
    const canonicalUrl = `https://zakonexpertt.kz/news/${slug}`;

    const article = {
      title: uniqueTitle,           // SEO-transformed title
      original_title: title,        // original source title
      slug,
      source_name: source.name,
      source_url: source.base_url,
      original_url: originalUrl,
      excerpt,
      full_content: uniqueContent,  // our own unique content
      ai_summary: newsSummary.substring(0, 500),
      legal_commentary: legalCommentary,
      why_important: whyImportant,
      when_to_seek_help: whenToSeekHelp,
      category: source.category,
      tags: JSON.stringify(tags),
      status,
      relevance_score: relevanceScore,
      published_at_source: publishedAt,
      published_at_site: status === 'published' ? now : null,
      meta_title: uniqueTitle.substring(0, 65) + ' | ZakonExpert',
      meta_description: metaDesc,
      og_image: imageUrl,
      image_url: imageUrl,
      canonical_url: canonicalUrl,
      created_at: now,
    };

    const result = await db.insertNews(article);
    if (result.changes > 0) {
      imported++;
      console.log(`[NewsImporter] Saved: "${uniqueTitle.substring(0, 60)}" (${uniqueContent.length} chars)`);
    }
  }

  return imported;
}

async function importAll() {
  console.log('[NewsImporter] Starting import at ' + new Date().toLocaleString('ru-RU'));

  // Clean up irrelevant/draft articles before each import cycle
  try {
    const removed = await db.removeIrrelevant();
    if (removed > 0) console.log(`[NewsImporter] Removed ${removed} irrelevant/draft articles`);
  } catch (e) {
    console.warn('[NewsImporter] Cleanup warning: ' + e.message);
  }

  let total = 0;
  for (const source of sources) {
    if (!source.enabled) continue;
    const count = await fetchSource(source);
    console.log(`[NewsImporter] ${source.name}: imported ${count} articles`);
    total += count;
    await new Promise(r => setTimeout(r, 2000)); // pause between sources
  }
  console.log(`[NewsImporter] Done. Total imported: ${total}`);
  return total;
}

module.exports = { importAll, fetchSource };
