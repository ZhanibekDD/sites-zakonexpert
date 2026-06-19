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

// Initialize notaries DB
let notariesDb = null;
let importNotaries = null;
try {
  notariesDb  = require('./modules/notaries-db');
  ({ importNotaries } = require('./scripts/import-notaries'));
  logger.info('Notaries module loaded ✓');
} catch (e) {
  logger.warn('Notaries module not loaded: ' + e.message);
}

// Initialize bailiffs DB
let bailiffsDb = null;
let importBailiffs = null;
try {
  bailiffsDb  = require('./modules/bailiffs-db');
  ({ importBailiffs } = require('./scripts/import-bailiffs'));
  logger.info('Bailiffs module loaded ✓');
} catch (e) {
  logger.warn('Bailiffs module not loaded: ' + e.message);
}

// Initialize lawyers DB
let lawyersDb = null;
let importLawyers = null;
try {
  lawyersDb  = require('./modules/lawyers-db');
  ({ importLawyers } = require('./scripts/import-lawyers'));
  logger.info('Lawyers module loaded ✓');
} catch (e) {
  logger.warn('Lawyers module not loaded: ' + e.message);
}

// Initialize laws DB
let lawsDb = null;
try {
  lawsDb = require('./modules/laws-db');
  logger.info('Laws module loaded ✓');
} catch (e) {
  logger.warn('Laws module not loaded: ' + e.message);
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
  '/advocate',
  '/arest-kaspi', '/arest-kaspi.html',
  '/arest-halyk-bank', '/arest-halyk-bank.html',
  '/arest-freedom-bank', '/arest-freedom-bank.html',
  '/ispolnitelnaya-nadpis.html', '/otmena-ispolnitelnoi-nadpisi',
  '/snyatie-zapreta-na-avto', '/snyatie-zapreta-na-avto.html',
  '/zapret-registracionnyh-deystviy', '/zapret-registracionnyh-deystviy.html',
  '/snyatie-aresta-so-scheta', '/snyatie-aresta-so-scheta.html',
  '/grafik-platezhey.html', '/grafik-oplaty-zadolzhennosti', '/grafik-platezhey',
  '/chsi-arest-schetov.html', '/chsi-arest-schetov',
  '/ubrat-procenty-i-rashody-chsi',
  '/besspornost-dolga.html', '/besspornost-dolga',
  '/alimenty-i-aresty', '/alimenty-i-aresty.html',
  '/shtrafy-i-aresty', '/shtrafy-i-aresty.html',
  '/snyatie-ogranicheniya-na-imushchestvo',
  '/snyatie-ogranichenii-u-notariusa',
  '/otmena-resheniya-suda.html',
  '/spornost-dolga',
  '/chsi-refinansirovanie',
  '/notaries', '/bailiffs', '/lawyers',
  '/notary-search', '/bailiff-search', '/lawyer-search',
  '/news', '/statyi',
]);
app.use((req, res, next) => {
  if (req.method === 'GET' && TRACKED_PATHS.has(req.path)) {
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
    const ua = req.headers['user-agent'] || '';
    const referer = req.headers['referer'] || req.headers['referrer'] || '';
    telegram.notifyVisit(req.path, ip, ua, referer);
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

// ===== NOTARY SEARCH =====
app.get('/notary-search', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'notary-search.html'));
});

app.get('/api/notary-search', asyncHandler(async (req, res) => {
  const cheerio = require('cheerio');
  const { fio = '', phone = '', license = '', region = '0' } = req.query;
  if (!fio && !phone && !license) {
    return res.status(400).json({ error: 'Укажите ФИО, телефон или номер лицензии' });
  }
  const params = new URLSearchParams({ fio, region, city: '', phoneNumber: phone, licenseNumber: license });
  const url = `https://enis.kz/NotarySearch/Details/?${params}`;
  try {
    const resp = await axios.get(url, { timeout: 15000, headers: { 'User-Agent': 'Mozilla/5.0' } });
    const $ = cheerio.load(resp.data);
    const countText = $('b').filter((i, el) => $(el).text().includes('Найдено записей')).first().text();
    const total = parseInt(countText.match(/\d+/)?.[0] || '0');
    const notaries = [];
    $('font[face="Arial"]').each((i, el) => {
      const font = $(el);
      const nameEl = font.find('a').first();
      const name = nameEl.text().trim();
      if (!name) return;
      const href = nameEl.attr('href') || '';
      const id = href.match(/\/(\d+)$/)?.[1] || '';
      const inner = font.html() || '';
      const parts = inner.split(/<br\s*\/?>/i);
      let address = '', phone2 = '', workHours = '', email = '';
      for (const part of parts) {
        const clean = part.replace(/<[^>]+>/g, '').trim();
        if (clean.startsWith('Адрес:')) address = clean.replace('Адрес:', '').trim();
        else if (clean.startsWith('Телефон:')) phone2 = clean.replace('Телефон:', '').trim();
        else if (clean.startsWith('Режим работы:')) workHours = clean.replace('Режим работы:', '').trim();
        else if (clean.startsWith('Электронный адрес:')) email = clean.replace('Электронный адрес:', '').trim();
      }
      notaries.push({ id, name, address, phone: phone2, workHours, email,
        url: id ? `https://enis.kz/Notary/Details/${id}` : '' });
    });
    res.json({ total, notaries });
  } catch (e) {
    logger.error('Notary search error:', e.message);
    res.status(500).json({ error: 'Не удалось получить данные с enis.kz' });
  }
}));

// ===== NOTARY SEO PAGES =====

// Individual notary page
app.get('/notary/:slug', asyncHandler(async (req, res) => {
  if (!notariesDb) return res.status(503).send('Notary module not available');
  const notary = await notariesDb.findBySlug(req.params.slug);
  if (!notary) return res.status(404).redirect('/notary-search');
  res.render('notary/page', { notary });
}));

// Sitemap for notary pages
app.get('/sitemap-notaries.xml', asyncHandler(async (req, res) => {
  res.set('Content-Type', 'application/xml');
  if (!notariesDb) {
    return res.send('<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>');
  }
  const [all, regions] = await Promise.all([notariesDb.getAllSlugs(), notariesDb.getRegions()]);
  const lastUpdated = await notariesDb.getLastUpdated();
  const lastmod = lastUpdated ? new Date(lastUpdated).toISOString().substring(0, 10) : new Date().toISOString().substring(0, 10);
  const regionUrls = regions.map(r => `
  <url>
    <loc>https://zakonexpertt.kz/notaries?region=${encodeURIComponent(r)}</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.75</priority>
  </url>`).join('');
  const profileUrls = all.map(n => `
  <url>
    <loc>https://zakonexpertt.kz/notary/${n.slug}</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.6</priority>
  </url>`).join('');
  res.send(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  ${regionUrls}
  ${profileUrls}
</urlset>`);
}));

// Admin: manual notary import trigger
app.get('/api/notaries/import', asyncHandler(async (req, res) => {
  if (!checkAdminKey(req, res)) return;
  if (!importNotaries) return res.status(503).json({ error: 'Notary module not available' });
  const count = await importNotaries();
  res.json({ ok: true, imported: count });
}));

// ===== BAILIFF SEARCH =====
app.get('/bailiff-search', asyncHandler(async (req, res) => {
  const q = (req.query.q || '').trim();
  let results = null;
  if (q.length >= 2 && bailiffsDb) {
    results = await bailiffsDb.search(q);
  } else if (q.length >= 2) {
    results = [];
  }
  res.render('bailiff/search', { query: q, results });
}));

// ===== CATALOG PAGES =====

app.get('/notaries', asyncHandler(async (req, res) => {
  const region = (req.query.region || '').trim();
  if (!notariesDb) return res.status(503).send('Notary module not available');
  if (region) {
    const regionItems = await notariesDb.findByRegion(region);
    const allRegions = await notariesDb.getRegions();
    return res.render('notary/catalog', { selectedRegion: region, allRegions, regionItems });
  }
  const allRegions = await notariesDb.getRegions();
  res.render('notary/catalog', { selectedRegion: '', allRegions, regionItems: [] });
}));

app.get('/bailiffs', asyncHandler(async (req, res) => {
  const region = (req.query.region || '').trim();
  if (!bailiffsDb) return res.status(503).send('Bailiff module not available');
  if (region) {
    const regionItems = await bailiffsDb.findByRegion(region);
    const allRegions = await bailiffsDb.getRegions();
    return res.render('bailiff/catalog', { selectedRegion: region, allRegions, regionItems });
  }
  const allRegions = await bailiffsDb.getRegions();
  res.render('bailiff/catalog', { selectedRegion: '', allRegions, regionItems: [] });
}));

app.get('/lawyers', asyncHandler(async (req, res) => {
  const region = (req.query.region || '').trim();
  if (!lawyersDb) return res.status(503).send('Lawyer module not available');
  if (region) {
    const regionItems = await lawyersDb.findByRegion(region);
    const allRegions = await lawyersDb.getRegions();
    return res.render('lawyer/catalog', { selectedRegion: region, allRegions, regionItems });
  }
  const allRegions = await lawyersDb.getRegions();
  res.render('lawyer/catalog', { selectedRegion: '', allRegions, regionItems: [] });
}));

// ===== LAWYER SEARCH =====
app.get('/lawyer-search', asyncHandler(async (req, res) => {
  const q = (req.query.q || '').trim();
  let results = null;
  if (q.length >= 2 && lawyersDb) {
    results = await lawyersDb.search(q);
  } else if (q.length >= 2) {
    results = [];
  }
  res.render('lawyer/search', { query: q, results });
}));

// ===== BAILIFF SEO PAGES =====

app.get('/bailiff/:slug', asyncHandler(async (req, res) => {
  if (!bailiffsDb) return res.status(503).send('Bailiff module not available');
  const bailiff = await bailiffsDb.findBySlug(req.params.slug);
  if (!bailiff) return res.status(404).redirect('/bailiff-search');
  res.render('bailiff/page', { bailiff });
}));

app.get('/sitemap-bailiffs.xml', asyncHandler(async (req, res) => {
  res.set('Content-Type', 'application/xml');
  if (!bailiffsDb) {
    return res.send('<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>');
  }
  const [all, regions] = await Promise.all([bailiffsDb.getAllSlugs(), bailiffsDb.getRegions()]);
  const lastUpdated = await bailiffsDb.getLastUpdated();
  const lastmod = lastUpdated ? new Date(lastUpdated).toISOString().substring(0, 10) : new Date().toISOString().substring(0, 10);
  const regionUrls = regions.map(r => `
  <url>
    <loc>https://zakonexpertt.kz/bailiffs?region=${encodeURIComponent(r)}</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.75</priority>
  </url>`).join('');
  const profileUrls = all.map(b => `
  <url>
    <loc>https://zakonexpertt.kz/bailiff/${b.slug}</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.6</priority>
  </url>`).join('');
  res.send(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  ${regionUrls}
  ${profileUrls}
</urlset>`);
}));

app.get('/api/bailiffs/import', asyncHandler(async (req, res) => {
  if (!checkAdminKey(req, res)) return;
  if (!importBailiffs) return res.status(503).json({ error: 'Bailiff module not available' });
  const count = await importBailiffs();
  res.json({ ok: true, imported: count });
}));

// ===== LAWYER SEO PAGES =====

app.get('/lawyer/:slug', asyncHandler(async (req, res) => {
  if (!lawyersDb) return res.status(503).send('Lawyer module not available');
  const lawyer = await lawyersDb.findBySlug(req.params.slug);
  if (!lawyer) return res.status(404).redirect('/lawyer-search');
  res.render('lawyer/page', { lawyer });
}));

app.get('/sitemap-lawyers.xml', asyncHandler(async (req, res) => {
  res.set('Content-Type', 'application/xml');
  if (!lawyersDb) {
    return res.send('<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>');
  }
  const all = await lawyersDb.getAllSlugs();
  const lastUpdated = await lawyersDb.getLastUpdated();
  const lastmod = lastUpdated ? new Date(lastUpdated).toISOString().substring(0, 10) : new Date().toISOString().substring(0, 10);
  const urls = all.map(l => `
  <url>
    <loc>https://zakonexpertt.kz/lawyer/${l.slug}</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.6</priority>
  </url>`).join('');
  res.send(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  ${urls}
</urlset>`);
}));

app.get('/sitemap-laws.xml', asyncHandler(async (req, res) => {
  res.set('Content-Type', 'application/xml');
  if (!lawsDb) {
    return res.send('<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>');
  }
  const all = await lawsDb.getAllSlugs();
  const today = new Date().toISOString().substring(0, 10);
  const urls = all.map(a => `
  <url>
    <loc>https://zakonexpertt.kz/statya/${a.slug}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.7</priority>
  </url>`).join('');
  res.send(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  ${urls}
</urlset>`);
}));

app.get('/api/lawyers/import', asyncHandler(async (req, res) => {
  if (!checkAdminKey(req, res)) return;
  if (!importLawyers) return res.status(503).json({ error: 'Lawyer module not available' });
  const count = await importLawyers();
  res.json({ ok: true, imported: count });
}));

// ===== ADVOCATE PAGE =====
app.get('/advocate', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'advocate.html'));
});

// ===== LAWS PAGES =====

// Search API (JSON)
app.get('/api/statyi/search', asyncHandler(async (req, res) => {
  if (!lawsDb) return res.json({ results: [] });
  const q    = (req.query.q    || '').trim();
  const code = (req.query.code || '').trim();
  const results = await lawsDb.search(q, code, 30);
  res.json({ results });
}));

// List / search page
app.get('/statyi', asyncHandler(async (req, res) => {
  if (!lawsDb) return res.redirect('/zakony.html');
  const q    = (req.query.q    || '').trim();
  const code = (req.query.code || '').trim();
  const [articles, codes] = await Promise.all([
    code && !q ? lawsDb.findByCode(code, 60)
    : q        ? lawsDb.search(q, code, 60)
    :            Promise.resolve([]),
    lawsDb.getCodes(),
  ]);
  res.render('laws/list', { q, code, articles, codes, total: articles.length });
}));

// Individual article page
app.get('/statya/:slug', asyncHandler(async (req, res) => {
  if (!lawsDb) return res.redirect('/statyi');
  const article = await lawsDb.findBySlug(req.params.slug);
  if (!article) return res.status(404).sendFile(path.join(__dirname, 'public', '404.html')).catch(() => res.status(404).send('Статья не найдена'));
  const [adjacent, related, codes] = await Promise.all([
    lawsDb.adjacent(article.code, article.numInt),
    lawsDb.findByCode(article.code, 6).then(all =>
      all.filter(a => a.slug !== article.slug && Math.abs(a.numInt - article.numInt) <= 5).slice(0, 4)
    ),
    lawsDb.getCodes(),
  ]);
  res.render('laws/article', { article, adjacent, related, codes });
}));

// ===== BANKRUPTCY CHECK (tazalau.qoldau.kz) =====
app.get('/api/bankruptcy-check', asyncHandler(async (req, res) => {
  const iin = (req.query.iin || '').replace(/\D/g, '');
  if (iin.length !== 12) return res.status(400).json({ error: 'Укажите корректный ИИН (12 цифр)' });

  const cheerio = require('cheerio');
  const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml',
    'Accept-Language': 'ru-RU,ru;q=0.9',
    'Referer': 'https://tazalau.qoldau.kz/',
  };

  function parseHtmlTable(html) {
    try {
      const $ = cheerio.load(html);
      const headers = [];
      // Try thead th first, fallback to first tr > th
      const headCells = $('table thead th').length
        ? $('table thead th')
        : $('table tr:first-child th');
      headCells.each((i, th) => {
        headers.push($(th).text().trim().replace(/\s+/g, ' '));
      });
      const rows = [];
      $('table tbody tr').each((i, tr) => {
        const cells = [];
        $(tr).find('td').each((j, td) => {
          cells.push($(td).text().trim().replace(/\s+/g, ' '));
        });
        if (cells.some(c => c)) rows.push(cells);
      });
      const totalText = $('small').filter((i, el) => $(el).text().includes('Всего')).parent().text();
      const total = parseInt(totalText.match(/\d+/)?.[0] || '0');
      return { headers, rows, total };
    } catch (e) { return { headers: [], rows: [], total: 0 }; }
  }

  const [r1, r2, r3] = await Promise.allSettled([
    axios.get(`https://tazalau.qoldau.kz/ru/list/bankruptcy-and-insolvent?flApplicantIin=${iin}`, { headers: HEADERS, timeout: 15000 }),
    axios.get(`https://tazalau.qoldau.kz/ru/list/bankruptcy/judicial?flApplicantXin=${iin}`, { headers: HEADERS, timeout: 15000 }),
    axios.get(`https://tazalau.qoldau.kz/ru/list/bankruptcy/recovery?flApplicantXin=${iin}`, { headers: HEADERS, timeout: 15000 }),
  ]);

  res.json({
    outOfCourt: r1.status === 'fulfilled' ? parseHtmlTable(r1.value.data) : { rows: [], total: 0, error: r1.reason?.message },
    judicial:   r2.status === 'fulfilled' ? parseHtmlTable(r2.value.data) : { rows: [], total: 0, error: r2.reason?.message },
    recovery:   r3.status === 'fulfilled' ? parseHtmlTable(r3.value.data) : { rows: [], total: 0, error: r3.reason?.message },
  });
}));

// ===== ERDR CHECK (service.prosecutor.kz) =====
app.get('/api/erdr-check', asyncHandler(async (req, res) => {
  const erdr = (req.query.erdr || '').trim();
  const iin  = (req.query.iin  || '').replace(/\D/g, '');
  if (!erdr && iin.length !== 12) {
    return res.status(400).json({ error: 'Укажите номер ЕРДР или ИИН (12 цифр)' });
  }

  const cheerio = require('cheerio');
  const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'ru-RU,ru;q=0.9,kk;q=0.8',
    'Referer': 'https://service.prosecutor.kz/ru/service/erd',
  };

  function parseErdrTable(html) {
    const $ = cheerio.load(html);
    const headers = [];
    $('table thead th, table tr:first-child th').each((i, th) => {
      headers.push($(th).text().trim().replace(/\s+/g, ' '));
    });
    const rows = [];
    $('table tbody tr').each((i, tr) => {
      const cells = [];
      $(tr).find('td').each((j, td) => cells.push($(td).text().trim().replace(/\s+/g, ' ')));
      if (cells.some(c => c)) rows.push(cells);
    });
    return { headers, rows };
  }

  try {
    let url;
    if (erdr) {
      url = `https://service.prosecutor.kz/ru/service/erd?regNumber=${encodeURIComponent(erdr)}`;
    } else {
      url = `https://service.prosecutor.kz/ru/service/erd?iin=${iin}`;
    }
    const r = await axios.get(url, { headers: HEADERS, timeout: 20000 });
    const { headers, rows } = parseErdrTable(r.data);
    return res.json({ headers, rows, query: erdr || iin });
  } catch (e) {
    return res.status(502).json({ error: 'Не удалось получить данные от service.prosecutor.kz: ' + e.message });
  }
}));

// ===== EXECUTIVE INSCRIPTION CAPTCHA (enis.kz) =====
const inscriptionSessions = new Map(); // sid → { cookie, captchaUrl }

app.get('/api/inscription-session', asyncHandler(async (req, res) => {
  const cheerio = require('cheerio');
  const PAGE_URL = 'https://enis.kz/CheckExecutiveInscription';
  try {
    const r = await axios.get(PAGE_URL, {
      timeout: 15000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml',
      },
      maxRedirects: 5,
    });
    const setCookie = r.headers['set-cookie'];
    const cookie = setCookie ? setCookie.map(c => c.split(';')[0]).join('; ') : '';
    const $ = cheerio.load(r.data);
    const captchaImg = $('img[src*="aptcha"], img[src*="captcha"], img[id*="captcha"], img[id*="Captcha"]').first().attr('src')
      || $('img').filter((i, el) => /captcha/i.test($(el).attr('src') || '')).first().attr('src')
      || $('img').filter((i, el) => /captcha/i.test($(el).attr('id') || '')).first().attr('src');
    const token = $('input[name="__RequestVerificationToken"]').val() || '';
    const sid = Math.random().toString(36).slice(2);
    inscriptionSessions.set(sid, { cookie, captchaUrl: captchaImg ? new URL(captchaImg, PAGE_URL).href : null, token });
    setTimeout(() => inscriptionSessions.delete(sid), 5 * 60 * 1000);
    res.json({ sid, hasCaptcha: !!captchaImg, captchaUrl: captchaImg });
  } catch (e) {
    logger.error('[Inscription] Session fetch error:', e.message);
    res.status(502).json({ error: 'Не удалось получить страницу enis.kz: ' + e.message });
  }
}));

app.get('/api/inscription-captcha', asyncHandler(async (req, res) => {
  const { sid } = req.query;
  const sess = inscriptionSessions.get(sid);
  if (!sess || !sess.captchaUrl) return res.status(404).send('Сессия не найдена');
  try {
    const r = await axios.get(sess.captchaUrl, {
      responseType: 'arraybuffer', timeout: 10000,
      headers: { 'Cookie': sess.cookie, 'Referer': 'https://enis.kz/CheckExecutiveInscription',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
    });
    res.set('Content-Type', r.headers['content-type'] || 'image/png');
    res.set('Cache-Control', 'no-store');
    res.send(r.data);
  } catch (e) {
    res.status(502).send('Ошибка получения капчи');
  }
}));

app.post('/api/inscription-check', asyncHandler(async (req, res) => {
  const { sid, iin, captcha } = req.body;
  const sess = sid ? inscriptionSessions.get(sid) : null;
  const formData = new URLSearchParams();
  formData.append('ClientIIN', iin || '');
  formData.append('Captcha', captcha || '');
  formData.append('Check', 'Проверить');
  if (sess?.token) formData.append('__RequestVerificationToken', sess.token);

  const reqHeaders = {
    'Content-Type': 'application/x-www-form-urlencoded',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Referer': 'https://enis.kz/CheckExecutiveInscription',
    'Origin': 'https://enis.kz',
  };
  if (sess?.cookie) reqHeaders['Cookie'] = sess.cookie;

  try {
    const r = await axios.post('https://enis.kz/CheckExecutiveInscription', formData.toString(), {
      headers: reqHeaders, timeout: 15000, maxRedirects: 5,
    });
    const cheerio = require('cheerio');
    const $ = cheerio.load(r.data);
    const resultBlock = $('h3').filter((i, el) => $(el).text().includes('исполнительной надписи')).parent();
    const html = resultBlock.html() || r.data;
    const text = $('body').text();
    const hasResult = /Дата совершения|Нотариус|исполнительн/i.test(text);
    const wrongCaptcha = /неверн|капча|captcha|wrong/i.test(text);
    if (wrongCaptcha) return res.json({ ok: false, error: 'Неверная капча. Попробуйте снова.' });
    if (!hasResult) return res.json({ ok: false, error: 'Исполнительная надпись не найдена или ИИН неверен.', raw: text.substring(0, 500) });
    const parsed = {};
    html.replace(/<b>([^<]+):<\/b>\s*([^<\n]+)/g, (m, key, val) => { parsed[key.trim()] = val.trim(); });
    res.json({ ok: true, parsed, html });
  } catch (e) {
    logger.error('[Inscription] Check error:', e.message);
    res.status(502).json({ error: 'Ошибка запроса к enis.kz: ' + e.message });
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
  '/chsi-refinansirovanie':            'chsi-refinansirovanie.html',
  '/otmena-resheniya-suda':            'otmena-resheniya-suda.html',
  '/dokumenty':                        'dokumenty.html',
  '/rezultaty':                        'rezultaty.html',
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
    { url: '/notaries', priority: '0.85', freq: 'weekly' },
    { url: '/bailiffs', priority: '0.85', freq: 'weekly' },
    { url: '/lawyers', priority: '0.85', freq: 'weekly' },
    { url: '/notary-search', priority: '0.8', freq: 'weekly' },
    { url: '/bailiff-search', priority: '0.8', freq: 'weekly' },
    { url: '/lawyer-search', priority: '0.8', freq: 'weekly' },
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
    // Дополнительные сервисные страницы
    { url: '/besspornost-dolga', priority: '0.8', freq: 'monthly' },
    { url: '/alimenty-i-aresty', priority: '0.8', freq: 'monthly' },
    { url: '/shtrafy-i-aresty', priority: '0.8', freq: 'monthly' },
    { url: '/zakony', priority: '0.85', freq: 'weekly' },
    { url: '/advocate', priority: '0.85', freq: 'monthly' },
    { url: '/ispolnitelnaya-nadpis', priority: '0.85', freq: 'monthly' },
    { url: '/spornost-dolga', priority: '0.75', freq: 'monthly' },
    { url: '/zapret-registracionnyh-deystviy', priority: '0.75', freq: 'monthly' },
    { url: '/grafik-platezhey', priority: '0.75', freq: 'monthly' },
    { url: '/chsi-refinansirovanie',   priority: '0.8', freq: 'monthly' },
    { url: '/otmena-resheniya-suda',   priority: '0.8', freq: 'monthly' },
    { url: '/dokumenty',               priority: '0.8', freq: 'monthly' },
    { url: '/rezultaty',             priority: '0.7', freq: 'monthly' },
    { url: '/privacy', priority: '0.3', freq: 'yearly' },
    // Законы — разделы
    { url: '/statyi', priority: '0.85', freq: 'weekly' },
    { url: '/statyi?code=uk', priority: '0.8', freq: 'monthly' },
    { url: '/statyi?code=koap', priority: '0.8', freq: 'monthly' },
    { url: '/statyi?code=gk', priority: '0.8', freq: 'monthly' },
    { url: '/statyi?code=tk', priority: '0.8', freq: 'monthly' },
    { url: '/statyi?code=sk', priority: '0.8', freq: 'monthly' },
    { url: '/statyi?code=upk', priority: '0.75', freq: 'monthly' },
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
  <sitemap>
    <loc>https://zakonexpertt.kz/sitemap-notaries.xml</loc>
    <lastmod>${today}</lastmod>
  </sitemap>
  <sitemap>
    <loc>https://zakonexpertt.kz/sitemap-bailiffs.xml</loc>
    <lastmod>${today}</lastmod>
  </sitemap>
  <sitemap>
    <loc>https://zakonexpertt.kz/sitemap-lawyers.xml</loc>
    <lastmod>${today}</lastmod>
  </sitemap>
  <sitemap>
    <loc>https://zakonexpertt.kz/sitemap-laws.xml</loc>
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

// ===== NOTARY + BAILIFF + LAWYER DB: auto-import on startup if empty or CSV is newer =====
setTimeout(async () => {
  if (importNotaries) {
    try {
      const count = await importNotaries();
      if (count > 0) logger.info(`[Notaries] DB ready: ${count} notaries`);
    } catch (e) { logger.warn('[Notaries] Startup import failed: ' + e.message); }
  }
  if (importBailiffs) {
    try {
      const count = await importBailiffs();
      if (count > 0) logger.info(`[Bailiffs] DB ready: ${count} bailiffs`);
    } catch (e) { logger.warn('[Bailiffs] Startup import failed: ' + e.message); }
  }
  if (importLawyers) {
    try {
      const count = await importLawyers();
      if (count > 0) logger.info(`[Lawyers] DB ready: ${count} lawyers`);
    } catch (e) { logger.warn('[Lawyers] Startup import failed: ' + e.message); }
  }
}, 5000);

// Weekly re-import every Sunday at 03:00 (after pushing fresh CSVs to git)
cron.schedule('0 3 * * 0', async () => {
  logger.info('[Cron] Weekly notary+bailiff+lawyer re-import starting...');
  if (importNotaries) {
    try { const n = await importNotaries(); logger.info(`[Cron] Notaries: ${n}`); }
    catch (e) { logger.error('[Cron] Notary re-import failed: ' + e.message); }
  }
  if (importBailiffs) {
    try { const n = await importBailiffs(); logger.info(`[Cron] Bailiffs: ${n}`); }
    catch (e) { logger.error('[Cron] Bailiff re-import failed: ' + e.message); }
  }
  if (importLawyers) {
    try { const n = await importLawyers(); logger.info(`[Cron] Lawyers: ${n}`); }
    catch (e) { logger.error('[Cron] Lawyer re-import failed: ' + e.message); }
  }
});
logger.info('Notary+Bailiff+Lawyer cron scheduled: every Sunday 03:00');

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