require('dotenv').config(); // загружает .env до всего остального

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const helmet = require('helmet');
const compression = require('compression');
const axios = require('axios');
const xml2js = require('xml2js');
const { v4: uuidv4 } = require('uuid');
const cron = require('node-cron');
const winston = require('winston');

// --- ДОБАВЛЕНО: Настройка логгера Winston ---
const logger = winston.createLogger({
  level: 'info', // Минимальный уровень логов для записи (info, warn, error)
  format: winston.format.combine(
    winston.format.timestamp({
      format: 'YYYY-MM-DD HH:mm:ss'
    }),
    winston.format.errors({ stack: true }), // Логировать стек ошибок
    winston.format.splat(),
    winston.format.printf(({ timestamp, level, message, stack }) => {
      return `${timestamp} ${level}: ${stack || message}`; // Включаем стек в вывод, если он есть
    })
  ),
  transports: [
    // Вывод в файл app.log
    new winston.transports.File({ filename: path.join(__dirname, 'app.log'), level: 'info' }),
    // Вывод в консоль (для Plesk stdout/stderr)
    new winston.transports.Console({
        format: winston.format.combine(
            winston.format.colorize(), // Раскрашиваем вывод в консоли
            winston.format.printf(({ timestamp, level, message, stack }) => {
              return `${timestamp} ${level}: ${stack || message}`;
            })
        ),
        level: 'info' // Можно поставить 'debug' для более детального вывода в консоль
    })
  ],
  exceptionHandlers: [ // Логирование необработанных исключений
      new winston.transports.File({ filename: path.join(__dirname, 'exceptions.log') })
  ],
  rejectionHandlers: [ // Логирование необработанных Promise rejections
      new winston.transports.File({ filename: path.join(__dirname, 'rejections.log') })
  ]
});
// --- КОНЕЦ: Настройка логгера Winston ---

// Telegram notifications
const telegram = require('./modules/telegram');

// Initialize DB and news importer
let newsDb = null;
let newsImporter = null;
try {
  newsDb = require('./modules/db');
  newsImporter = require('./modules/news_importer');
  logger.info('News module loaded ✓');
} catch (e) {
  logger.warn('News module not loaded: ' + e.message);
}

// Маскировка ИИН для безопасного логирования
function maskIin(iin) {
    const clean = String(iin || '').replace(/\D/g, '');
    return clean.length >= 4 ? clean.slice(0, 4) + '********' : 'невалидный';
}

const app = express();
const PORT = process.env.PORT || 3000;

// Template engine for news pages
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Middleware — порядок важен: helmet → compression → cors → body-parser → static
app.use(helmet({
    contentSecurityPolicy: false, // отключаем CSP чтобы не ломать CDN Bootstrap/Bootstrap-Icons
}));
app.use(compression());
app.use(cors({
    origin: process.env.CORS_ORIGIN || false, // в production задайте CORS_ORIGIN=https://zakonexpertt.kz
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type'],
}));
app.use(express.json()); // заменяет bodyParser.json()
app.use(express.static(path.join(__dirname, 'public')));

// ===== VISITOR TRACKING =====
const TRACKED_PATHS = new Set([
  '/', '/index.html',
  '/services.html', '/contact.html', '/zakony.html',
  '/arest-kaspi', '/arest-kaspi.html',
  '/arest-halyk-bank', '/arest-halyk-bank.html',
  '/arest-freedom-bank',
  '/ispolnitelnaya-nadpis.html',
  '/snyatie-zapreta-na-avto', '/snyatie-zapreta-na-avto.html',
  '/snyatie-aresta-so-scheta', '/snyatie-aresta-so-scheta.html',
  '/grafik-platezhey.html', '/grafik-oplaty-zadolzhennosti',
  '/chsi-arest-schetov.html',
  '/ubrat-procenty-i-rashody-chsi',
  '/besspornost-dolga.html', '/otmena-resheniya-suda.html',
]);
app.use((req, res, next) => {
  if (req.method === 'GET' && TRACKED_PATHS.has(req.path)) {
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
    const ua = req.headers['user-agent'] || '';
    telegram.notifyVisit(req.path, ip, ua);
  }
  next();
});

// Увеличиваем таймауты для долгих запросов
app.use((req, res, next) => {
    req.setTimeout(600000); // 10 минут
    res.setTimeout(600000); // 10 минут
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Keep-Alive', 'timeout=600');
    next();
});

// Обработка запроса favicon.ico
app.get('/favicon.ico', (req, res) => {
  res.status(204).end();
});

// Основной маршрут
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Утилита для обработки асинхронных запросов
const asyncHandler = fn => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(err => {
      logger.error('Ошибка в асинхронном обработчике:', err); // Логируем ошибку
      next(err); // Передаем ошибку дальше стандартному обработчику Express
  });

// Конфигурация для API eGov
const EGOV_API_URL = "https://data.egov.kz/egov-opendata-ws/ODWebServiceImpl";
const EGOV_API_KEY = process.env.EGOV_API_KEY;

// Проверка обязательных env-переменных при старте
if (!EGOV_API_KEY) {
    logger.error('КРИТИЧНО: Переменная окружения EGOV_API_KEY не задана. Функция проверки ИИН не будет работать. Задайте её в .env файле или в настройках сервера.');
}

// Функция для проверки дополнительных ограничений.
// Источник данных не реализован — возвращает пустой массив.
// Блок "Дополнительные ограничения" на фронте скрыт пока массив пуст.
async function checkRestrictions(iin) {
    return [];
}

// --- НАЧАЛО: Новая функция для проверки должника через API eGov ---
async function checkDebtorViaApi(iin) {
    const formattedIIN = String(iin).replace(/[^\d]/g, '');
    if (formattedIIN.length !== 12) {
        // ИЗМЕНЕНО: logger.warn и ошибка
        const errorMsg = 'ИИН должен содержать 12 цифр';
        logger.warn(`Попытка проверить должника с неверным ИИН: ${maskIin(iin)}`);
        throw new Error(errorMsg);
    }

    const messageId = uuidv4();
    const messageDate = new Date().toISOString().replace(/Z$/, '+06:00');

    const soapBody = `
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:soap="http://soap.opendata.egov.nitec.kz/">
   <soapenv:Header/>
   <soapenv:Body>
      <soap:request>
         <request>
            <requestInfo>
               <messageId>${messageId}</messageId>
               <messageDate>${messageDate}</messageDate>
               <indexName>aisoip</indexName>
               <apiKey>${EGOV_API_KEY}</apiKey>
            </requestInfo>
            <requestData>
               <data xmlns:ns2pep="http://bip.bee.kz/SyncChannel/v10/Types/Request" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:type="ns2pep:RequestMessage">
                  <iinOrBin>${formattedIIN}</iinOrBin>
               </data>
            </requestData>
         </request>
      </soap:request>
   </soapenv:Body>
</soapenv:Envelope>
`;

    const headers = {
        "Content-Type": "text/xml;charset=UTF-8"
    };

    // ИЗМЕНЕНО: logger.info
    if (!EGOV_API_KEY) {
        throw new Error('Сервис временно недоступен. EGOV_API_KEY не настроен. Обратитесь через WhatsApp.');
    }

    logger.info(`Отправка SOAP запроса для ИИН ${maskIin(formattedIIN)} на ${EGOV_API_URL}`);
    try {
        const response = await axios.post(EGOV_API_URL, soapBody, { headers, timeout: 30000 });
        logger.info(`SOAP ответ получен для ИИН ${maskIin(formattedIIN)}. Статус: ${response.status}`);

        const parser = new xml2js.Parser({ explicitArray: false, ignoreAttrs: true });
        const result = await parser.parseStringPromise(response.data);

        const responseInfo = result?.['soap:Envelope']?.['soap:Body']?.['ns1:requestResponse']?.['response']?.['responseInfo'];
        const responseData = result?.['soap:Envelope']?.['soap:Body']?.['ns1:requestResponse']?.['response']?.['responseData']?.['data'];

        // ИЗМЕНЕНО: logger.debug для детального ответа (можно изменить уровень на info при отладке)
        // logger.debug('Response Info:', JSON.stringify(responseInfo, null, 2));
        // logger.debug('Response Data:', JSON.stringify(responseData, null, 2));

        if (!responseInfo) {
            // ИЗМЕНЕНО: logger.error
            logger.error('Не удалось найти responseInfo в ответе API eGov:', JSON.stringify(result, null, 2));
            throw new Error('Некорректный формат ответа от API eGov (отсутствует responseInfo)');
        }

        const debtorDataRows = responseData?.rows;
        const isDebtor = !!debtorDataRows;

        const statusCode = responseInfo?.status?.code;
        const statusMessage = responseInfo?.status?.message;
        // ИЗМЕНЕНО: logger.info
        logger.info(`Результат проверки ИИН ${maskIin(formattedIIN)}: статус '${statusCode}', должник: ${isDebtor}`);

        return {
            isDebtor: isDebtor,
            details: isDebtor ? debtorDataRows : null
        };

    } catch (error) {
        // ИЗМЕНЕНО: logger.error
        logger.error(`Ошибка при вызове API eGov или парсинге ответа для ИИН ${maskIin(formattedIIN)}:`, error);
        if (error.response) {
            // Логируем статус и тело ответа, если ошибка от axios
            logger.error(`Статус ошибки от API: ${error.response.status}`);
            logger.error('Тело ошибки от API:', error.response.data);
            // Перебрасываем более конкретную ошибку
            throw new Error(`Ошибка от API eGov: ${error.response.status} - ${error.response.statusText}. Проверьте тело ответа в логах.`);
        } else if (error.request) {
             // Ошибка отправки запроса (нет ответа)
             logger.error('Ошибка отправки запроса к API eGov (нет ответа):', error.message);
             throw new Error('Не удалось связаться с API eGov. Проверьте сетевое соединение или доступность сервиса.');
        } else {
             // Другая ошибка (настройка запроса, парсинг и т.д.)
             throw new Error(`Внутренняя ошибка при проверке через API eGov: ${error.message}`);
        }
    }
}
// --- КОНЕЦ: Новая функция для проверки должника через API eGov ---


// Маршрут для проверки ИИН
app.post('/check', asyncHandler(async (req, res) => {
    const { iin } = req.body;
    // ИЗМЕНЕНО: logger.info
    logger.info(`Получен запрос на проверку ИИН: ${iin ? iin.substring(0, 4) + '********' : 'пустой'}`); // Маскируем ИИН в логах

    if (!iin) {
        // ИЗМЕНЕНО: logger.warn
        logger.warn('Запрос на проверку без ИИН.');
        return res.status(400).json({ error: 'ИИН не предоставлен' });
    }

    try {
        const debtorResult = await checkDebtorViaApi(iin);
        const restrictionsResult = await checkRestrictions(iin); // Вызываем заглушку

        res.json({
            debtorInfo: debtorResult,
            restrictions: restrictionsResult
        });
        logger.info(`Успешно отправлен ответ для ИИН ${iin.substring(0, 4)}********. Должник найден: ${debtorResult.isDebtor}`);

        // Telegram: уведомление о проверке ИИН
        const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
        const ua = req.headers['user-agent'] || '';
        const details = debtorResult.details;
        const count = Array.isArray(details) ? details.length : (details ? 1 : 0);
        telegram.notifyIinCheck(ip, ua, debtorResult.isDebtor, count, iin);

    } catch (error) {
        // Ошибка уже залогирована в checkDebtorViaApi или asyncHandler
        // ИЗМЕНЕНО: Логируем факт отправки ошибки клиенту
        logger.error(`Отправка ошибки 500 клиенту для ИИН ${iin ? iin.substring(0, 4) + '********' : 'пустой'}: ${error.message}`);
        res.status(500).json({ error: 'Ошибка сервера при проверке должника через API', details: error.message });
    }

}));

// ===== SERVICE PAGE CLEAN URLS =====
const servicePages = {
  '/snyatie-aresta-so-scheta':        'snyatie-aresta-so-scheta.html',
  '/otmena-ispolnitelnoi-nadpisi':     'ispolnitelnaya-nadpis.html',
  '/vozrazhenie-na-ispolnitelnuyu-nadpis': 'spornost-dolga.html',
  '/snyatie-ogranichenii-chsi':        'chsi-arest-schetov.html',
  '/snyatie-zapreta-na-avto':          'snyatie-zapreta-na-avto.html',
  '/snyatie-ogranicheniya-na-imushchestvo': 'snyatie-ogranicheniya-na-imushchestvo.html',
  '/snyatie-zapreta-registracionnyh-deistvii': 'zapret-registracionnyh-deystviy.html',
  '/snyatie-ogranichenii-u-notariusa': 'snyatie-ogranichenii-u-notariusa.html',
  '/grafik-oplaty-zadolzhennosti':     'grafik-platezhey.html',
  '/ubrat-procenty-i-rashody-chsi':    'ubrat-procenty-i-rashody-chsi.html',
  '/arest-kaspi':                      'arest-kaspi.html',
  '/arest-halyk-bank':                 'arest-halyk-bank.html',
  '/arest-freedom-bank':               'arest-freedom-bank.html',
  '/zakony':                           'zakony.html',
  '/ispolnitelnaya-nadpis':            'ispolnitelnaya-nadpis.html',
  '/besspornost-dolga':                'besspornost-dolga.html',
  '/spornost-dolga':                   'spornost-dolga.html',
  '/alimenty-i-aresty':                'alimenty-i-aresty.html',
  '/shtrafy-i-aresty':                 'shtrafy-i-aresty.html',
  '/zapret-registracionnyh-deystviy':  'zapret-registracionnyh-deystviy.html',
  '/grafik-platezhey':                 'grafik-platezhey.html',
  '/privacy':                          'privacy.html',
  '/services':                         'services.html',
  '/contact':                          'contact.html',
};

for (const [route, file] of Object.entries(servicePages)) {
  app.get(route, (req, res) => {
    const filePath = path.join(__dirname, 'public', file);
    if (fs.existsSync(filePath)) {
      res.sendFile(filePath);
    } else {
      res.status(404).sendFile(path.join(__dirname, 'public', 'index.html'));
    }
  });
}

// ===== NEWS ROUTES =====
const NEWS_PER_PAGE = 20;

// NEWS LIST
app.get('/news', asyncHandler(async (req, res) => {
  if (!newsDb) return res.status(503).send('News module not available');
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const category = req.query.cat || null;
  const offset = (page - 1) * NEWS_PER_PAGE;

  const [articles, total] = await Promise.all([
    category ? newsDb.getByCategory(category, NEWS_PER_PAGE, offset) : newsDb.getPublished(NEWS_PER_PAGE, offset),
    category ? newsDb.countByCategory(category) : newsDb.countPublished(),
  ]);
  const totalPages = Math.ceil(total / NEWS_PER_PAGE);

  const canonical = `https://zakonexpertt.kz/news${page > 1 ? '?page=' + page : ''}`;
  const schema = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: 'Новости ZakonExpert',
    url: 'https://zakonexpertt.kz/news',
    numberOfItems: total,
    itemListElement: articles.slice(0, 10).map((a, i) => ({
      '@type': 'ListItem',
      position: offset + i + 1,
      url: `https://zakonexpertt.kz/news/${a.slug}`
    }))
  };

  res.render('news/list', {
    title: 'Новости по арестам счетов и ЧСИ | ZakonExpert',
    description: 'Актуальные новости о банках, арестах счетов, ЧСИ, должниках и законах Казахстана. Юридические комментарии.',
    canonical,
    articles,
    currentPage: page,
    totalPages,
    currentCategory: category,
    schema,
  });
}));

// NEWS CATEGORY
app.get('/news/category/:category', asyncHandler(async (req, res) => {
  if (!newsDb) return res.status(503).send('News module not available');
  res.redirect(301, `/news?cat=${req.params.category}`);
}));

// NEWS RSS FEED
app.get('/news/feed.xml', asyncHandler(async (req, res) => {
  if (!newsDb) return res.status(503).send('News module not available');
  const articles = await newsDb.getPublished(20, 0);
  const items = articles.map(a => `
    <item>
      <title><![CDATA[${a.title}]]></title>
      <link>https://zakonexpertt.kz/news/${a.slug}</link>
      <guid isPermaLink="true">https://zakonexpertt.kz/news/${a.slug}</guid>
      <pubDate>${new Date(a.published_at_site || a.created_at).toUTCString()}</pubDate>
      <description><![CDATA[${a.excerpt || ''}]]></description>
      <category>${a.category || 'general'}</category>
    </item>`).join('');

  res.set('Content-Type', 'application/rss+xml; charset=utf-8');
  res.send(`<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>ZakonExpert — Новости</title>
    <link>https://zakonexpertt.kz/news</link>
    <description>Новости об арестах счетов, ЧСИ и законодательстве Казахстана</description>
    <language>ru</language>
    <atom:link href="https://zakonexpertt.kz/news/feed.xml" rel="self" type="application/rss+xml"/>
    ${items}
  </channel>
</rss>`);
}));

// MAIN RSS FEED
app.get('/feed.xml', (req, res) => res.redirect(301, '/news/feed.xml'));

// SITEMAP-NEWS.XML
app.get('/sitemap-news.xml', asyncHandler(async (req, res) => {
  if (!newsDb) {
    res.set('Content-Type', 'application/xml');
    return res.send('<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>');
  }
  const articles = await newsDb.getAllForSitemap();
  const urls = articles.map(a => `
  <url>
    <loc>https://zakonexpertt.kz/news/${a.slug}</loc>
    <lastmod>${(a.updated_at || a.published_at_site || new Date().toISOString()).substring(0, 10)}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.5</priority>
  </url>`).join('');

  res.set('Content-Type', 'application/xml');
  res.send(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  ${urls}
</urlset>`);
}));

// SITEMAP-PAGES.XML
app.get('/sitemap-pages.xml', (req, res) => {
  const pages = [
    { url: '/', priority: '1.0', freq: 'weekly' },
    { url: '/services.html', priority: '0.9', freq: 'monthly' },
    { url: '/contact.html', priority: '0.8', freq: 'monthly' },
    { url: '/zakony.html', priority: '0.85', freq: 'weekly' },
    { url: '/news', priority: '0.9', freq: 'daily' },
    { url: '/snyatie-aresta-so-scheta', priority: '0.9', freq: 'monthly' },
    { url: '/otmena-ispolnitelnoi-nadpisi', priority: '0.9', freq: 'monthly' },
    { url: '/vozrazhenie-na-ispolnitelnuyu-nadpis', priority: '0.85', freq: 'monthly' },
    { url: '/snyatie-ogranichenii-chsi', priority: '0.85', freq: 'monthly' },
    { url: '/snyatie-zapreta-na-avto', priority: '0.8', freq: 'monthly' },
    { url: '/snyatie-ogranicheniya-na-imushchestvo', priority: '0.8', freq: 'monthly' },
    { url: '/snyatie-zapreta-registracionnyh-deistvii', priority: '0.8', freq: 'monthly' },
    { url: '/snyatie-ogranichenii-u-notariusa', priority: '0.8', freq: 'monthly' },
    { url: '/grafik-oplaty-zadolzhennosti', priority: '0.8', freq: 'monthly' },
    { url: '/ubrat-procenty-i-rashody-chsi', priority: '0.8', freq: 'monthly' },
    { url: '/arest-kaspi', priority: '0.85', freq: 'monthly' },
    { url: '/arest-halyk-bank', priority: '0.85', freq: 'monthly' },
    { url: '/arest-freedom-bank', priority: '0.85', freq: 'monthly' },
  ];
  const today = new Date().toISOString().substring(0, 10);
  const urls = pages.map(p => `
  <url>
    <loc>https://zakonexpertt.kz${p.url}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>${p.freq}</changefreq>
    <priority>${p.priority}</priority>
  </url>`).join('');

  res.set('Content-Type', 'application/xml');
  res.send(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  ${urls}
</urlset>`);
});

// SITEMAP INDEX
app.get('/sitemap-index.xml', (req, res) => {
  const today = new Date().toISOString().substring(0, 10);
  res.set('Content-Type', 'application/xml');
  res.send(`<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <sitemap>
    <loc>https://zakonexpertt.kz/sitemap-pages.xml</loc>
    <lastmod>${today}</lastmod>
  </sitemap>
  <sitemap>
    <loc>https://zakonexpertt.kz/sitemap-news.xml</loc>
    <lastmod>${today}</lastmod>
  </sitemap>
</sitemapindex>`);
});

// NEWS DETAIL (must be after feed.xml and category routes)
app.get('/news/:slug', asyncHandler(async (req, res) => {
  if (!newsDb) return res.status(503).send('News module not available');
  const article = await newsDb.getBySlug(req.params.slug);
  if (!article) return res.status(404).redirect('/news');

  const tagsArr = JSON.parse(article.tags || '[]');
  const relatedRaw = tagsArr.length > 0
    ? await newsDb.getByTags(tagsArr[0])
    : await newsDb.getPublished(5, 0);
  const related = relatedRaw.filter(r => r.slug !== article.slug).slice(0, 4);

  const pubDate = new Date(article.published_at_site || article.created_at);
  const schema = {
    '@context': 'https://schema.org',
    '@type': 'NewsArticle',
    headline: article.title,
    description: article.meta_description || article.excerpt,
    url: `https://zakonexpertt.kz/news/${article.slug}`,
    datePublished: pubDate.toISOString(),
    dateModified: article.updated_at || pubDate.toISOString(),
    publisher: {
      '@type': 'Organization',
      name: 'ZakonExpert',
      url: 'https://zakonexpertt.kz'
    },
    image: article.og_image || 'https://zakonexpertt.kz/img/zakonexpert-logo-kazakhstan.png'
  };

  res.render('news/detail', {
    title: article.meta_title || article.title + ' | ZakonExpert',
    description: article.meta_description || article.excerpt || '',
    canonical: article.canonical_url || `https://zakonexpertt.kz/news/${article.slug}`,
    ogType: 'article',
    ogImage: article.og_image,
    article,
    related,
    schema,
  });
}));

// ADMIN KEY helper
function checkAdminKey(req, res) {
  const adminKey = process.env.ADMIN_KEY;
  if (!adminKey) return true; // no key configured — open
  const provided = req.headers['x-admin-key'] || req.query.key;
  if (provided !== adminKey) {
    res.status(403).json({ error: 'Forbidden — provide x-admin-key header or ?key= param' });
    return false;
  }
  return true;
}

// POST /api/news/import — manual trigger
app.post('/api/news/import', asyncHandler(async (req, res) => {
  if (!checkAdminKey(req, res)) return;
  if (!newsImporter) return res.status(503).json({ error: 'News module not available' });
  const count = await newsImporter.importAll();
  res.json({ ok: true, imported: count });
}));

// GET /api/news/import?key=... — browser-friendly manual trigger
app.get('/api/news/import', asyncHandler(async (req, res) => {
  if (!checkAdminKey(req, res)) return;
  if (!newsImporter) return res.status(503).json({ error: 'News module not available' });
  const count = await newsImporter.importAll();
  res.json({ ok: true, imported: count });
}));

// GET /api/news/clear?key=... — wipe ALL news and re-import
app.get('/api/news/clear', asyncHandler(async (req, res) => {
  if (!checkAdminKey(req, res)) return;
  if (!newsDb || !newsImporter) return res.status(503).json({ error: 'News module not available' });
  await newsDb.clearAll();
  logger.info('[Admin] News DB cleared by admin request');
  res.json({ ok: true, message: 'All news deleted. Run /api/news/import to reload.' });
}));

// GET /api/news/reset?key=... — wipe ALL news AND immediately re-import
app.get('/api/news/reset', asyncHandler(async (req, res) => {
  if (!checkAdminKey(req, res)) return;
  if (!newsDb || !newsImporter) return res.status(503).json({ error: 'News module not available' });
  await newsDb.clearAll();
  logger.info('[Admin] News DB cleared, starting fresh import...');
  // Run import in background, respond immediately
  res.json({ ok: true, message: 'DB cleared. Import started in background. Check /api/news/status in 2-3 minutes.' });
  try {
    const count = await newsImporter.importAll();
    logger.info(`[Admin] Fresh import done. Imported: ${count}`);
  } catch (e) {
    logger.error('[Admin] Fresh import failed: ' + e.message);
  }
}));

// GET /api/news/fix-images?key=... — fetch og:image for existing articles that have none
app.get('/api/news/fix-images', asyncHandler(async (req, res) => {
  if (!checkAdminKey(req, res)) return;
  if (!newsDb) return res.status(503).json({ error: 'News DB not available' });
  res.json({ ok: true, message: 'Image fetch started in background. Check logs.' });
  const axios = require('axios');
  const cheerio = require('cheerio');
  try {
    const articles = await newsDb.getAllWithoutImage();
    logger.info(`[fix-images] Found ${articles.length} articles without og_image`);
    let updated = 0;
    for (const a of articles) {
      const url = a.source_url || a.original_url;
      if (!url || url.startsWith('https://news.google.com')) continue;
      try {
        const resp = await axios.get(url, {
          timeout: 8000,
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ZakonExpert-NewsBot/1.0)' },
          maxRedirects: 3,
          maxContentLength: 300_000,
        });
        const $ = cheerio.load(resp.data);
        const img = $('meta[property="og:image"]').attr('content');
        if (img) {
          await newsDb.updateOgImage(a._id, img);
          updated++;
        }
        await new Promise(r => setTimeout(r, 500));
      } catch (_) {}
    }
    logger.info(`[fix-images] Done. Updated ${updated}/${articles.length}`);
  } catch (e) {
    logger.error('[fix-images] Error: ' + e.message);
  }
}));

// GET /api/news/status — show stats
app.get('/api/news/status', asyncHandler(async (req, res) => {
  if (!checkAdminKey(req, res)) return;
  if (!newsDb) return res.status(503).json({ error: 'News DB not available' });
  const stats    = await newsDb.getStats();
  const importInfo = newsImporter ? newsImporter.getLastImportInfo() : {};
  res.json({
    ok: true,
    ...stats,
    sources: require('./config/news_sources.json').filter(s => s.enabled).length,
    lastImportTime:  importInfo.lastImportTime  || null,
    lastImportStats: importInfo.lastImportStats || null,
    env: {
      AUTO_PUBLISH_NEWS:    process.env.AUTO_PUBLISH_NEWS    || 'true',
      NEWS_MIN_RELEVANCE:   process.env.NEWS_MIN_RELEVANCE   || '0.55',
      NEWS_IMPORT_LIMIT:    process.env.NEWS_IMPORT_LIMIT    || '20',
      NEWS_USE_SOURCE_IMAGES: process.env.NEWS_USE_SOURCE_IMAGES || 'false',
    },
  });
}));

// ===== SCHEDULED NEWS IMPORT (every 4 hours) =====
if (newsImporter) {
  // Run import every 4 hours
  cron.schedule('0 */4 * * *', async () => {
    logger.info('[Cron] Starting scheduled news import...');
    try {
      const count = await newsImporter.importAll();
      logger.info(`[Cron] News import done. Imported: ${count}`);
    } catch (e) {
      logger.error('[Cron] News import failed: ' + e.message);
    }
  });
  logger.info('News cron scheduled: every 4 hours');

  // Run initial import after 10 seconds of server start (if DB is empty)
  setTimeout(async () => {
    try {
      const existing = await newsDb.countPublished();
      if (existing === 0) {
        logger.info('[Startup] No news found, running initial import...');
        await newsImporter.importAll();
        logger.info('[Startup] Initial import done.');
      }
    } catch (e) {
      logger.warn('[Startup] Initial import check failed: ' + e.message);
    }
  }, 10000);
}

// ===== APPLICATION FORM =====
app.post('/api/application', asyncHandler(async (req, res) => {
  const { name, phone, bank, description } = req.body;
  if (!name || !phone) {
    return res.status(400).json({ error: 'Имя и телефон обязательны' });
  }
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
  const ua = req.headers['user-agent'] || '';
  logger.info(`Новая заявка: ${name}, ${phone}, банк: ${bank || '—'}`);
  telegram.notifyApplication({ name, phone, bank, description }, ip, ua);
  res.json({ ok: true });
}));

// ===== TELEGRAM SETUP: определить CHAT_ID =====
app.get('/api/telegram/setup', asyncHandler(async (req, res) => {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    return res.json({ ok: false, error: 'TELEGRAM_BOT_TOKEN не задан в .env' });
  }
  const chatId = await telegram.detectChatId();
  if (!chatId) {
    return res.json({
      ok: false,
      error: 'Сообщений не найдено. Напишите /start боту и обновите страницу.',
      token_hint: `Бот токен задан ✓`,
    });
  }
  // Авто-применяем в runtime (до перезапуска)
  process.env.TELEGRAM_CHAT_ID = chatId;
  await telegram.send(`✅ <b>ZakonExpert подключён!</b>\n\nChat ID: <code>${chatId}</code>\nТеперь уведомления будут приходить сюда.\n\n<i>Добавьте в .env:\nTELEGRAM_CHAT_ID=${chatId}</i>`);
  res.json({ ok: true, chat_id: chatId, note: `Добавьте TELEGRAM_CHAT_ID=${chatId} в .env для постоянной работы` });
}));

// Health-check для мониторинга сервиса
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        service: 'ZakonExpert',
        egovKey: EGOV_API_KEY ? 'configured' : 'missing',
        time: new Date().toISOString()
    });
});

// --- ДОБАВЛЕНО: Централизованный обработчик ошибок Express ---
// Он будет ловить ошибки, переданные через next(err)
app.use((err, req, res, next) => {
  // Логируем ошибку с помощью Winston
  logger.error(`${err.status || 500} - ${err.message} - ${req.originalUrl} - ${req.method} - ${req.ip}`, err);

  // Отправляем общий ответ об ошибке клиенту, если заголовки еще не были отправлены
  if (!res.headersSent) {
    res.status(err.status || 500).json({
      error: 'Внутренняя ошибка сервера',
      details: process.env.NODE_ENV === 'production' ? 'Произошла непредвиденная ошибка.' : err.message // Скрываем детали в продакшене
    });
  } else {
    // Если заголовки уже отправлены, просто делегируем стандартному обработчику Express
    next(err);
  }
});
// --- КОНЕЦ обработчика ошибок ---


// Запуск сервера
app.listen(PORT, '0.0.0.0', () => {
    logger.info(`ZakonExpert сервер запущен на порту ${PORT}`);
    logger.info(`EGOV_API_KEY: ${EGOV_API_KEY ? 'задан ✓' : 'НЕ ЗАДАН — проверка ИИН не будет работать!'}`);
});