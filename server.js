require('dotenv').config(); // загружает .env до всего остального

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const helmet = require('helmet');
const compression = require('compression');
const axios = require('axios');
const xml2js = require('xml2js');
const { v4: uuidv4 } = require('uuid');
const cron = require('node-cron');
const winston = require('winston');

const LOG_MAX_SIZE = 2 * 1024 * 1024;
const LOG_MAX_FILES = 2;
const RELEASE_ID = '2026-08-03-targeted-company-quality-fix';

function fileLog(filename, level) {
  return new winston.transports.File({
    filename: path.join(__dirname, filename),
    level,
    maxsize: LOG_MAX_SIZE,
    maxFiles: LOG_MAX_FILES,
    tailable: true,
  });
}

function consoleLog() {
  return new winston.transports.Console({
    format: winston.format.combine(
      winston.format.colorize(),
      winston.format.printf(({ timestamp, level, message, stack }) => {
        return `${timestamp} ${level}: ${stack || message}`;
      })
    ),
    level: 'info',
  });
}

// Plesk captures stdout/stderr. File logs are opt-in and always rotated, so
// an unattended application can no longer fill the hosting disk.
const FILE_LOGS_ENABLED = /^(1|true|yes)$/i.test(process.env.FILE_LOGS_ENABLED || '');

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true }),
    winston.format.splat(),
    winston.format.printf(({ timestamp, level, message, stack }) => {
      return `${timestamp} ${level}: ${stack || message}`;
    })
  ),
  transports: [consoleLog(), ...(FILE_LOGS_ENABLED ? [fileLog('app.log', 'info')] : [])],
  exceptionHandlers: [consoleLog(), ...(FILE_LOGS_ENABLED ? [fileLog('exceptions.log', 'error')] : [])],
  rejectionHandlers: [consoleLog(), ...(FILE_LOGS_ENABLED ? [fileLog('rejections.log', 'error')] : [])],
});

// Telegram notifications
const telegram = require('./modules/telegram');
const { lowContentBoost } = require('./modules/seo-blocks');
const { TOOLS, findTool } = require('./modules/tools-catalog');
const {
  INDEXABLE_LOCALES: COMPANY_LOCALES,
  catalogAlternates,
  catalogPath: companyCatalogPathFor,
  companyPath: companyPathFor,
  getLocale: getCompanyLocale,
} = require('./modules/company-i18n');

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
let refreshNotariesRegistry = null;
try {
  notariesDb  = require('./modules/notaries-db');
  ({ importNotaries } = require('./scripts/import-notaries'));
  ({ refreshNotariesRegistry } = require('./scripts/refresh-notaries-csv'));
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

// Initialize comments DB
let commentsDb = null;
try {
  commentsDb = require('./modules/comments-db');
  logger.info('Comments module loaded ✓');
} catch (e) {
  logger.warn('Comments module not loaded: ' + e.message);
}

// Initialize lawyers DB
let lawyersDb = null;
let importLawyers = null;
let refreshLawyersRegistry = null;
try {
  lawyersDb  = require('./modules/lawyers-db');
  ({ importLawyers } = require('./scripts/import-lawyers'));
  ({ refreshLawyersRegistry } = require('./scripts/refresh-lawyers-registry'));
  logger.info('Lawyers module loaded ✓');
} catch (e) {
  logger.warn('Lawyers module not loaded: ' + e.message);
}

// Initialize the large Kazakhstan companies registry (SQLite, loaded on demand)
let companiesDb = null;
let regionLabel = () => null;
try {
  companiesDb = require('./modules/companies-db');
  regionLabel = require('./modules/company-region').regionLabel;
  logger.info('Companies module loaded ✓');
} catch (e) {
  logger.warn('Companies module not loaded: ' + e.message);
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
const BACKGROUND_JOBS_ENABLED = !/^(1|true|yes)$/i.test(process.env.DISABLE_BACKGROUND_JOBS || '');

app.set('trust proxy', 1);
app.disable('x-powered-by');

// Template engine for news pages
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Middleware — порядок важен: helmet → compression → cors → body-parser → static
app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        baseUri: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'self'"],
        formAction: ["'self'"],
        scriptSrc: [
          "'self'",
          "'unsafe-inline'",
          'https://cdn.jsdelivr.net',
          'https://mc.yandex.ru',
          'https://yandex.ru',
          'https://an.yandex.ru',
          'https://yastatic.net',
          'https://pagead2.googlesyndication.com',
          'https://partner.googleadservices.com',
          'https://www.googletagservices.com',
        ],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://cdn.jsdelivr.net', 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'data:', 'https://cdn.jsdelivr.net', 'https://fonts.gstatic.com'],
        imgSrc: ["'self'", 'data:', 'https:'],
        connectSrc: [
          "'self'",
          'https://mc.yandex.ru',
          'https://yandex.ru',
          'https://an.yandex.ru',
          'https://pagead2.googlesyndication.com',
          'https://googleads.g.doubleclick.net',
          'https://ep1.adtrafficquality.google',
          'https://ep2.adtrafficquality.google',
        ],
        frameSrc: [
          "'self'",
          'https://maps.google.com',
          'https://www.google.com',
          'https://yandex.ru',
          'https://an.yandex.ru',
          'https://googleads.g.doubleclick.net',
          'https://tpc.googlesyndication.com',
        ],
        upgradeInsecureRequests: [],
      },
    },
}));

// Lock the two headers that are most often changed by Passenger/Express
// response handling. The normal Helmet middleware sets the policy first;
// this final writeHead guard restores it if a later middleware removes it and
// strips the Express signature immediately before headers leave the app.
app.use((req, res, next) => {
  const contentSecurityPolicy = res.getHeader('Content-Security-Policy');
  const originalWriteHead = res.writeHead;
  const enforce = () => {
    res.removeHeader('X-Powered-By');
    if (contentSecurityPolicy) {
      res.setHeader('Content-Security-Policy', contentSecurityPolicy);
    }
  };
  res.writeHead = function lockedSecurityWriteHead(...args) {
    enforce();
    return originalWriteHead.apply(this, args);
  };
  enforce();
  next();
});
app.use(compression());
app.use(cors({
    origin: process.env.CORS_ORIGIN || false, // в production задайте CORS_ORIGIN=https://zakonexpertt.kz
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type', 'X-Admin-Key'],
}));
app.use(express.json()); // заменяет bodyParser.json()

function createRateLimiter({ windowMs, max, name }) {
  const buckets = new Map();
  let lastSweep = 0;
  return (req, res, next) => {
    const now = Date.now();
    if (now - lastSweep > windowMs) {
      for (const [key, value] of buckets) {
        if (now - value.startedAt >= windowMs) buckets.delete(key);
      }
      lastSweep = now;
    }
    const key = req.ip || req.socket.remoteAddress || 'unknown';
    let bucket = buckets.get(key);
    if (!bucket || now - bucket.startedAt >= windowMs) {
      bucket = { count: 0, startedAt: now };
      buckets.set(key, bucket);
    }
    bucket.count += 1;
    if (bucket.count > max) {
      res.set('Retry-After', String(Math.ceil((windowMs - (now - bucket.startedAt)) / 1000)));
      return res.status(429).json({ error: `Слишком много запросов к ${name}. Повторите позже.` });
    }
    next();
  };
}

const externalApiLimiter = createRateLimiter({ windowMs: 60 * 1000, max: 20, name: 'внешнему реестру' });
const leadLimiter = createRateLimiter({ windowMs: 10 * 60 * 1000, max: 10, name: 'форме' });
const commentLimiter = createRateLimiter({ windowMs: 10 * 60 * 1000, max: 8, name: 'комментариям' });

// ===== LEGACY ALIAS URL → CANONICAL URL 301 REDIRECTS =====
// These filenames still exist as physical files (serving the canonical route
// via servicePages below), but the old URL itself must not stay live as a
// second indexable duplicate of the canonical page. Must be registered
// before express.static, which would otherwise serve the file directly.
const LEGACY_ALIAS_REDIRECTS = {
  '/ispolnitelnaya-nadpis':           '/otmena-ispolnitelnoi-nadpisi',
  '/spornost-dolga':                  '/vozrazhenie-na-ispolnitelnuyu-nadpis',
  '/chsi-arest-schetov':              '/snyatie-ogranichenii-chsi',
  '/zapret-registracionnyh-deystviy': '/snyatie-zapreta-registracionnyh-deistvii',
  '/grafik-platezhey':                '/grafik-oplaty-zadolzhennosti',
};
for (const [oldPath, newPath] of Object.entries(LEGACY_ALIAS_REDIRECTS)) {
  app.get([oldPath, oldPath + '.html'], (req, res) => res.redirect(301, newPath));
}

// ===== GENERIC .html SUFFIX → EXTENSIONLESS CANONICAL 301 REDIRECT =====
// Real Yandex Webmaster data (2026-07-15 export) showed Yandex independently
// indexing the .html-suffixed URL for several pages (e.g. /snyatie-aresta-so-scheta.html
// at position 16, split away from its self-referencing canonical) — confirms
// this is not a theoretical duplicate-content risk. Search-console verification
// stub files must keep their literal .html URL and are excluded.
const HTML_SUFFIX_REDIRECT_EXCLUDE = new Set([
  '/googlerGbK9GM3kA42xzTzGMQs4VZju46dDdZjQdmOigQjnKY.html',
  '/yandex_decc99fa3bf371ce.html',
]);
app.get(/^\/.+\.html$/, (req, res, next) => {
  if (HTML_SUFFIX_REDIRECT_EXCLUDE.has(req.path)) return next();
  const cleanPath = req.path === '/index.html' ? '/' : req.path.slice(0, -'.html'.length);
  const filePath = path.join(__dirname, 'public', req.path);
  if (!fs.existsSync(filePath)) return next();
  const qs = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
  res.redirect(301, cleanPath + qs);
});

// Working databases/exports must never be web-reachable, even if something
// is dropped into public/data/ by mistake (found a stray .db-wal file there
// during a storage audit — nothing in the app writes there, but express.static
// would have served it to anyone who requested the URL directly).
app.use('/data', (req, res) => res.status(404).end());

app.use(express.static(path.join(__dirname, 'public'), {
  extensions: ['html'],
  setHeaders(res, filePath) {
    if (/\.(?:avif|webp|png|jpe?g|gif|svg|ico|woff2?)$/i.test(filePath)) {
      res.setHeader('Cache-Control', 'public, max-age=604800, stale-while-revalidate=86400');
    } else if (/\.(?:css|js)$/i.test(filePath)) {
      res.setHeader('Cache-Control', 'public, max-age=3600, stale-while-revalidate=86400');
    }
  },
}));

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
  '/banks', '/mfo', '/courts', '/chambers', '/companies', '/collectors', '/lombards',
  '/gsi', '/insurance', '/credit-bureaus', '/regulators', '/emergency',
  '/news', '/statyi',
]);
app.use((req, res, next) => {
  const notifyVisits = /^(1|true|yes)$/i.test(process.env.TELEGRAM_VISIT_NOTIFICATIONS || '');
  if (notifyVisits && req.method === 'GET' && TRACKED_PATHS.has(req.path)) {
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
    const ua = req.headers['user-agent'] || '';
    const referer = req.headers['referer'] || req.headers['referrer'] || '';
    telegram.notifyVisit(req.path, ip, ua, referer);
  }
  next();
});

// Не держим обычные веб-запросы открытыми 10 минут: это расходует воркеры и
// делает приложение уязвимее к медленным соединениям. Долгие admin-задачи
// запускаются отдельными POST-маршрутами.
app.use((req, res, next) => {
    const timeoutMs = req.path.startsWith('/api/') ? 120000 : 30000;
    req.setTimeout(timeoutMs);
    res.setTimeout(timeoutMs);
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Keep-Alive', 'timeout=5');
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

function sendNotFound(res) {
  res.status(404).sendFile(path.join(__dirname, 'public', '404.html'), error => {
    if (error && !res.headersSent) res.status(404).send('Страница не найдена');
  });
}

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
app.post('/check', externalApiLimiter, asyncHandler(async (req, res) => {
    const iin = String(req.body?.iin || '').replace(/\D/g, '');
    // ИЗМЕНЕНО: logger.info
    logger.info(`Получен запрос на проверку ИИН: ${iin ? iin.substring(0, 4) + '********' : 'пустой'}`); // Маскируем ИИН в логах

    if (!iin) {
        // ИЗМЕНЕНО: logger.warn
        logger.warn('Запрос на проверку без ИИН.');
        return res.status(400).json({ error: 'ИИН не предоставлен' });
    }
    if (iin.length !== 12) {
        logger.warn(`Запрос на проверку с неверной длиной ИИН: ${maskIin(iin)}`);
        return res.status(400).json({ error: 'ИИН должен содержать 12 цифр' });
    }
    if (!EGOV_API_KEY) {
        logger.error('Проверка ИИН недоступна: EGOV_API_KEY не настроен.');
        return res.status(503).json({
            error: 'Сервис проверки временно недоступен',
            details: 'Обратитесь через WhatsApp — специалист проверит ограничения вручную.'
        });
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

app.get('/api/notary-search', externalApiLimiter, asyncHandler(async (req, res) => {
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
  if (!notary) return sendNotFound(res);
  const [comments, commentStats] = commentsDb
    ? await Promise.all([commentsDb.getApproved('notary', req.params.slug), commentsDb.stats('notary', req.params.slug)])
    : [[], null];
  res.render('notary/page', { notary, comments, commentStats, commentSent: req.query.comment === 'sent' });
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
    <loc>https://zakonexpertt.kz/notaries?region=${encodeURIComponent(r.region)}</loc>
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
app.post('/api/notaries/import', asyncHandler(async (req, res) => {
  if (!checkAdminKey(req, res)) return;
  if (!importNotaries) return res.status(503).json({ error: 'Notary module not available' });
  const count = await importNotaries();
  res.json({ ok: true, imported: count });
}));

app.post('/api/notaries/refresh', asyncHandler(async (req, res) => {
  if (!checkAdminKey(req, res)) return;
  if (!refreshNotariesRegistry || !importNotaries) return res.status(503).json({ error: 'Notary module not available' });
  const refreshed = await refreshNotariesRegistry();
  const imported = await importNotaries();
  res.json({ ok: true, refreshed, imported });
}));

// ===== BAILIFF SEARCH =====
app.get('/bailiff-search', asyncHandler(async (req, res) => {
  const q = (req.query.q || '').trim();
  let results = null;
  let suggestion = null;
  if (q.length >= 2 && bailiffsDb) {
    results = await bailiffsDb.search(q);
    if (results.length === 0) {
      suggestion = await bailiffsDb.fuzzySearch(q);
    }
  } else if (q.length >= 2) {
    results = [];
  }
  res.render('bailiff/search', { query: q, results, suggestion });
}));

// ===== CATALOG PAGES =====

app.get('/notaries', asyncHandler(async (req, res) => {
  const region = (req.query.region || '').trim();
  if (!notariesDb) return res.status(503).send('Notary module not available');
  const [allRegions, lastUpdated] = await Promise.all([
    notariesDb.getRegions(),
    notariesDb.getLastUpdated(),
  ]);
  if (region) {
    const regionItems = await notariesDb.findByRegion(region);
    return res.render('notary/catalog', { selectedRegion: region, allRegions, regionItems, lastUpdated });
  }
  res.render('notary/catalog', { selectedRegion: '', allRegions, regionItems: [], lastUpdated });
}));

// ===== REGIONAL LANDING PAGES =====
const REGIONAL_CITIES = {
  'almaty': {
    slug: 'almaty', name: 'Алматы', prepIn: 'Алматы', caseIn: 'Алматы', caseByCity: 'Алматы',
    bailiffRegion: 'город Алматы', notaryRegion: 'город Алматы',
    intro: 'Алматы — крупнейший город Казахстана и лидер по количеству исполнительных производств. Здесь работает больше всего ЧСИ и нотариусов в стране, поэтому и арестов счетов Kaspi, Halyk и Freedom Bank больше, чем в любом другом регионе.',
    faq: [
      { q: 'Нужно ли приезжать в офис в Алматы?', a: 'Нет. Мы работаем дистанционно по всему Казахстану, включая Алматы — документы передаются через WhatsApp, личный визит не обязателен.' },
      { q: 'Почему в Алматы так много ЧСИ?', a: 'Алматы — самый населённый город страны с наибольшим числом исполнительных производств, поэтому здесь работает больше частных судебных исполнителей, чем в других регионах.' },
      { q: 'Как узнать, какой ЧСИ в Алматы ведёт моё производство?', a: 'Проверьте по ИИН на нашем сайте — покажем все открытые производства и исполнителя, который их ведёт.' },
    ],
  },
  'astana': {
    slug: 'astana', name: 'Астана', prepIn: 'Астане', caseIn: 'Астане', caseByCity: 'Астане',
    bailiffRegion: 'город Астана', notaryRegion: 'город Астана',
    intro: 'Астана — столица Казахстана с активно растущим количеством исполнительных производств. Клиенты Kaspi, Halyk и Freedom Bank в Астане часто сталкиваются с арестом счёта из-за исполнительной надписи нотариуса или постановления ЧСИ.',
    faq: [
      { q: 'Работаете ли вы с клиентами в Астане дистанционно?', a: 'Да, мы ведём дела по всей Астане удалённо — присылаете документы в WhatsApp, мы готовим и подаём всё сами.' },
      { q: 'Какой банк чаще арестовывает счета в Астане?', a: 'Чаще всего к нам обращаются клиенты Kaspi и Halyk Bank — банк лишь исполняет постановление, а не принимает решение об аресте самостоятельно.' },
      { q: 'Сколько времени занимает снятие ареста в Астане?', a: 'Зависит от основания: при исполнительной надписи — от нескольких дней до 2–3 недель после подачи возражения. Точный срок скажем после анализа документов.' },
    ],
  },
  'shymkent': {
    slug: 'shymkent', name: 'Шымкент', prepIn: 'Шымкенте', caseIn: 'Шымкенте', caseByCity: 'Шымкенту',
    bailiffRegion: 'город Шымкент', notaryRegion: 'город Шымкент',
    intro: 'Шымкент — третий по величине город Казахстана со своим отдельным реестром ЧСИ и нотариусов. Арест счёта в Шымкенте чаще всего связан с исполнительной надписью нотариуса по кредиту или МФО.',
    faq: [
      { q: 'Есть ли у ZakonExpert офис в Шымкенте?', a: 'Мы работаем по Шымкенту дистанционно — весь процесс, от разбора документов до подачи возражения, ведётся удалённо через WhatsApp.' },
      { q: 'ЧСИ в Шымкенте наложил арест — что делать?', a: 'Проверьте по ИИН, какое производство открыто и на каком основании. Затем можно подготовить возражение или жалобу в зависимости от ситуации.' },
      { q: 'Можно ли оспорить исполнительную надпись нотариуса в Шымкенте?', a: 'Да, если долг спорный или нарушена процедура уведомления — на возражение есть 10 рабочих дней с момента, когда вы узнали о надписи.' },
    ],
  },
  'taldykorgan': {
    slug: 'taldykorgan', name: 'Талдыкорган', prepIn: 'Талдыкоргане', caseIn: 'Талдыкоргане', caseByCity: 'Талдыкоргану',
    bailiffRegion: 'область Жетысу', notaryRegion: 'область Жетысу',
    intro: 'Талдыкорган — административный центр области Жетысу. Исполнительные производства и исполнительные надписи по клиентам региона ведутся ЧСИ и нотариусами, зарегистрированными в области Жетысу.',
    faq: [
      { q: 'Талдыкорган относится к какой области по реестру ЧСИ?', a: 'К области Жетысу — административным центром которой является Талдыкорган. Все ЧСИ и нотариусы региона зарегистрированы именно там.' },
      { q: 'Можно ли решить вопрос без визита в Талдыкорган?', a: 'Да, мы работаем дистанционно — документы принимаем через WhatsApp, ехать в Талдыкорган не нужно.' },
      { q: 'Что делать, если арестовали зарплатную карту в Талдыкоргане?', a: 'Проверьте по ИИН основание ареста. Если удержания превышают установленный законом лимит — это повод для жалобы на ЧСИ.' },
    ],
  },
  'karaganda': {
    slug: 'karaganda', name: 'Караганда', prepIn: 'Караганде', caseIn: 'Караганде', caseByCity: 'Караганде',
    bailiffRegion: 'Карагандинская область', notaryRegion: 'Карагандинская область',
    intro: 'Караганда — крупный промышленный центр и административный центр Карагандинской области. Исполнительные производства должников региона ведут ЧСИ, зарегистрированные в Карагандинской области.',
    faq: [
      { q: 'Работает ли ZakonExpert с должниками в Караганде?', a: 'Да, мы ведём дела по всей Карагандинской области дистанционно — от первичной проверки по ИИН до подачи документов.' },
      { q: 'Как узнать сумму долга и взыскателя в Караганде?', a: 'Проверьте по ИИН на нашем сайте — покажем все открытые исполнительные производства, взыскателя и сумму задолженности.' },
      { q: 'Можно ли договориться о рассрочке в Караганде?', a: 'Да, при определённых условиях можно оформить график платежей или отсрочку исполнения — разберём вашу ситуацию бесплатно.' },
    ],
  },
};
const REGIONAL_CITY_LIST = Object.values(REGIONAL_CITIES).map(c => ({ slug: c.slug, name: c.name }));

app.get('/snyatie-aresta-:city', asyncHandler(async (req, res, next) => {
  const city = REGIONAL_CITIES[req.params.city];
  if (!city) return next();
  let bailiffCount = 0, notaryCount = 0;
  if (bailiffsDb) {
    const regions = await bailiffsDb.getRegions();
    const found = regions.find(r => r.region === city.bailiffRegion);
    bailiffCount = found ? found.count : 0;
  }
  if (notariesDb) {
    const regions = await notariesDb.getRegions();
    const found = regions.find(r => r.region === city.notaryRegion);
    notaryCount = found ? found.count : 0;
  }
  const otherCities = REGIONAL_CITY_LIST.filter(c => c.slug !== city.slug);
  res.render('regional/page', { city, bailiffCount, notaryCount, otherCities });
}));

app.get('/bailiffs', asyncHandler(async (req, res) => {
  const region = (req.query.region || '').trim();
  if (!bailiffsDb) return res.status(503).send('Bailiff module not available');
  const [allRegions, lastUpdated] = await Promise.all([
    bailiffsDb.getRegions(),
    bailiffsDb.getLastUpdated(),
  ]);
  if (region) {
    const regionItems = await bailiffsDb.findByRegion(region);
    return res.render('bailiff/catalog', { selectedRegion: region, allRegions, regionItems, lastUpdated });
  }
  res.render('bailiff/catalog', { selectedRegion: '', allRegions, regionItems: [], lastUpdated });
}));

app.get('/lawyers', asyncHandler(async (req, res) => {
  const region = (req.query.region || '').trim();
  if (!lawyersDb) return res.status(503).send('Lawyer module not available');
  const requestedPage = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
  const [allRegions, lastUpdated] = await Promise.all([
    lawyersDb.getRegions(),
    lawyersDb.getLastUpdated(),
  ]);
  if (region) {
    const total = await lawyersDb.countByRegion(region);
    const totalPages = Math.max(1, Math.ceil(total / CATALOG_PAGE_SIZE));
    const page = Math.min(requestedPage, totalPages);
    const regionItems = await lawyersDb.findByRegion(
      region,
      CATALOG_PAGE_SIZE,
      (page - 1) * CATALOG_PAGE_SIZE,
    );
    return res.render('lawyer/catalog', {
      selectedRegion: region,
      allRegions,
      regionItems,
      lastUpdated,
      catalog: { page, pageSize: CATALOG_PAGE_SIZE, total, totalPages },
    });
  }
  res.render('lawyer/catalog', {
    selectedRegion: '', allRegions, regionItems: [], lastUpdated,
    catalog: { page: 1, pageSize: CATALOG_PAGE_SIZE, total: 0, totalPages: 1 },
  });
}));

// ===== SLUGIFY =====
function slugify(s) {
  const cyr = {
    'а':'a','б':'b','в':'v','г':'g','д':'d','е':'e','ё':'yo','ж':'zh','з':'z',
    'и':'i','й':'y','к':'k','л':'l','м':'m','н':'n','о':'o','п':'p','р':'r',
    'с':'s','т':'t','у':'u','ф':'f','х':'kh','ц':'ts','ч':'ch','ш':'sh',
    'щ':'shch','ъ':'','ы':'y','ь':'','э':'e','ю':'yu','я':'ya',
    'қ':'k','ң':'n','ғ':'g','ү':'u','ұ':'u','ө':'o','һ':'h','і':'i','ә':'a',
  };
  return String(s).toLowerCase()
    .replace(/./g, ch => (cyr[ch] !== undefined ? cyr[ch] : ch))
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 80);
}

// ===== BANKS DATA =====
const BANKS_DATA = [
  { slug:'halyk-bank', name:'Народный Банк Казахстана', shortName:'Halyk Bank', tag:'Государственный', city:'г. Алматы', address:'пр. Аль-Фараби, 40', phone:'+7 (727) 259-07-77', phoneRaw:'+77272590777', phoneShort:'7111 (физ.) · 9595 (юр.)', email:'info@halykbank.kz', web:'halykbank.kz', bin:'940140000385', chairman:'Шаяхметова Умут Болатовна', note:'Крупнейший частный банк Казахстана' },
  { slug:'kaspi-bank', name:'Kaspi Bank', shortName:'Kaspi Bank', tag:'', city:'г. Алматы', address:'ул. Наурызбай батыра, 154А', phone:'+7 (727) 258-59-55', phoneRaw:'+77272585955', phoneShort:'9999 (моб.) · 8-800-080-18-00', email:'office@kaspi.kz', web:'kaspibank.kz', bin:'971240001315', chairman:'Миронов Павел Владимирович', note:'Онлайн-банкинг, рассрочка, кредиты, e-commerce' },
  { slug:'bank-centercredit', name:'Банк ЦентрКредит', shortName:'Bank CenterCredit (БЦК)', tag:'', city:'г. Алматы', address:'пр. Аль-Фараби, 38', phone:'505 (физ.) · 605 (бизнес)', phoneRaw:'', phoneShort:'', email:'info@bcc.kz', web:'bcc.kz', bin:'980640000093', chairman:'Владимиров Руслан Владимирович', note:'Универсальный банк, кредиты и депозиты' },
  { slug:'otbasy-bank', name:'Отбасы банк', shortName:'Otbasy Bank', tag:'Государственный', city:'г. Астана', address:'пр. Мәңгілік Ел, 55А', phone:'+7 (727) 330-93-00', phoneRaw:'+77273309300', phoneShort:'300 (моб.) · 8-8000-801-880', email:'mail@hcsbk.kz', web:'hcsbk.kz', bin:'030740001404', chairman:'Ибрагимова Ляззат Еркеновна', note:'Жилищный строительный сберегательный банк (ЖССБ)' },
  { slug:'fortebank', name:'ForteBank', shortName:'ForteBank', tag:'', city:'г. Астана', address:'ул. Достык, 8/1', phone:'+7 (727) 258-40-40', phoneRaw:'+77272584040', phoneShort:'7575 (физ.) · 55575 (бизнес)', email:'info@fortebank.com', web:'forte.kz', bin:'990740000683', chairman:'Куанышев Талгат Жуманович', note:'Кредиты и банковское обслуживание' },
  { slug:'bank-razvitiya-kazakhstana', name:'Банк Развития Казахстана', shortName:'БРК', tag:'Банк развития', city:'г. Астана', address:'пр. Мәңгілік Ел, 55А', phone:'+7 (7172) 79-26-00', phoneRaw:'+77172792600', phoneShort:'1408', email:'info@kdb.kz', web:'kdb.kz', bin:'010540001007', chairman:'Елибаев Марат Талгатович', note:'Государственный банк развития. Финансирует инфраструктуру и индустрию. Физических лиц не обслуживает.' },
  { slug:'eurasian-bank', name:'Евразийский Банк', shortName:'Eurasian Bank', tag:'', city:'г. Алматы', address:'ул. Кунаева, 56', phone:'+7 (727) 332-77-22', phoneRaw:'+77273327722', phoneShort:'+7 (771) 000-77-22', email:'info@eubank.kz', web:'eubank.kz', bin:'950240000112', chairman:'Сатиева Ляззат Адыловна', note:'Универсальный банк, потребительское кредитование' },
  { slug:'alatau-city-bank', name:'Alatau City Bank', shortName:'Alatau City Bank', tag:'', city:'г. Алматы', address:'пр. Нурсултан Назарбаев, 242', phone:'+7 (727) 258-77-11', phoneRaw:'+77272587711', phoneShort:'7711', email:'info@alataucitybank.kz', web:'alataucitybank.kz', bin:'920140000084', chairman:'Куандыков Ануар', note:'Бывший Jusan Bank (ранее АТФ Банк). Переименован 16.06.2025' },
  { slug:'bank-rbk', name:'Bank RBK', shortName:'Bank RBK', tag:'', city:'г. Алматы', address:'пл. Республики, 15', phone:'+7 (727) 330-90-30', phoneRaw:'+77273309030', phoneShort:'7888 (физ.) · 7222 (юр.)', email:'info@bankrbk.kz', web:'bankrbk.kz', bin:'920440001102', chairman:'Акентьева Наталья Евгеньевна', note:'Корпоративное и розничное обслуживание' },
  { slug:'bereke-bank', name:'Bereke Bank', shortName:'Bereke Bank', tag:'', city:'г. Алматы', address:'пр. Аль-Фараби, 13/1', phone:'5030 (физ.) · 7744 (бизнес)', phoneRaw:'', phoneShort:'8-8000-80-60-60', email:'post@berekebank.kz', web:'berekebank.kz', bin:'930740000137', chairman:'Тимченко Андрей Игоревич', note:'Бывший Сбербанк Казахстан' },
  { slug:'freedom-bank', name:'Freedom Bank Kazakhstan', shortName:'Freedom Bank', tag:'', city:'г. Алматы', address:'ул. Курмангазы, 61А', phone:'595 (короткий)', phoneRaw:'', phoneShort:'WhatsApp: +7 (776) 159-55-95', email:'', web:'bankffin.kz', bin:'090740019001', chairman:'Ахметова Гульфайруз', note:'Бывший Bank Kassa Nova / Банк Фридом Финанс. Переименован 20.05.2024' },
  { slug:'altyn-bank', name:'Altyn Bank', shortName:'Altyn Bank', tag:'Иностранный', city:'г. Алматы', address:'пр. Абая, 109В', phone:'+7 (727) 356-57-77', phoneRaw:'+77273565777', phoneShort:'+7 (727) 259-69-22 (юр.)', email:'info@altynbank.kz', web:'altynbank.kz', bin:'980740000057', chairman:'Байсынов Мурат', note:'Дочерний банк China CITIC Bank Corporation' },
  { slug:'home-credit-bank', name:'Home Credit Bank', shortName:'Home Credit Bank', tag:'', city:'г. Алматы', address:'ул. Зеина Шашкина, 1/1', phone:'+7 (727) 244-54-84', phoneRaw:'+77272445484', phoneShort:'7979', email:'info@homecredit.kz', web:'home.kz', bin:'930540000147', chairman:'Нурумбет Шолпан', note:'Потребительские кредиты и рассрочка. Дочерний банк ForteBank' },
  { slug:'nurbank', name:'Нурбанк', shortName:'Nurbank', tag:'', city:'г. Алматы', address:'пр. Абая, 10В', phone:'+7 (727) 244-44-44', phoneRaw:'+77272444444', phoneShort:'2552', email:'info_nur@nurbank.kz', web:'nurbank.kz', bin:'930940000164', chairman:'Мажуга Алексей Николаевич', note:'Кредиты и вклады для физических и юридических лиц' },
  { slug:'shinhan-bank', name:'Shinhan Bank Казахстан', shortName:'Shinhan Bank', tag:'Иностранный', city:'г. Алматы', address:'пр. Достык, 38', phone:'+7 (727) 356-96-00', phoneRaw:'+77273569600', phoneShort:'', email:'infokz@shinhan.com', web:'shinhan.kz', bin:'080240019735', chairman:'Чжо Ёнг Ын', note:'Дочерний банк Shinhan Financial Group (Республика Корея)' },
  { slug:'bank-of-china', name:'Банк Китая в Казахстане', shortName:'Bank of China', tag:'Иностранный', city:'г. Алматы', address:'мкр-н Жетысу-2, 71Б', phone:'+7 (727) 258-55-10', phoneRaw:'+77272585510', phoneShort:'', email:'', web:'boc.kz', bin:'930440000156', chairman:'Хоу Юаньмин', note:'Дочерний банк Bank of China Limited' },
  { slug:'icbc-kazakhstan', name:'ICBC Казахстан', shortName:'ICBC Kazakhstan', tag:'Иностранный', city:'г. Алматы', address:'пр. Абая, 150/230', phone:'+7 (727) 237-70-72', phoneRaw:'+77272377072', phoneShort:'+7 (727) 237-70-83 (юр.)', email:'office@kz.icbc.com.cn', web:'kz.icbc.com.cn', bin:'930340001235', chairman:'Люй Хунхай', note:'Торгово-промышленный банк Китая в г. Алматы' },
  { slug:'vtb-bank', name:'ВТБ (Казахстан)', shortName:'VTB Bank', tag:'Иностранный', city:'г. Алматы', address:'ул. Тимирязева, 26/29', phone:'+7 (727) 330-50-50', phoneRaw:'+77273305050', phoneShort:'5050', email:'info@vtb-bank.kz', web:'vtb-bank.kz', bin:'080940010300', chairman:'Забелло Дмитрий Александрович', note:'Дочерний банк ВТБ (Россия)' },
  { slug:'adcb-kazakhstan', name:'Исламский банк ADCB', shortName:'ADCB Kazakhstan', tag:'Исламский', city:'г. Алматы', address:'пр. Аль-Фараби, 77/7, БЦ Esentai Tower', phone:'+7 (727) 233-00-00', phoneRaw:'+77272330000', phoneShort:'', email:'adcbk.reception@adcb.com', web:'adcb.com/kazakhstan', bin:'100140011772', chairman:'Гордон Джеймс Хаскинс', note:'Исламский банкинг. Бывший Al Hilal Bank, переименован 21.10.2024' },
  { slug:'zaman-bank', name:'Заман-Банк', shortName:'Zaman Bank', tag:'Исламский', city:'г. Астана', address:'пр. Рақымжан Қошқарбаев, 1а', phone:'+7 (7172) 26-20-26', phoneRaw:'+77172262026', phoneShort:'+7 (727) 355-65-75 (Алматы) · 4077', email:'info@zamanbank.kz', web:'zamanbank.kz', bin:'910640000060', chairman:'Асаева Гульфайруз Ерлановна', note:'Исламский банк, работает по принципам шариата' },
  { slug:'kmf-bank', name:'KMF Банк', shortName:'KMF Bank', tag:'Специализированный', city:'г. Алматы', address:'пр. Нұрсұлтан Назарбаев, 50', phone:'+7 (727) 331-74-74', phoneRaw:'+77273317474', phoneShort:'', email:'info@kmf.kz', web:'kmf.kz', bin:'061240001583', chairman:'Жусупов Шалкар Амангосович', note:'Бывшая МФО KMF. Конвертирована в банк 12.08.2025. Кредитование МСБ и физлиц' },
  { slug:'citibank-kazakhstan', name:'Ситибанк Казахстан', shortName:'Citibank Kazakhstan', tag:'Иностранный', city:'г. Алматы', address:'ул. Зенкова, 26/41', phone:'+7 (727) 332-14-00', phoneRaw:'+77273321400', phoneShort:'+7 (717) 255-76-00 (Астана)', email:'citibank.kazakhstan@citi.com', web:'citibank.com/kazakhstan', bin:'980540003232', chairman:'Жакаева Сауле', note:'Международный банк Citigroup, корпоративное обслуживание' },
];

// ===== COURTS DATA =====
const COURTS_DATA = [
  { slug:'verkhovny-sud', region:'г. Астана', level:'Верховный суд', name:'Верховный суд Республики Казахстан', address:'пр. Мангилик Ел, 55', phone:'+7 (7172) 75-31-97', phoneRaw:'+77172753197', email:'vsrk@sud.gov.kz', web:'sud.gov.kz' },
  { slug:'astana', region:'г. Астана', level:'Апелляционный', name:'Суд города Астана', address:'ул. Бейбітшілік, 6', phone:'+7 (7172) 22-00-00', phoneRaw:'+77172220000', email:'astana@sud.gov.kz', web:'sud.gov.kz' },
  { slug:'almaty', region:'г. Алматы', level:'Апелляционный', name:'Алматинский городской суд', address:'пр. Абая, 14', phone:'+7 (727) 261-88-00', phoneRaw:'+77272618800', email:'almaty@sud.gov.kz', web:'sud.gov.kz' },
  { slug:'shymkent', region:'г. Шымкент', level:'Апелляционный', name:'Шымкентский городской суд', address:'ул. Байтурсынова, 7', phone:'+7 (725) 253-12-00', phoneRaw:'+77252531200', email:'shymkent@sud.gov.kz', web:'sud.gov.kz' },
  { slug:'akmola', region:'Акмолинская область', level:'Апелляционный', name:'Акмолинский областной суд', address:'г. Кокшетау, ул. Абая, 83', phone:'+7 (716) 230-50-00', phoneRaw:'+77162305000', email:'akmola@sud.gov.kz', web:'sud.gov.kz' },
  { slug:'aktobe', region:'Актюбинская область', level:'Апелляционный', name:'Актюбинский областной суд', address:'г. Актобе, ул. Алтынсарина, 22', phone:'+7 (713) 215-50-00', phoneRaw:'+77132155000', email:'aktobe@sud.gov.kz', web:'sud.gov.kz' },
  { slug:'almaty-obl', region:'Алматинская область', level:'Апелляционный', name:'Алматинский областной суд', address:'г. Талдыкорган, ул. Тайманова, 58', phone:'+7 (728) 222-34-00', phoneRaw:'+77282223400', email:'almaty_obl@sud.gov.kz', web:'sud.gov.kz' },
  { slug:'atyrau', region:'Атырауская область', level:'Апелляционный', name:'Атырауский областной суд', address:'г. Атырау, ул. Есет Батыра, 11', phone:'+7 (712) 222-05-00', phoneRaw:'+77122220500', email:'atyrau@sud.gov.kz', web:'sud.gov.kz' },
  { slug:'vko', region:'Восточно-Казахстанская область', level:'Апелляционный', name:'ВКО областной суд', address:'г. Усть-Каменогорск, ул. Казахстан, 131', phone:'+7 (723) 222-46-00', phoneRaw:'+77232224600', email:'vko@sud.gov.kz', web:'sud.gov.kz' },
  { slug:'zhambyl', region:'Жамбылская область', level:'Апелляционный', name:'Жамбылский областной суд', address:'г. Тараз, ул. Толстого, 112', phone:'+7 (726) 243-70-00', phoneRaw:'+77262437000', email:'zhambyl@sud.gov.kz', web:'sud.gov.kz' },
  { slug:'zko', region:'ЗКО (Уральск)', level:'Апелляционный', name:'Западно-Казахстанский областной суд', address:'г. Уральск, ул. Дружбы, 177', phone:'+7 (711) 222-31-00', phoneRaw:'+77112223100', email:'zko@sud.gov.kz', web:'sud.gov.kz' },
  { slug:'karaganda', region:'Карагандинская область', level:'Апелляционный', name:'Карагандинский областной суд', address:'г. Каpаганда, ул. Ерубаева, 47', phone:'+7 (721) 242-53-00', phoneRaw:'+77212425300', email:'karaganda@sud.gov.kz', web:'sud.gov.kz' },
  { slug:'kostanay', region:'Костанайская область', level:'Апелляционный', name:'Костанайский областной суд', address:'г. Костанай, ул. Байтурсынова, 70', phone:'+7 (714) 254-07-00', phoneRaw:'+77142540700', email:'kostanay@sud.gov.kz', web:'sud.gov.kz' },
  { slug:'kyzylorda', region:'Кызылординская область', level:'Апелляционный', name:'Кызылординский областной суд', address:'г. Кызылорда, пр. Бейбарыса, 39', phone:'+7 (724) 226-40-00', phoneRaw:'+77242264000', email:'kyzylorda@sud.gov.kz', web:'sud.gov.kz' },
  { slug:'mangistau', region:'Мангистауская область', level:'Апелляционный', name:'Мангистауский областной суд', address:'г. Актау, 13-й мкр.', phone:'+7 (729) 232-32-00', phoneRaw:'+77292323200', email:'mangistau@sud.gov.kz', web:'sud.gov.kz' },
  { slug:'pavlodar', region:'Павлодарская область', level:'Апелляционный', name:'Павлодарский областной суд', address:'г. Павлодар, ул. Академика Сатпаева, 28', phone:'+7 (718) 232-62-00', phoneRaw:'+77182326200', email:'pavlodar@sud.gov.kz', web:'sud.gov.kz' },
  { slug:'sko', region:'СКО (Петропавловск)', level:'Апелляционный', name:'Северо-Казахстанский областной суд', address:'г. Петропавловск, ул. Конституции Казахстана, 25', phone:'+7 (715) 246-40-00', phoneRaw:'+77152464000', email:'sko@sud.gov.kz', web:'sud.gov.kz' },
  { slug:'turkestan', region:'Туркестанская область', level:'Апелляционный', name:'Туркестанский областной суд', address:'г. Туркестан, ул. Жибек жолы, 2', phone:'+7 (725) 333-22-00', phoneRaw:'+77253332200', email:'turkestan@sud.gov.kz', web:'sud.gov.kz' },
  { slug:'abay', region:'Абайская область', level:'Апелляционный', name:'Абайский областной суд', address:'г. Семей, ул. Дулатова, 57', phone:'+7 (722) 252-52-00', phoneRaw:'+77222525200', email:'abay@sud.gov.kz', web:'sud.gov.kz' },
  { slug:'zhetisu', region:'Жетысуская область', level:'Апелляционный', name:'Жетысуский областной суд', address:'г. Талдыкорган, ул. Жансугурова, 131', phone:'+7 (728) 225-09-00', phoneRaw:'+77282250900', email:'zhetisu@sud.gov.kz', web:'sud.gov.kz' },
  { slug:'ulytau', region:'Улытауская область', level:'Апелляционный', name:'Улытауский областной суд', address:'г. Жезказган, ул. Жангельдина, 1', phone:'+7 (710) 260-20-00', phoneRaw:'+77102602000', email:'ulytau@sud.gov.kz', web:'sud.gov.kz' },
];

// ===== CSV-BACKED: BANKS =====
let _banksCache = null;
function getBanksData() {
  if (_banksCache) return _banksCache;
  const staticByBin = {};
  BANKS_DATA.forEach(b => { staticByBin[b.bin] = b; });
  const rows = parseSemicolonCSV(path.join(__dirname, 'Банки_Казахстана.csv'));
  _banksCache = rows.map(r => {
    const fullName = r['Банк (официальное название)'] || '';
    const bin = (r['БИН'] || '').trim();
    if (!bin) return null;
    const existing = staticByBin[bin] || {};
    // Extract shortName from trailing parentheses
    const parenM = fullName.match(/\(([^)]+)\)$/);
    let shortName = parenM ? parenM[1].trim() : '';
    if (/^бывш\.|^гос\.|^не бву/i.test(shortName)) shortName = '';
    if (!shortName) {
      const aoM = fullName.match(/(?:АО|ДБ АО|ДО АО|АО ДБ)\s+"([^"]+)"/);
      shortName = aoM ? aoM[1].trim() : fullName.replace(/^АО\s+/, '').replace(/^"|"$/g,'').trim();
    }
    const name = fullName.replace(/^(?:АО|ДБ АО|ДО АО|АО ДБ)\s+"/, '').replace(/"[^"]*$/, '').replace(/\s*\([^)]*\)$/, '').replace(/^"|"$/g,'').trim() || existing.name;
    const emailM = (r['Email'] || '').match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/);
    const phone = (r['Телефон'] || '').trim();
    const phoneRawM = phone.match(/\+7[\s\d\-\(\)]{8,}/);
    let phoneRaw = '';
    if (phoneRawM) {
      const raw = '+7' + phoneRawM[0].slice(2).replace(/[^\d]/g, '');
      if (raw.length === 12) phoneRaw = raw;
    }
    const address = (r['Адрес головного офиса'] || '').trim();
    const ci = address.indexOf(',');
    return {
      slug: existing.slug || slugify(shortName || name) || 'bank-' + bin,
      name, shortName: shortName || name,
      tag: existing.tag || '',
      city: ci > -1 ? address.substring(0, ci).trim() : address,
      address: ci > -1 ? address.substring(ci + 1).trim() : address,
      phone,
      phoneRaw: phoneRaw || existing.phoneRaw || '',
      email: emailM ? emailM[0] : '',
      web: (r['Сайт'] || existing.web || '').trim(),
      bin,
      chairman: (r['Председатель Правления (ФИО)'] || existing.chairman || '').trim(),
      note: cleanScrapedNote(r['Примечание']) || existing.note || '',
    };
  }).filter(Boolean);
  return _banksCache;
}

// ===== CSV-BACKED: COURTS =====
let _courtsCache = null;
function getCourtsData() {
  if (_courtsCache) return _courtsCache;
  const rows = parseSemicolonCSV(path.join(__dirname, 'Суды_Казахстана.csv'));
  const seen = {};
  _courtsCache = rows.map(r => {
    const name = (r['Название суда'] || '').trim();
    if (!name) return null;
    let base = slugify(name) || 'court';
    if (!seen[base]) { seen[base] = 1; } else { seen[base]++; base += '-' + seen[base]; }
    const phoneStr = (r['Телефоны'] || '').split(/[,;]/)[0].trim();
    const digits = phoneStr.replace(/[^\d]/g, '');
    let phoneRaw = '';
    if (digits.length === 11) phoneRaw = '+7' + digits.slice(1);
    else if (digits.length === 10) phoneRaw = '+7' + digits;
    return {
      slug: base, name,
      level: (r['Категория'] || '').trim(),
      region: (r['Регион'] || '').trim(),
      chairman: (r['Председатель/Руководитель'] || '').trim(),
      address: (r['Адрес'] || '').trim(),
      phone: phoneStr,
      phoneRaw,
      email: (r['E-mail'] || '').trim().replace(/,(?=[a-z])/, '.'),
      schedule: (r['Режим работы'] || '').trim(),
      web: 'sud.gov.kz',
    };
  }).filter(Boolean);
  return _courtsCache;
}

// ===== CHAMBERS DATA =====
let _chambersCache = null;
function getChambersData() {
  if (_chambersCache) return _chambersCache;

  const REGION_SLUG = {
    'Акмолинская область': 'akmola',
    'Актюбинская область': 'aktobe',
    'г. Алматы': 'almaty',
    'Алматинская область': 'almaty-obl',
    'г. Астана': 'astana',
    'Атырауская область': 'atyrau',
    'Область Абай': 'abay',
    'Восточно-Казахстанская область': 'vko',
    'Жамбылская область': 'zhambyl',
    'Западно-Казахстанская область': 'zko',
    'Карагандинская область': 'karaganda',
    'Костанайская область': 'kostanay',
    'Кызылординская область': 'kyzylorda',
    'Мангистауская область': 'mangistau',
    'Павлодарская область': 'pavlodar',
    'Северо-Казахстанская область': 'sko',
    'Туркестанская область': 'turkestan',
    'Область Ұлытау': 'ulytau',
    'г. Шымкент': 'shymkent',
    'Область Жетісу': 'zhetisu',
  };

  function chFirstPhoneRaw(str) {
    if (!str) return '';
    const m = str.match(/(?:\+7|8|\(\d)[\d\s\-\(\)]{6,}/);
    if (!m) return '';
    const d = m[0].replace(/\D/g, '').slice(0, 11);
    if (d.length === 11) return '+7' + d.slice(1);
    if (d.length === 10) return '+7' + d;
    return '';
  }

  function chFirstEmail(str) {
    if (!str || str.includes('не найдено')) return '';
    const m = str.match(/[\w._%+\-]+@[\w.\-]+\.[a-zA-Z]{2,}/);
    return m ? m[0] : '';
  }

  function chCleanLeader(str) {
    return (str || '').replace(/\s*\([^)]*\)/g, '').trim();
  }

  const notaryRows = parseSemicolonCSV(path.join(__dirname, 'Нотариальные_палаты_Казахстана.csv'));
  const chsiRows   = parseSemicolonCSV(path.join(__dirname, 'Палаты_ЧСИ_Казахстана.csv'));

  const chsiByRegion = {};
  chsiRows.forEach(r => {
    const region = (r['Регион'] || '').trim();
    if (region && !region.startsWith('Республиканская')) chsiByRegion[region] = r;
  });

  _chambersCache = notaryRows
    .filter(r => {
      const region = (r['Регион'] || '').trim();
      return region && !region.startsWith('Республика');
    })
    .map(r => {
      const region = r['Регион'].trim();
      const slug   = REGION_SLUG[region] || slugify(region);
      const chsi   = chsiByRegion[region] || {};
      return {
        slug, region,
        notary_name:     (r['Название палаты'] || '').trim(),
        notary_phone:    (r['Телефон'] || '').trim(),
        notary_phoneRaw: chFirstPhoneRaw(r['Телефон'] || ''),
        notary_email:    chFirstEmail(r['Email'] || ''),
        notary_web:      '',
        notary_address:  (r['Адрес'] || '').trim(),
        notary_leader:   chCleanLeader(r['Руководитель'] || ''),
        chsi_name:       (chsi['Название палаты'] || '').trim(),
        chsi_phone:      (chsi['Телефон'] || '').trim(),
        chsi_phoneRaw:   chFirstPhoneRaw(chsi['Телефон'] || ''),
        chsi_email:      chFirstEmail(chsi['Email'] || ''),
        chsi_web:        '',
        chsi_address:    (chsi['Адрес'] || '').trim(),
        chsi_leader:     chCleanLeader(chsi['Руководитель'] || ''),
      };
    });

  return _chambersCache;
}

// ===== CSV-BACKED: GSI (Государственные судебные исполнители) =====
let _gsiCache = null;
function getGsiData() {
  if (_gsiCache) return _gsiCache;
  const rows = parseSemicolonCSV(path.join(__dirname, 'Государственные_судебные_исполнители_Департаменты_юстиции.csv'));
  _gsiCache = rows.filter(r => (r['Регион'] || '').trim()).map(r => {
    const phone = (r['Телефон'] || '').replace('не найдено', '').trim();
    const m = phone.match(/(?:\+7|8|\(\d)[\d\s\-\(\)]{6,}/);
    const phoneRaw = m ? '+7' + m[0].replace(/\D/g, '').slice(1) : '';
    return {
      region:   r['Регион'].trim(),
      name:     (r['Название департамента'] || '').trim(),
      address:  (r['Адрес'] || '').trim(),
      phone,
      phoneRaw,
      email:    (r['Email'] || '').replace('не найдено', '').trim(),
      leader:   (r['Руководитель'] || '').replace('не найдено', '').trim(),
      slug:     slugify(r['Регион'].trim()),
    };
  });
  return _gsiCache;
}

// ===== CSV-BACKED: INSURANCE (Страховые компании) =====
let _insuranceCache = null;
function getInsuranceData() {
  if (_insuranceCache) return _insuranceCache;
  const rows = parseSemicolonCSV(path.join(__dirname, 'Страховые_компании_Казахстана.csv'));
  _insuranceCache = rows.filter(r => (r['Компания'] || '').trim()).map(r => {
    const phone = (r['Телефон'] || '').trim();
    const m = phone.match(/(?:\+7|8|\(\d)[\d\s\-\(\)]{6,}/);
    const phoneRaw = m ? '+7' + m[0].replace(/\D/g, '').slice(1) : '';
    const name = (r['Компания'] || '').trim();
    const parenMatches = name.match(/\(([^)]+)\)/g) || [];
    let shortName;
    if (parenMatches.length) {
      shortName = parenMatches[parenMatches.length - 1].replace(/[()]/g, '').trim();
    } else {
      // Many names use an unbalanced-quote convention, e.g. АО "Страховая компания "Amanat
      // — the real brand name is whatever follows the LAST quote character.
      const lastQuoteIdx = name.lastIndexOf('"');
      const afterQuote = lastQuoteIdx >= 0 ? name.slice(lastQuoteIdx + 1).trim() : '';
      shortName = afterQuote || name.replace(/^АО\s+"[^"]+"\s+/i, '').replace(/^«|»$/g, '').trim();
    }
    return {
      name, shortName,
      bin:     (r['БИН'] || '').trim(),
      web:     (r['Сайт'] || '').trim(),
      phone,   phoneRaw,
      email:   (r['Email'] || '').trim(),
      address: (r['Адрес'] || '').replace(/^\d+,\s*/, '').trim(),
      leader:  (r['Председатель Правления'] || '').trim(),
      slug:    slugify(shortName || name),
    };
  });
  return _insuranceCache;
}

// ===== NEW CATALOGS: BANKS / MFO / COURTS / CHAMBERS =====
app.get('/banks',     (req, res) => res.render('banks/catalog', { banks: getBanksData(), lowContentBoost }));

const CATALOG_PAGE_SIZE = 60;
function paginateCatalog(items, req, searchText) {
  const query = String(req.query.q || '').trim().slice(0, 100);
  const needle = query.toLocaleLowerCase('ru-RU');
  const filtered = needle
    ? items.filter(item => String(searchText(item) || '').toLocaleLowerCase('ru-RU').includes(needle))
    : items;
  const totalPages = Math.max(1, Math.ceil(filtered.length / CATALOG_PAGE_SIZE));
  const requestedPage = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
  const page = Math.min(requestedPage, totalPages);
  const offset = (page - 1) * CATALOG_PAGE_SIZE;
  return {
    items: filtered.slice(offset, offset + CATALOG_PAGE_SIZE),
    query,
    page,
    pageSize: CATALOG_PAGE_SIZE,
    total: items.length,
    filteredTotal: filtered.length,
    totalPages,
  };
}

app.get('/courts', (req, res) => {
  const catalog = paginateCatalog(getCourtsData(), req, court => [
    court.name, court.region, court.level, court.address, court.chairman, court.email,
  ].join(' '));
  res.render('courts/catalog', { courts: catalog.items, catalog });
});
app.get('/chambers',  (req, res) => res.render('chambers/catalog', { chambers: getChambersData() }));
function companyLanguageLinks(companySlug = null) {
  return COMPANY_LOCALES.map(code => {
    const language = getCompanyLocale(code);
    return {
      code,
      nativeName: language.nativeName,
      href: companyCatalogPathFor(code),
      companyHref: companySlug
        ? companyPathFor(code, companySlug)
        : companyCatalogPathFor(code),
    };
  });
}

function renderCompaniesCatalog(req, res, localeCode = 'ru') {
  const locale = getCompanyLocale(localeCode);
  const query = String(req.query.q || '').trim().slice(0, 120);
  const page = Number.parseInt(req.query.page, 10) || 1;
  const stats = companiesDb
    ? companiesDb.stats()
    : {
      available: false, count: 0, updatedAt: null, source: null,
      officialCount: 0, directoryOnlyCount: 0, withContactsCount: 0,
    };
  const results = companiesDb
    ? (query ? companiesDb.search(query, page, 30) : companiesDb.browse(page, 30))
    : { items: [], page: 1, hasMore: false };
  res.render('companies/catalog', {
    query,
    results,
    stats,
    locale,
    copy: locale,
    alternates: catalogAlternates(),
    languages: companyLanguageLinks(),
    companyCatalogPath: companyCatalogPathFor(locale.code),
    companyItemPrefix: locale.code === 'ru' ? '/company/' : `/${locale.code}/company/`,
  });
}

function renderCompanyItem(req, res, localeCode = 'ru') {
  if (!companiesDb || !companiesDb.available()) return sendNotFound(res);
  const locale = getCompanyLocale(localeCode);
  const id = String(req.params.slug || '').match(/^(\d+)/)?.[1];
  let company = id ? companiesDb.findById(id) : null;
  if (!company) {
    const redirect = companiesDb.redirectByOldSlug(req.params.slug);
    if (redirect) return res.redirect(301, companyPathFor(locale.code, redirect.slug));
    return sendNotFound(res);
  }
  if (company.slug !== req.params.slug) {
    return res.redirect(301, companyPathFor(locale.code, company.slug));
  }
  const sourceUpdatedAt = companiesDb.stats().updatedAt;
  const regionName = company.region_slug ? regionLabel(company.region_slug) : null;
  const companyQuality = companiesDb.quality(company);
  return res.render('companies/item', {
    company,
    sourceUpdatedAt,
    regionName,
    companyQuality,
    localized: locale.code !== 'ru',
    locale,
    copy: locale,
    languages: companyLanguageLinks(company.slug),
    companyCatalogPath: companyCatalogPathFor(locale.code),
  });
}

app.get('/companies', (req, res) => renderCompaniesCatalog(req, res, 'ru'));
app.get('/:locale(kk|en|zh|tr)/companies', (req, res) => {
  renderCompaniesCatalog(req, res, req.params.locale);
});

app.get('/companies/regions', (req, res) => {
  if (!companiesDb || !companiesDb.available()) return res.redirect('/companies');
  const regions = companiesDb.regionStats();
  const stats = companiesDb.stats();
  res.render('companies/regions', { regions, stats });
});

app.get('/companies/region/:slug', (req, res) => {
  if (!companiesDb || !companiesDb.available()) return res.redirect('/companies');
  const page = Number.parseInt(req.query.page, 10) || 1;
  const results = companiesDb.byRegion(req.params.slug, page, 30);
  if (!results.label) return sendNotFound(res);
  res.render('companies/region', { slug: req.params.slug, results });
});

app.get('/:locale(kk|en|zh|tr)/company/:slug', (req, res) => {
  renderCompanyItem(req, res, req.params.locale);
});
app.get('/company/:slug', (req, res) => renderCompanyItem(req, res, 'ru'));
app.get('/gsi',           (req, res) => res.render('gsi/catalog', { items: getGsiData() }));
app.get('/gsi/:slug',     (req, res) => {
  const item = getGsiData().find(g => g.slug === req.params.slug);
  if (!item) return sendNotFound(res);
  res.render('gsi/item', { item, lowContentBoost });
});
app.get('/insurance',     (req, res) => res.render('insurance/catalog', { items: getInsuranceData() }));
app.get('/insurance/:slug', (req, res) => {
  const item = getInsuranceData().find(c => c.slug === req.params.slug);
  if (!item) return sendNotFound(res);
  res.render('insurance/item', { item, lowContentBoost });
});
app.get('/credit-bureaus',(req, res) => res.render('credit-bureaus/catalog', { items: parseSemicolonCSV(path.join(__dirname, 'Кредитные_бюро_Казахстана.csv')) }));
app.get('/regulators',    (req, res) => res.render('regulators/catalog', { items: parseSemicolonCSV(path.join(__dirname, 'Финансовые_регуляторы_Казахстана.csv')) }));
app.get('/emergency',     (req, res) => res.render('emergency/catalog', { items: parseSemicolonCSV(path.join(__dirname, 'Экстренные_и_справочные_номера_Казахстана.csv')) }));

// ITEM PAGES: BANKS
app.get('/banks/:slug', (req, res) => {
  const bank = getBanksData().find(b => b.slug === req.params.slug);
  if (!bank) return sendNotFound(res);
  res.render('banks/item', { bank, lowContentBoost });
});

// ITEM PAGES: COURTS
app.get('/courts/:slug', (req, res) => {
  const court = getCourtsData().find(c => c.slug === req.params.slug);
  if (!court) return sendNotFound(res);
  res.render('courts/item', { court });
});

// ITEM PAGES: CHAMBERS
app.get('/chambers/:slug', (req, res) => {
  const chamber = getChambersData().find(c => c.slug === req.params.slug);
  if (!chamber) return sendNotFound(res);
  res.render('chambers/item', { chamber });
});

// ===== CSV-BACKED CATALOGS: COLLECTORS / LOMBARDS =====
// Some source CSVs were built by scrapers that, on failure, wrote the raw
// error message into a data column (e.g. "ошибка при сборе: HTTP Error 404:
// Not Found") instead of leaving it blank. Strip those out so visitors never
// see internal scraper errors, and so pages don't accidentally read as a
// soft-404 to crawlers.
function cleanScrapedNote(note) {
  const s = (note || '').trim();
  if (/ошибка при сборе|HTTP Error|Not Found|404/i.test(s)) return '';
  return s;
}

function parseSemicolonCSV(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const lines = raw.split(/\r?\n/);
    const headers = lines[0].split(';').map(h => h.replace(/^"|"$/g, '').trim());
    const rows = [];
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      // Quoted-field parser for semicolon delimiter. A field only enters
      // "quoted mode" if it STARTS with a quote (right after a delimiter or
      // at line start) — quotes appearing mid-field (e.g. Компания "Name")
      // are treated as literal characters, not togglers. This matches how
      // real-world exports (Excel/Sheets) actually escape fields, where
      // company names often contain unescaped inner quotes.
      const fields = [];
      let cur = '', inQ = false, fieldStart = true;
      for (let c = 0; c < line.length; c++) {
        const ch = line[c];
        if (ch === '"' && fieldStart && cur === '') {
          inQ = true; fieldStart = false; continue;
        }
        if (ch === '"' && inQ) {
          if (line[c + 1] === '"') { cur += '"'; c++; continue; }
          if (line[c + 1] === ';' || c === line.length - 1) { inQ = false; continue; }
          cur += ch; continue;
        }
        if (ch === ';' && !inQ) {
          fields.push(cur.trim()); cur = ''; fieldStart = true; continue;
        }
        cur += ch; fieldStart = false;
      }
      fields.push(cur.trim());
      const obj = {};
      headers.forEach((h, idx) => { obj[h] = (fields[idx] || '').replace(/^"+|"+$/g, '').trim(); });
      rows.push(obj);
    }
    return rows;
  } catch (e) { return []; }
}

function parseContacts(raw) {
  const parts = raw.split(/[,;\s]+(?=[\w+])/);
  const phones = [], emails = [], sites = [];
  const rawTokens = raw.split(/,\s*|;\s*|\s{2,}/);
  rawTokens.forEach(t => {
    t = t.trim().replace(/^["]+|["]+$/g, '');
    if (!t) return;
    if (t.includes('@')) emails.push(t);
    else if (/^https?:\/\//i.test(t) || /^www\./i.test(t)) sites.push(t.replace(/^https?:\/\//i,'').replace(/^www\./i,'').split('/')[0]);
    else if (/[\d\-\(\)\+]/.test(t) && t.replace(/[^\d]/g,'').length >= 7) phones.push(t);
  });
  return { phones: [...new Set(phones)], emails: [...new Set(emails)], sites: [...new Set(sites)] };
}

let _collectorsCache = null;
function getCollectors() {
  if (!_collectorsCache) {
    const rows = parseSemicolonCSV(path.join(__dirname, 'Коллекторские_агентства_Казахстана.csv'));
    const seen = {};
    _collectorsCache = rows
      .filter(r => (r['Статус'] || '').toLowerCase().includes('действу'))
      .map(r => {
        const contacts = parseContacts(r['Контакты (тел./email/сайт)'] || '');
        const bin = r['БИН'] || '';
        const name = (r['Название'] || '').replace(/^ТОО\s+"*|"*$/g, '').replace(/ТОО\s+/g,'').replace(/^"|"$/g,'').trim();
        let baseSlug = slugify(name) || 'kca-' + bin;
        if (!seen[baseSlug]) { seen[baseSlug] = 1; }
        else { seen[baseSlug]++; baseSlug = baseSlug + '-' + seen[baseSlug]; }
        return {
          slug: baseSlug,
          bin, name,
          nameFull: r['Название'] || '',
          regNum: r['Рег. номер (лицензия)'] || '',
          leader: r['Руководитель (ФИО)'] || '',
          address: r['Адрес'] || '',
          phones: contacts.phones,
          emails: contacts.emails,
          sites: contacts.sites,
          dateAdded: r['Дата включения в реестр'] || '',
        };
      });
  }
  return _collectorsCache;
}

let _mfoCache = null;
function getMfoData() {
  if (!_mfoCache) {
    const rows = parseSemicolonCSV(path.join(__dirname, 'МФО_Ломбарды_КредТоварищества_Казахстана.csv'));
    _mfoCache = { mfo: [], lombards: [], kredTov: [] };
    rows.forEach(r => {
      const cat = (r['Категория'] || '').trim();
      const entryName = (r['Название (реестр АРРФР)'] || '')
        .trim()
        .replace(/^[«»"'“”]+/, '')
        .replace(/^(товарищество с ограниченной ответственностью|тоо)\s+/i, '')
        .replace(/^[«»"'“”]+/, '')
        .replace(/[«»"'“”]+$/, '')
        .trim();
      const entry = {
        name: entryName,
        slug: slugify(entryName) || 'bin-' + (r['БИН'] || ''),
        nameFull: r['Полное название (гос. регистр)'] || '',
        bin: r['БИН'] || '',
        address: r['Юридический адрес'] || '',
        leader: r['Руководитель'] || '',
        note: cleanScrapedNote(r['Примечание']),
      };
      if (cat === 'МФО') _mfoCache.mfo.push(entry);
      else if (cat === 'Ломбард') _mfoCache.lombards.push(entry);
      else if (cat === 'Кредитное товарищество') _mfoCache.kredTov.push(entry);
    });
  }
  return _mfoCache;
}

app.get('/collectors', (req, res) => {
  const catalog = paginateCatalog(getCollectors(), req, item => [
    item.name, item.nameFull, item.bin, item.regNum, item.leader, item.address,
    ...(item.phones || []), ...(item.emails || []), ...(item.sites || []),
  ].join(' '));
  res.render('collectors/catalog', { items: catalog.items, catalog, lowContentBoost });
});

app.get('/collectors/:slug', (req, res) => {
  const item = getCollectors().find(c => c.slug === req.params.slug);
  if (!item) return sendNotFound(res);
  res.render('collectors/item', { item, lowContentBoost });
});

app.get('/mfo', (req, res) => {
  const { mfo } = getMfoData();
  const catalog = paginateCatalog(mfo, req, item => [
    item.name, item.nameFull, item.bin, item.address, item.leader,
  ].join(' '));
  res.render('mfo/catalog', { mfo: catalog.items, catalog, lowContentBoost });
});

app.get('/mfo/:slug', (req, res) => {
  const { mfo } = getMfoData();
  const item = mfo.find(m => m.slug === req.params.slug);
  if (!item) return sendNotFound(res);
  res.render('mfo/item', { item, lowContentBoost });
});

app.get('/lombards', (req, res) => {
  const { lombards } = getMfoData();
  const catalog = paginateCatalog(lombards, req, item => [
    item.name, item.nameFull, item.bin, item.address, item.leader,
  ].join(' '));
  res.render('lombards/catalog', { items: catalog.items, catalog, lowContentBoost });
});

app.get('/lombards/:slug', (req, res) => {
  const { lombards } = getMfoData();
  const item = lombards.find(l => l.slug === req.params.slug);
  if (!item) return sendNotFound(res);
  res.render('lombards/item', { item, lowContentBoost });
});

// ===== LAWYER SEARCH =====
app.get('/lawyer-search', asyncHandler(async (req, res) => {
  const q = (req.query.q || '').trim();
  let results = null;
  let suggestion = null;
  if (q.length >= 2 && lawyersDb) {
    results = await lawyersDb.search(q);
    if (results.length === 0) {
      suggestion = await lawyersDb.fuzzySearch(q);
    }
  } else if (q.length >= 2) {
    results = [];
  }
  res.render('lawyer/search', { query: q, results, suggestion });
}));

// ===== BAILIFF SEO PAGES =====

app.get('/bailiff/:slug', asyncHandler(async (req, res) => {
  if (!bailiffsDb) return res.status(503).send('Bailiff module not available');
  const bailiff = await bailiffsDb.findBySlug(req.params.slug);
  if (!bailiff) return sendNotFound(res);
  const [comments, commentStats] = commentsDb
    ? await Promise.all([commentsDb.getApproved('bailiff', req.params.slug), commentsDb.stats('bailiff', req.params.slug)])
    : [[], null];
  res.render('bailiff/page', { bailiff, comments, commentStats, commentSent: req.query.comment === 'sent' });
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
    <loc>https://zakonexpertt.kz/bailiffs?region=${encodeURIComponent(r.region)}</loc>
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

app.post('/api/bailiffs/import', asyncHandler(async (req, res) => {
  if (!checkAdminKey(req, res)) return;
  if (!importBailiffs) return res.status(503).json({ error: 'Bailiff module not available' });
  const count = await importBailiffs();
  res.json({ ok: true, imported: count });
}));

// ===== LAWYER SEO PAGES =====

app.get('/lawyer/:slug', asyncHandler(async (req, res) => {
  if (!lawyersDb) return res.status(503).send('Lawyer module not available');
  const lawyer = await lawyersDb.findBySlug(req.params.slug);
  if (!lawyer) return sendNotFound(res);
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

let _lawsSitemapCache = null;
let _lawsSitemapCacheAt = 0;
app.get('/sitemap-laws.xml', asyncHandler(async (req, res) => {
  res.set('Content-Type', 'application/xml');
  res.set('Cache-Control', 'public, max-age=3600, stale-while-revalidate=86400');
  if (!lawsDb) {
    return res.send('<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>');
  }
  if (!_lawsSitemapCache || Date.now() - _lawsSitemapCacheAt > 15 * 60 * 1000) {
    const all = await lawsDb.getAllSlugs();
    const today = new Date().toISOString().substring(0, 10);
    const urls = all.map(a => `
  <url>
    <loc>https://zakonexpertt.kz/statya/${a.slug}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.7</priority>
  </url>`).join('');
    _lawsSitemapCache = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  ${urls}
</urlset>`;
    _lawsSitemapCacheAt = Date.now();
  }
  res.send(_lawsSitemapCache);
}));

app.post('/api/lawyers/import', asyncHandler(async (req, res) => {
  if (!checkAdminKey(req, res)) return;
  if (!importLawyers) return res.status(503).json({ error: 'Lawyer module not available' });
  const count = await importLawyers();
  res.json({ ok: true, imported: count });
}));

app.post('/api/lawyers/refresh', asyncHandler(async (req, res) => {
  if (!checkAdminKey(req, res)) return;
  if (!refreshLawyersRegistry || !importLawyers) {
    return res.status(503).json({ error: 'Lawyer module not available' });
  }
  const registry = await refreshLawyersRegistry();
  const count = await importLawyers();
  res.json({ ok: true, registry, imported: count });
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
  const requestedPage = Math.max(1, Math.min(10000, Number.parseInt(req.query.page, 10) || 1));
  const page = code && !q ? requestedPage : 1;
  const pageSize = 30;
  const [articles, codes, total] = await Promise.all([
    code && !q ? lawsDb.findByCodePage(code, pageSize, (page - 1) * pageSize)
    : q        ? lawsDb.search(q, code, 60)
    :            Promise.resolve([]),
    lawsDb.getCodes(),
    code && !q ? lawsDb.count({ code }) : Promise.resolve(0),
  ]);
  const pages = code && !q ? Math.max(1, Math.ceil(total / pageSize)) : 1;
  if (page > pages && code && !q) {
    return res.redirect(302, `/statyi?code=${encodeURIComponent(code)}&page=${pages}`);
  }
  res.render('laws/list', {
    q,
    code,
    articles,
    codes,
    total: code && !q ? total : articles.length,
    page,
    pages,
  });
}));

// Individual article page
app.get('/statya/:slug', asyncHandler(async (req, res) => {
  if (!lawsDb) return res.redirect('/statyi');
  const article = await lawsDb.findBySlug(req.params.slug);
  if (!article) return sendNotFound(res);
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
app.get('/api/bankruptcy-check', externalApiLimiter, asyncHandler(async (req, res) => {
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
app.get('/api/erdr-check', externalApiLimiter, asyncHandler(async (req, res) => {
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

app.get('/api/inscription-session', externalApiLimiter, asyncHandler(async (req, res) => {
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

app.get('/api/inscription-captcha', externalApiLimiter, asyncHandler(async (req, res) => {
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

app.post('/api/inscription-check', externalApiLimiter, asyncHandler(async (req, res) => {
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

// Gallery page
app.get('/gallery', (req, res) => res.sendFile(path.join(__dirname, 'public', 'gallery.html')));

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
  '/besspornost-dolga':                'besspornost-dolga.html',
  '/alimenty-i-aresty':                'alimenty-i-aresty.html',
  '/shtrafy-i-aresty':                 'shtrafy-i-aresty.html',
  '/chsi-refinansirovanie':            'chsi-refinansirovanie.html',
  '/otmena-resheniya-suda':            'otmena-resheniya-suda.html',
  '/dokumenty':                        'dokumenty.html',
  '/rezultaty':                        'rezultaty.html',
  '/mediator':                         'mediator.html',
  '/privacy':                          'privacy.html',
  '/services':                         'services.html',
  '/contact':                          'contact.html',
  '/sms-1414':                         'sms-1414.html',
  '/zapret-na-vyezd-iz-kazahstana':    'zapret-na-vyezd-iz-kazahstana.html',
  '/zhaloba-na-chsi':                  'zhaloba-na-chsi.html',
  '/chsi-ne-snimaet-arest-posle-oplaty': 'chsi-ne-snimaet-arest-posle-oplaty.html',
  '/arest-zarplatnoy-karty':           'arest-zarplatnoy-karty.html',
  '/snyat-arest-s-nedvizhimosti':      'snyat-arest-s-nedvizhimosti.html',
  '/nadpis-ili-list':                  'nadpis-ili-list.html',
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

function cleanNewsText(value = '') {
  return String(value)
    .replace(/[\u00a0\u2007\u202f]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\s+(?:[\w-]+\.)+(?:kz|ru|com|org|net)$/iu, '')
    .trim();
}

function newsDisplayTitle(article) {
  return cleanNewsText(article.original_title || article.title || 'Новости ZakonExpert');
}

function newsDisplayExcerpt(article) {
  const value = cleanNewsText(article.excerpt || article.original_excerpt || '');
  return value.length >= 45
    ? value
    : 'Разбираем событие, объясняем правовые последствия и даём понятный алгоритм действий.';
}

function xmlCdata(value = '') {
  return String(value).replace(/\]\]>/g, ']]]]><![CDATA[>');
}

function xmlEscape(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function newsCoverLines(value, maxChars = 34, maxLines = 3) {
  const words = cleanNewsText(value).split(' ').filter(Boolean);
  const lines = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (next.length > maxChars && line) {
      lines.push(line);
      line = word;
      if (lines.length === maxLines - 1) break;
    } else {
      line = next;
    }
  }
  if (line && lines.length < maxLines) lines.push(line);
  const used = lines.join(' ').length;
  if (used < cleanNewsText(value).length && lines.length) {
    lines[lines.length - 1] = `${lines[lines.length - 1].replace(/[.,:;!?—-]+$/u, '')}…`;
  }
  return lines;
}

function newsCoverTheme(article) {
  const text = `${article.category || ''} ${article.tags || ''} ${newsDisplayTitle(article)}`.toLowerCase();
  if (/чси|исполнител/.test(text)) return { label: 'ЧСИ И ВЗЫСКАНИЕ', accent: '#e4b64d', symbol: '§' };
  if (/нотари|надпис/.test(text)) return { label: 'НОТАРИАТ', accent: '#77b7ff', symbol: 'N' };
  if (/авто|транспорт/.test(text)) return { label: 'АВТО И ОГРАНИЧЕНИЯ', accent: '#65d1b4', symbol: 'A' };
  if (/суд|апелляц/.test(text)) return { label: 'СУДЕБНАЯ ПРАКТИКА', accent: '#caa7ff', symbol: '⚖' };
  if (/банк|кредит|мфо|долг/.test(text)) return { label: 'ФИНАНСЫ И ДОЛГИ', accent: '#e4b64d', symbol: '₸' };
  return { label: 'НОВОСТИ И ПРАВО', accent: '#e4b64d', symbol: 'ZE' };
}

function buildNewsCoverSvg(article) {
  const title = newsDisplayTitle(article);
  const theme = newsCoverTheme(article);
  const lines = newsCoverLines(title);
  const tspans = lines.map((line, index) =>
    `<tspan x="88" dy="${index === 0 ? 0 : 67}">${xmlEscape(line)}</tspan>`
  ).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630" role="img" aria-labelledby="title desc">
  <title id="title">${xmlEscape(title)}</title>
  <desc id="desc">Редакционная обложка ZakonExpert</desc>
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#06172d"/><stop offset="0.58" stop-color="#0d2f58"/><stop offset="1" stop-color="#174e7d"/></linearGradient>
    <radialGradient id="glow" cx="80%" cy="20%" r="70%"><stop stop-color="${theme.accent}" stop-opacity=".24"/><stop offset="1" stop-color="${theme.accent}" stop-opacity="0"/></radialGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#bg)"/>
  <rect width="1200" height="630" fill="url(#glow)"/>
  <g fill="none" stroke="${theme.accent}" stroke-opacity=".16"><circle cx="1010" cy="205" r="178" stroke-width="2"/><circle cx="1010" cy="205" r="132"/><path d="M1010 58l126 70v142l-126 76-126-76V128z" stroke-width="3"/></g>
  <g transform="translate(910 105)"><rect width="200" height="200" rx="100" fill="#06172d" fill-opacity=".58" stroke="${theme.accent}" stroke-width="3"/><text x="100" y="125" text-anchor="middle" fill="${theme.accent}" font-family="Arial, sans-serif" font-size="72" font-weight="700">${xmlEscape(theme.symbol)}</text></g>
  <rect x="88" y="72" width="74" height="4" rx="2" fill="${theme.accent}"/>
  <text x="88" y="113" fill="${theme.accent}" font-family="Arial, sans-serif" font-size="21" font-weight="700" letter-spacing="2">${xmlEscape(theme.label)}</text>
  <text x="88" y="218" fill="#ffffff" font-family="Arial, sans-serif" font-size="53" font-weight="700">${tspans}</text>
  <line x1="88" y1="525" x2="1112" y2="525" stroke="#ffffff" stroke-opacity=".18"/>
  <text x="88" y="574" fill="#ffffff" font-family="Arial, sans-serif" font-size="26" font-weight="700" letter-spacing="2">ZAKONEXPERT</text>
  <text x="1112" y="574" text-anchor="end" fill="#ffffff" fill-opacity=".62" font-family="Arial, sans-serif" font-size="19">Юридический разбор · Казахстан</text>
</svg>`;
}

// NEWS LIST
app.get('/news', asyncHandler(async (req, res) => {
  if (!newsDb) return res.status(503).send('News module not available');
  if (req.query.cat === 'Адвокат') return res.redirect(301, '/advocate');
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const category = (req.query.cat && req.query.cat !== 'Адвокат') ? req.query.cat : null;
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
    allowSourceImages: process.env.NEWS_USE_SOURCE_IMAGES !== 'false',
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
      <title><![CDATA[${xmlCdata(newsDisplayTitle(a))}]]></title>
      <link>https://zakonexpertt.kz/news/${a.slug}</link>
      <guid isPermaLink="true">https://zakonexpertt.kz/news/${a.slug}</guid>
      <pubDate>${new Date(a.published_at_source || a.published_at_site || a.created_at).toUTCString()}</pubDate>
      <description><![CDATA[${xmlCdata(newsDisplayExcerpt(a))}]]></description>
      <category><![CDATA[${xmlCdata(a.category || 'general')}]]></category>
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
  const cutoff = Date.now() - (2 * 24 * 60 * 60 * 1000);
  const articles = (await newsDb.getAllForSitemap()).filter(article => {
    const publishedAt = article.published_at_source || article.published_at_site;
    return publishedAt && Date.parse(publishedAt) >= cutoff;
  });
  const urls = articles.map(a => {
    const publishedAt = a.published_at_source || a.published_at_site;
    return `
  <url>
    <loc>https://zakonexpertt.kz/news/${xmlEscape(a.slug)}</loc>
    <lastmod>${(a.updatedAt || a.published_at_source || a.published_at_site || new Date().toISOString()).substring(0, 10)}</lastmod>
    <news:news>
      <news:publication>
        <news:name>ZakonExpert</news:name>
        <news:language>ru</news:language>
      </news:publication>
      <news:publication_date>${xmlEscape(new Date(publishedAt).toISOString())}</news:publication_date>
      <news:title>${xmlEscape(newsDisplayTitle(a))}</news:title>
    </news:news>
  </url>`;
  }).join('');

  res.set('Content-Type', 'application/xml');
  res.send(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">
  ${urls}
</urlset>`);
}));

// SITEMAP-PAGES.XML
function getCorePages() {
  const pages = [
    { url: '/', priority: '1.0', freq: 'weekly' },
    { url: '/services', priority: '0.9', freq: 'monthly' },
    { url: '/contact', priority: '0.8', freq: 'monthly' },
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
    // Региональные страницы
    { url: '/snyatie-aresta-almaty', priority: '0.8', freq: 'monthly' },
    { url: '/snyatie-aresta-astana', priority: '0.8', freq: 'monthly' },
    { url: '/snyatie-aresta-shymkent', priority: '0.8', freq: 'monthly' },
    { url: '/snyatie-aresta-taldykorgan', priority: '0.75', freq: 'monthly' },
    { url: '/snyatie-aresta-karaganda', priority: '0.75', freq: 'monthly' },
    // Дополнительные сервисные страницы
    { url: '/besspornost-dolga', priority: '0.8', freq: 'monthly' },
    { url: '/alimenty-i-aresty', priority: '0.8', freq: 'monthly' },
    { url: '/shtrafy-i-aresty', priority: '0.8', freq: 'monthly' },
    { url: '/zakony', priority: '0.85', freq: 'weekly' },
    { url: '/advocate', priority: '0.85', freq: 'monthly' },
    { url: '/mediator', priority: '0.8', freq: 'monthly' },
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
    // Каталоги финансовых организаций
    { url: '/banks',          priority: '0.85', freq: 'weekly' },
    { url: '/mfo',            priority: '0.85', freq: 'weekly' },
    { url: '/lombards',       priority: '0.8',  freq: 'weekly' },
    { url: '/courts',         priority: '0.8',  freq: 'weekly' },
    { url: '/chambers',       priority: '0.8',  freq: 'weekly' },
    { url: '/collectors',     priority: '0.8',  freq: 'weekly' },
    { url: '/companies',      priority: '0.9',  freq: 'weekly' },
    { url: '/kk/companies',   priority: '0.75', freq: 'weekly' },
    { url: '/en/companies',   priority: '0.75', freq: 'weekly' },
    { url: '/zh/companies',   priority: '0.7',  freq: 'weekly' },
    { url: '/tr/companies',   priority: '0.7',  freq: 'weekly' },
    { url: '/companies/regions', priority: '0.8', freq: 'weekly' },
    { url: '/gsi',            priority: '0.8',  freq: 'weekly' },
    { url: '/insurance',      priority: '0.75', freq: 'weekly' },
    { url: '/credit-bureaus', priority: '0.7',  freq: 'monthly' },
    { url: '/regulators',     priority: '0.65', freq: 'monthly' },
    { url: '/emergency',      priority: '0.6',  freq: 'monthly' },
    // Инструменты
    { url: '/calculator',     priority: '0.85', freq: 'monthly' },
    { url: '/marshrut-dolzhnika', priority: '0.9', freq: 'monthly' },
    { url: '/bin-search',     priority: '0.8',  freq: 'monthly' },
    { url: '/gallery',        priority: '0.85', freq: 'monthly' },
    { url: '/press',          priority: '0.7',  freq: 'monthly' },
    { url: '/sms-1414',       priority: '0.9',  freq: 'monthly' },
    // Новые страницы из плана x1000
    { url: '/zapret-na-vyezd-iz-kazahstana',    priority: '0.85', freq: 'monthly' },
    { url: '/zhaloba-na-chsi',                  priority: '0.85', freq: 'monthly' },
    { url: '/chsi-ne-snimaet-arest-posle-oplaty', priority: '0.85', freq: 'monthly' },
    { url: '/arest-zarplatnoy-karty',           priority: '0.85', freq: 'monthly' },
    { url: '/snyat-arest-s-nedvizhimosti',      priority: '0.85', freq: 'monthly' },
    { url: '/nadpis-ili-list',                  priority: '0.9',  freq: 'monthly' },
  ];
  TOOLS.forEach(tool => {
    if (!pages.some(page => page.url === tool.href)) {
      pages.push({ url: tool.href, priority: '0.82', freq: 'monthly' });
    }
  });
  if (companiesDb) {
    companiesDb.regionStats().forEach(region => {
      pages.push({ url: `/companies/region/${region.slug}`, priority: '0.6', freq: 'weekly' });
    });
  }
  return pages;
}

app.get('/sitemap-pages.xml', (req, res) => {
  const pages = getCorePages();
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

// SITEMAP.TXT — plain URL list for AI crawlers (GPTBot, PerplexityBot, ClaudeBot, etc.)
// that prefer a lightweight format over parsing XML.
app.get('/sitemap.txt', asyncHandler(async (req, res) => {
  const urls = getCorePages().map(p => `https://zakonexpertt.kz${p.url}`);
  if (newsDb) {
    const articles = await newsDb.getAllForSitemap();
    articles.forEach(a => urls.push(`https://zakonexpertt.kz/news/${a.slug}`));
  }
  res.set('Content-Type', 'text/plain; charset=utf-8');
  res.send(urls.join('\n'));
}));

// SITEMAPS: CSV-backed catalogs (banks, courts, mfo, lombards, gsi, insurance, collectors, chambers)
function csvSitemap(res, items, prefix) {
  const today = new Date().toISOString().substring(0, 10);
  const urls = items.filter(i => i.slug).map(i => `
  <url>
    <loc>https://zakonexpertt.kz/${prefix}/${i.slug}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.6</priority>
  </url>`).join('');
  res.set('Content-Type', 'application/xml');
  res.send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}\n</urlset>`);
}

app.get('/sitemap-banks.xml',      (req, res) => csvSitemap(res, getBanksData(),      'banks'));
app.get('/sitemap-courts.xml',     (req, res) => csvSitemap(res, getCourtsData(),     'courts'));
app.get('/sitemap-chambers.xml',   (req, res) => csvSitemap(res, getChambersData(),   'chambers'));
app.get('/sitemap-collectors.xml', (req, res) => csvSitemap(res, getCollectors(),     'collectors'));
app.get('/sitemap-gsi.xml',        (req, res) => csvSitemap(res, getGsiData(),        'gsi'));
app.get('/sitemap-insurance.xml',  (req, res) => csvSitemap(res, getInsuranceData(),  'insurance'));
app.get('/sitemap-mfo.xml', (req, res) => {
  const { mfo } = getMfoData();
  csvSitemap(res, mfo, 'mfo');
});
app.get('/sitemap-lombards.xml', (req, res) => {
  const { lombards } = getMfoData();
  csvSitemap(res, lombards, 'lombards');
});

// COMPANY SITEMAPS — bounded LRU cache. Caching every company sitemap caused a
// memory leak: 81 chunks × ~2.4 MB could retain roughly 190 MB in a 1 GB hosting
// account. Two recent chunks are enough to absorb crawler retries.
const _companiesSitemapCache = new Map();
const COMPANIES_SITEMAP_CACHE_MAX = 2;
function buildCompaniesSitemapChunk(chunk) {
  let xml = _companiesSitemapCache.get(chunk);
  if (xml) {
    _companiesSitemapCache.delete(chunk);
    _companiesSitemapCache.set(chunk, xml);
    return xml;
  }
  const sourceDate = String(companiesDb.stats().qualityUpdatedAt || companiesDb.stats().updatedAt || new Date().toISOString()).substring(0, 10);
  const urls = companiesDb.sitemapChunk(chunk).map(company => `
  <url>
    <loc>https://zakonexpertt.kz/company/${company.slug}</loc>
    <lastmod>${sourceDate}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.55</priority>
  </url>`).join('');
  xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}
</urlset>`;
  _companiesSitemapCache.set(chunk, xml);
  while (_companiesSitemapCache.size > COMPANIES_SITEMAP_CACHE_MAX) {
    _companiesSitemapCache.delete(_companiesSitemapCache.keys().next().value);
  }
  return xml;
}
app.get(/^\/sitemap-companies-(\d+)\.xml$/, (req, res) => {
  const chunk = Number.parseInt(req.params[0], 10);
  const totalChunks = companiesDb ? companiesDb.sitemapChunkCount() : 0;
  if (!chunk || chunk > totalChunks) return res.status(404).send('Sitemap chunk not found');

  res.set('Content-Type', 'application/xml');
  res.set('Cache-Control', 'public, max-age=3600, stale-while-revalidate=86400');
  res.send(buildCompaniesSitemapChunk(chunk));
});

// IMAGE SITEMAP — key SEO images (gallery + hero images on money pages)
app.get('/sitemap-image.xml', (req, res) => {
  const galleryImages = [
    ['snyatie-aresta-scheta-zakonexpert.svg', 'Снятие ареста со счёта Казахстан — ZakonExpert юридическая помощь'],
    ['kak-snyat-arest-scheta-kazakhstan.svg', 'Как снять арест со счёта в Казахстане — пошаговая инструкция ZakonExpert'],
    ['snyt-arest-kazakhstan-zakonexpert.svg', 'Снять арест Казахстан — Kaspi Halyk МФО ЧСИ ZakonExpert'],
    ['arest-kaspi-halyk-bank-kazakhstan.svg', 'Арест Kaspi и Halyk Bank Казахстан — снятие ареста ZakonExpert'],
    ['snyatie-aresta-zarplaty-chsi.svg', 'Снятие ареста с зарплаты ЧСИ Казахстан — ZakonExpert'],
    ['mfo-arest-scheta-dolg-kazakhstan.svg', 'МФО арест счёта за долг Казахстан — ZakonExpert'],
    ['otmena-ispolnitelnoy-nadpisi-notariusa.svg', 'Отмена исполнительной надписи нотариуса — ZakonExpert'],
    ['besporno-dolg-mfo-bank-osporit.svg', 'Спорность долга МФО и банка — как оспорить — ZakonExpert'],
    ['snyatie-zapreta-na-avto-kazakhstan.svg', 'Снятие запрета на авто Казахстан — ZakonExpert'],
    ['snyatie-zapreta-vyezd-rubezh-kazakhstan.svg', 'Снятие запрета на выезд за рубеж Казахстан — ZakonExpert'],
    ['snyatie-aresta-imushchestvo-kazakhstan.svg', 'Снятие ареста с имущества Казахстан — ZakonExpert'],
    ['pomosh-chsi-aresty-schetov-kazakhstan.svg', 'Помощь при аресте счетов ЧСИ Казахстан — ZakonExpert'],
    ['grafik-platezhey-chsi-mfo-bank.svg', 'График платежей ЧСИ, МФО, банк — ZakonExpert'],
    ['snyatie-ogranicheniy-chsi-notarius.svg', 'Снятие ограничений ЧСИ и нотариуса — ZakonExpert'],
    ['yurist-snyatie-arestov-almaty-kazakhstan.svg', 'Юрист по снятию арестов в Алматы — ZakonExpert'],
    ['uslugi-zakonexpert-kazakhstan.svg', 'Услуги ZakonExpert Казахстан — снятие арестов, ЧСИ, МФО, адвокат'],
  ];
  const heroImages = [
    ['/arest-kaspi', 'arest-kaspi-halyk-bank-kazakhstan.svg', 'Арест карты Kaspi Bank Казахстан — снятие ареста ZakonExpert'],
    ['/arest-halyk-bank', 'arest-kaspi-halyk-bank-kazakhstan.svg', 'Арест счёта Halyk Bank Казахстан — снятие ареста ZakonExpert'],
    ['/snyatie-aresta-so-scheta', 'snyatie-aresta-scheta-zakonexpert.svg', 'Снятие ареста со счёта Казахстан — помощь юриста ZakonExpert'],
    ['/snyatie-zapreta-na-avto', 'snyatie-zapreta-na-avto-kazakhstan.svg', 'Снятие запрета на автомобиль Казахстан — юридическая помощь ZakonExpert'],
    ['/snyatie-ogranichenii-chsi', 'pomosh-chsi-aresty-schetov-kazakhstan.svg', 'ЧСИ наложил арест на счёт — снятие ограничений ZakonExpert Казахстан'],
    ['/otmena-ispolnitelnoi-nadpisi', 'otmena-ispolnitelnoy-nadpisi-notariusa.svg', 'Отмена исполнительной надписи нотариуса о взыскании задолженности — ZakonExpert'],
    ['/vozrazhenie-na-ispolnitelnuyu-nadpis', 'infographic-spornost-dolga.svg', 'Спорность долга и отмена исполнительной надписи'],
    ['/zakony', 'infographic-osnovanie-aresta.svg', 'Основание ареста счёта через исполнительное производство'],
    ['/services', 'uslugi-zakonexpert-kazakhstan.svg', 'Услуги ZakonExpert Казахстан — снятие арестов, отмена надписи, ЧСИ, МФО, адвокат'],
  ];

  let urls = `  <url>
    <loc>https://zakonexpertt.kz/gallery</loc>
${galleryImages.map(([file, caption]) => `    <image:image>
      <image:loc>https://zakonexpertt.kz/img/seo/${file}</image:loc>
      <image:caption>${caption.replace(/&/g, '&amp;')}</image:caption>
    </image:image>`).join('\n')}
  </url>`;

  urls += heroImages.map(([page, file, caption]) => `
  <url>
    <loc>https://zakonexpertt.kz${page}</loc>
    <image:image>
      <image:loc>https://zakonexpertt.kz/img/seo/${file}</image:loc>
      <image:caption>${caption.replace(/&/g, '&amp;')}</image:caption>
    </image:image>
  </url>`).join('');

  res.set('Content-Type', 'application/xml');
  res.send(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
${urls}
</urlset>`);
});

// Legacy static index (frozen 2026-06-19, only 6 of the current 32 sitemaps)
// — redirect so it doesn't sit in Search Console as a separate stale entry.
app.get('/sitemap.xml', (req, res) => res.redirect(301, '/sitemap-index.xml'));

// SITEMAP INDEX
app.get('/sitemap-index.xml', (req, res) => {
  const today = new Date().toISOString().substring(0, 10);
  const companyLastmod = companiesDb
    ? String(companiesDb.stats().qualityUpdatedAt || companiesDb.stats().updatedAt || today).substring(0, 10)
    : today;
  const companySitemaps = companiesDb
    ? Array.from({ length: companiesDb.sitemapChunkCount() }, (_, index) => `
  <sitemap>
    <loc>https://zakonexpertt.kz/sitemap-companies-${index + 1}.xml</loc>
    <lastmod>${companyLastmod}</lastmod>
  </sitemap>`).join('')
    : '';
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
  <sitemap>
    <loc>https://zakonexpertt.kz/sitemap-banks.xml</loc>
    <lastmod>${today}</lastmod>
  </sitemap>
  <sitemap>
    <loc>https://zakonexpertt.kz/sitemap-courts.xml</loc>
    <lastmod>${today}</lastmod>
  </sitemap>
  <sitemap>
    <loc>https://zakonexpertt.kz/sitemap-chambers.xml</loc>
    <lastmod>${today}</lastmod>
  </sitemap>
  <sitemap>
    <loc>https://zakonexpertt.kz/sitemap-collectors.xml</loc>
    <lastmod>${today}</lastmod>
  </sitemap>
  <sitemap>
    <loc>https://zakonexpertt.kz/sitemap-gsi.xml</loc>
    <lastmod>${today}</lastmod>
  </sitemap>
  <sitemap>
    <loc>https://zakonexpertt.kz/sitemap-insurance.xml</loc>
    <lastmod>${today}</lastmod>
  </sitemap>
  <sitemap>
    <loc>https://zakonexpertt.kz/sitemap-mfo.xml</loc>
    <lastmod>${today}</lastmod>
  </sitemap>
  <sitemap>
    <loc>https://zakonexpertt.kz/sitemap-image.xml</loc>
    <lastmod>${today}</lastmod>
  </sitemap>
  <sitemap>
    <loc>https://zakonexpertt.kz/sitemap-lombards.xml</loc>
    <lastmod>${today}</lastmod>
  </sitemap>
  ${companySitemaps}
</sitemapindex>`);
});

// Unique, lightweight editorial cover for every article. The SVG is generated
// on request, so hundreds of news pages do not consume extra hosting storage
// and never depend on third-party image hotlinks.
app.get('/news/cover/:slug', asyncHandler(async (req, res) => {
  if (!newsDb) return res.status(503).send('News module not available');
  const slug = String(req.params.slug || '').replace(/\.svg$/i, '');
  const article = await newsDb.getBySlug(slug);
  if (!article) return res.status(404).send('Cover not found');
  res.set({
    'Content-Type': 'image/svg+xml; charset=utf-8',
    'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800',
    'X-Content-Type-Options': 'nosniff',
  });
  res.send(buildNewsCoverSvg(article));
}));

// NEWS DETAIL (must be after feed.xml, category and cover routes)
app.get('/news/:slug', asyncHandler(async (req, res) => {
  if (!newsDb) return res.status(503).send('News module not available');
  const article = await newsDb.getBySlug(req.params.slug);
  if (!article) return sendNotFound(res);

  const displayTitle = newsDisplayTitle(article);
  const displayExcerpt = newsDisplayExcerpt(article);
  const isAdvokat = article.category === 'Адвокат';
  const generated = !isAdvokat && newsImporter?.buildGeneratedContent
    ? newsImporter.buildGeneratedContent(displayTitle, displayExcerpt)
    : {};
  const articleView = {
    ...article,
    display_title: displayTitle,
    display_excerpt: displayExcerpt,
    event_summary: article.event_summary || generated.event_summary || displayExcerpt,
    why_important: article.why_important || generated.why_important || '',
    legal_commentary: article.legal_commentary || generated.legal_commentary || '',
    what_to_check: article.what_to_check || JSON.stringify(generated.what_to_check || []),
    when_to_seek_help: article.when_to_seek_help || generated.when_to_seek_help || '',
    display_cover: (
      String(article.og_image || '').startsWith('/img/')
      || (process.env.NEWS_USE_SOURCE_IMAGES !== 'false' && /^https:\/\//i.test(article.og_image || ''))
    ) ? article.og_image : `/news/cover/${encodeURIComponent(article.slug)}.svg`,
    fallback_cover: `/news/cover/${encodeURIComponent(article.slug)}.svg`,
  };
  const rawSchemaImage = articleView.display_cover;
  const schemaImage = /^https:\/\//i.test(rawSchemaImage)
    ? rawSchemaImage
    : `https://zakonexpertt.kz${rawSchemaImage.startsWith('/') ? '' : '/'}${rawSchemaImage}`;

  const tagsArr = JSON.parse(article.tags || '[]');
  const relatedRaw = tagsArr.length > 0
    ? await newsDb.getByTags(tagsArr[0])
    : await newsDb.getPublished(5, 0);
  const related = relatedRaw
    .filter(r => r.slug !== article.slug && (isAdvokat ? r.category === 'Адвокат' : r.category !== 'Адвокат'))
    .slice(0, 4);

  const pubDate = new Date(article.published_at_source || article.published_at_site || article.created_at);
  const schema = {
    '@context': 'https://schema.org',
    '@type': 'NewsArticle',
    headline: displayTitle,
    description: article.meta_desc || displayExcerpt,
    url: `https://zakonexpertt.kz/news/${article.slug}`,
    datePublished: pubDate.toISOString(),
    dateModified: article.updated_at || pubDate.toISOString(),
    publisher: {
      '@type': 'Organization',
      name: 'ZakonExpert',
      url: 'https://zakonexpertt.kz'
    },
    image: schemaImage,
  };

  res.render('news/detail', {
    title: `${displayTitle.substring(0, 62)} | ZakonExpert`,
    description: (article.meta_desc || displayExcerpt).substring(0, 160),
    canonical: article.canonical_url || `https://zakonexpertt.kz/news/${article.slug}`,
    ogType: 'article',
    ogImage: articleView.display_cover,
    article: articleView,
    related,
    schema,
  });
}));

function secretsEqual(provided, expected) {
  const expectedBuffer = Buffer.from(String(expected || ''));
  const providedBuffer = Buffer.from(String(provided || ''));
  return providedBuffer.length === expectedBuffer.length
    && crypto.timingSafeEqual(providedBuffer, expectedBuffer);
}

// ADMIN KEY helper
function checkAdminKey(req, res) {
  const adminKey = process.env.ADMIN_KEY;
  if (!adminKey || adminKey.length < 24) {
    logger.error('[Security] ADMIN_KEY is missing or shorter than 24 characters; admin route denied');
    res.status(503).json({ error: 'Admin API отключён: настройте ADMIN_KEY длиной не менее 24 символов' });
    return false;
  }
  const provided = String(req.headers['x-admin-key'] || '');
  if (!secretsEqual(provided, adminKey)) {
    res.status(403).json({ error: 'Forbidden — provide a valid x-admin-key header' });
    return false;
  }
  return true;
}

const ADMIN_MUTATION_PATHS = [
  '/api/notaries/import',
  '/api/notaries/refresh',
  '/api/bailiffs/import',
  '/api/lawyers/import',
  '/api/lawyers/refresh',
  '/api/news/import',
  '/api/news/clear',
  '/api/news/reset',
  '/api/news/fix-images',
  '/api/telegram/setup',
];
app.get(ADMIN_MUTATION_PATHS, (req, res) => {
  res.set('Allow', 'POST');
  res.status(405).json({ error: 'Method Not Allowed — use POST with x-admin-key' });
});

// POST /api/news/import — manual trigger
app.post('/api/news/import', asyncHandler(async (req, res) => {
  if (!checkAdminKey(req, res)) return;
  if (!newsImporter) return res.status(503).json({ error: 'News module not available' });
  const count = await newsImporter.importAll();
  res.json({ ok: true, imported: count });
}));

// POST /api/news/clear — wipe ALL news. State-changing admin operations must
// never be GET requests because crawlers, previews and browser prefetch can
// invoke GET without the owner's intent.
app.post('/api/news/clear', asyncHandler(async (req, res) => {
  if (!checkAdminKey(req, res)) return;
  if (!newsDb || !newsImporter) return res.status(503).json({ error: 'News module not available' });
  await newsDb.clearAll();
  logger.info('[Admin] News DB cleared by admin request');
  res.json({ ok: true, message: 'All news deleted. Run /api/news/import to reload.' });
}));

// POST /api/news/reset — wipe ALL news AND immediately re-import
app.post('/api/news/reset', asyncHandler(async (req, res) => {
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

// POST /api/news/fix-images — fetch og:image for existing articles that have none
app.post('/api/news/fix-images', asyncHandler(async (req, res) => {
  if (!checkAdminKey(req, res)) return;
  if (!newsDb || !newsImporter) return res.status(503).json({ error: 'News module not available' });
  res.json({ ok: true, message: 'Image fetch started in background. Check logs.' });
  try {
    const articles = await newsDb.getAllWithoutImage();
    logger.info(`[fix-images] Found ${articles.length} articles without og_image`);
    let updated = 0;
    for (const a of articles) {
      const urls = [...new Set([a.source_url, a.original_url].filter(Boolean))];
      for (const url of urls) {
        try {
          const { ogImage } = await newsImporter.fetchPageMeta(url);
          const img = newsImporter.normalizeSourceImage(ogImage);
          if (img) {
            await newsDb.updateOgImage(a._id, img);
            updated++;
            if (updated % 25 === 0) logger.info(`[fix-images] Progress: ${updated} images found`);
            break;
          }
        } catch (_) {}
        await new Promise(r => setTimeout(r, 350));
      }
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
  const latestPublishedAt = await newsDb.getLatestPublishedAt();
  const importInfo = newsImporter ? newsImporter.getLastImportInfo() : {};
  const parserReference = importInfo.lastImportTime || latestPublishedAt;
  const parserStale = !parserReference || Date.now() - new Date(parserReference).getTime() > 8 * 60 * 60 * 1000;
  const contentStale = !latestPublishedAt || Date.now() - new Date(latestPublishedAt).getTime() > 48 * 60 * 60 * 1000;
  res.json({
    ok: true,
    ...stats,
    sources: require('./config/news_sources.json').filter(s => s.enabled).length,
    lastImportTime:  importInfo.lastImportTime  || null,
    lastImportStats: importInfo.lastImportStats || null,
    importInProgress: Boolean(importInfo.importInProgress),
    latestPublishedAt,
    stale: parserStale,
    contentStale,
    env: {
      AUTO_PUBLISH_NEWS:    process.env.AUTO_PUBLISH_NEWS    || 'true',
      NEWS_MIN_RELEVANCE:   process.env.NEWS_MIN_RELEVANCE   || '0.45',
      NEWS_IMPORT_LIMIT:    process.env.NEWS_IMPORT_LIMIT    || '50',
      NEWS_USE_SOURCE_IMAGES: process.env.NEWS_USE_SOURCE_IMAGES || 'true',
    },
  });
}));

// Public, non-sensitive parser health check for uptime monitoring.
app.get('/api/news/health', asyncHandler(async (_req, res) => {
  if (!newsDb) return res.status(503).json({ ok: false, error: 'News DB not available' });
  const latestPublishedAt = await newsDb.getLatestPublishedAt();
  const importInfo = newsImporter ? newsImporter.getLastImportInfo() : {};
  const parserReference = importInfo.lastImportTime || latestPublishedAt;
  const stale = !parserReference || Date.now() - new Date(parserReference).getTime() > 8 * 60 * 60 * 1000;
  res.status(stale ? 503 : 200).json({
    ok: !stale,
    scheduled: BACKGROUND_JOBS_ENABLED,
    latestPublishedAt,
    lastImportTime: importInfo.lastImportTime || null,
    importInProgress: Boolean(importInfo.importInProgress),
  });
}));

// ===== NOTARY + BAILIFF + LAWYER DB: auto-import on startup if source is newer =====
// This is data initialization, not an optional background job. It must run even
// when cron/Telegram polling are disabled in production.
setTimeout(async () => {
  if (importNotaries) {
    // Startup must be deterministic and fast. Network refresh belongs to the
    // weekly cron/manual admin action; here we only import the validated local
    // snapshot when its version is newer than the DB.
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

if (BACKGROUND_JOBS_ENABLED) {

// Weekly refresh from the official ENIS registry, followed by a validated import.
cron.schedule('0 3 * * 0', async () => {
  logger.info('[Cron] Weekly notary+bailiff+lawyer re-import starting...');
  if (importNotaries) {
    try {
      if (refreshNotariesRegistry) await refreshNotariesRegistry();
      const n = await importNotaries();
      logger.info(`[Cron] Notaries: ${n}`);
    }
    catch (e) { logger.error('[Cron] Notary re-import failed: ' + e.message); }
  }
  if (importBailiffs) {
    try { const n = await importBailiffs(); logger.info(`[Cron] Bailiffs: ${n}`); }
    catch (e) { logger.error('[Cron] Bailiff re-import failed: ' + e.message); }
  }
  if (importLawyers) {
    try {
      if (refreshLawyersRegistry) await refreshLawyersRegistry();
      const n = await importLawyers();
      logger.info(`[Cron] Lawyers: ${n}`);
    }
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

  // Run an initial import after startup when the feed is empty or stale.
  setTimeout(async () => {
    try {
      const existing = await newsDb.countPublished();
      const latestPublishedAt = await newsDb.getLatestPublishedAt();
      const lastImportTime = newsImporter.getLastImportInfo().lastImportTime;
      const freshnessReference = lastImportTime || latestPublishedAt;
      const stale = !freshnessReference || Date.now() - new Date(freshnessReference).getTime() > 6 * 60 * 60 * 1000;
      if (existing === 0 || stale) {
        logger.info(`[Startup] News feed ${existing === 0 ? 'empty' : 'stale'}, running import...`);
        await newsImporter.importAll();
        logger.info('[Startup] Initial import done.');
      }
    } catch (e) {
      logger.warn('[Startup] Initial import check failed: ' + e.message);
    }
  }, 10000);
}
} else {
  logger.info('Background jobs disabled by DISABLE_BACKGROUND_JOBS');
}

// ===== APPLICATION FORM =====
app.post('/api/application', leadLimiter, asyncHandler(async (req, res) => {
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

// ===== CLICK TRACKING =====
let clicksDb = null;
try { clicksDb = require('./modules/clicks-db'); } catch (e) { logger.warn('clicks-db not loaded: ' + e.message); }

const TRACK_CLICK_TYPES = new Set(['phone', 'whatsapp']);
const TRACK_CLICK_TARGETS = new Set(['main', 'advocate', 'mediator']);
app.post('/api/track-click', asyncHandler(async (req, res) => {
  const { type, target, page } = req.body || {};
  if (!TRACK_CLICK_TYPES.has(type) || !TRACK_CLICK_TARGETS.has(target)) return res.json({ ok: false });
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
  const ua = req.headers['user-agent'] || '';
  if (clicksDb) clicksDb.recordClick({ type, target, page: page || '/', ip, ua }).catch(() => {});
  telegram.notifyClick(type, target, page || '/', ip, ua);
  res.json({ ok: true });
}));

// Lightweight product-analytics events (calculator_completed, copy_link, etc.) —
// logged for later reporting, deliberately does NOT ping Telegram like
// /api/track-click does, so it can be wired into high-frequency UI actions
// without spamming the lead-notification channel.
const ANALYTICS_EVENT_TYPES = new Set([
  'submit_iin', 'calculator_completed', 'bin_search_completed', 'open_case',
  'download_document', 'copy_link', 'external_campaign_visit',
  'click_cta_bailiff', 'click_cta_notary', 'send_document',
  'click_document_review', 'click_whatsapp_after_download',
]);
// Best-effort page_type classifier so LEAD-TRACKING-PLAN reports can group
// events without re-deriving it from the raw path every time.
function classifyPageType(page) {
  if (!page) return 'other';
  if (page === '/' ) return 'home';
  if (/^\/bailiff\//.test(page)) return 'bailiff_card';
  if (/^\/notary\//.test(page)) return 'notary_card';
  if (/^\/company\//.test(page)) return 'company_card';
  if (/^\/(bailiffs|notaries|banks|mfo|lombards|collectors|insurance|gsi|companies)$/.test(page)) return 'catalog';
  if (/^\/(arest-|snyatie-|zapret-|otmena-|vozrazhenie-|grafik-)/.test(page)) return 'money_page';
  if (page === '/dokumenty') return 'documents';
  if (page === '/calculator' || /^\/tools(?:\/|$)/.test(page)) return 'calculator';
  if (page === '/bin-search') return 'bin_search';
  return 'other';
}
app.post('/api/track-event', asyncHandler(async (req, res) => {
  const { type, target, page, utm, cta } = req.body || {};
  if (!type || !ANALYTICS_EVENT_TYPES.has(type)) return res.json({ ok: false });
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
  const ua = req.headers['user-agent'] || '';
  if (clicksDb) {
    clicksDb.recordClick({
      type, target: target || utm || '-', page: page || '/', ip, ua,
      page_type: classifyPageType(page), cta_position: cta || '', utm: utm || '',
    }).catch(() => {});
  }
  res.json({ ok: true });
}));

// ===== LEAD FORM (chatbot / contact form) =====
let leadsDb = null;
try { leadsDb = require('./modules/leads-db'); } catch (e) { logger.warn('leads-db not loaded: ' + e.message); }

app.post('/api/lead', leadLimiter, asyncHandler(async (req, res) => {
  const { name, phone, issue, question, page } = req.body || {};
  if (!phone) return res.status(400).json({ error: 'Телефон обязателен' });
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
  const ua = req.headers['user-agent'] || '';
  if (leadsDb) leadsDb.recordLead({ name, phone, issue, question, page, ip, ua }).catch(() => {});
  telegram.notifyLead({ name, phone, issue, question, page }, ip, ua);
  res.json({ ok: true });
}));

// ===== LIVE CHAT (widget → Telegram, owner replies via Telegram Reply) =====
let chatDb = null;
try { chatDb = require('./modules/chat-db'); } catch (e) { logger.warn('chat-db not loaded: ' + e.message); }

const chatSendLimiter = new Map(); // sessionId -> [timestamps]
function chatRateLimited(sessionId) {
  const now = Date.now();
  if (chatSendLimiter.size > 5000) {
    for (const [key, timestamps] of chatSendLimiter) {
      if (!timestamps.some(timestamp => now - timestamp < 60000)) chatSendLimiter.delete(key);
      if (chatSendLimiter.size <= 5000) break;
    }
  }
  const hits = (chatSendLimiter.get(sessionId) || []).filter(t => now - t < 60000);
  hits.push(now);
  chatSendLimiter.set(sessionId, hits);
  return hits.length > 20; // 20 messages/minute per session is plenty for a real conversation
}

app.post('/api/chat/send', asyncHandler(async (req, res) => {
  const sessionId = String(req.body?.sessionId || '').slice(0, 64);
  const text = String(req.body?.text || '').trim().slice(0, 1000);
  const page = String(req.body?.page || '').slice(0, 200);
  if (!chatDb) return res.status(503).json({ error: 'Чат временно недоступен' });
  if (!sessionId || !text) return res.status(400).json({ error: 'Пустое сообщение' });
  if (chatRateLimited(sessionId)) return res.status(429).json({ error: 'Слишком много сообщений, подождите немного' });

  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
  const ua = req.headers['user-agent'] || '';
  const chatNumber = await chatDb.addClientMessage(sessionId, text, page);
  const sent = await telegram.notifyChatMessage(chatNumber, text, page, ip, ua);
  if (sent?.message_id) await chatDb.pushBotMsgId(sessionId, sent.message_id);
  res.json({ ok: true });
}));

app.get('/api/chat/poll', asyncHandler(async (req, res) => {
  const sessionId = String(req.query?.session || '').slice(0, 64);
  const since = Number.parseInt(req.query?.since, 10) || 0;
  if (!chatDb || !sessionId) return res.json({ messages: [], now: Date.now() });
  const messages = await chatDb.getMessagesSince(sessionId, since);
  res.json({ messages, now: Date.now() });
}));

// ===== TELEGRAM SETUP: определить CHAT_ID =====
app.post('/api/telegram/setup', asyncHandler(async (req, res) => {
  if (!checkAdminKey(req, res)) return;
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
        release: RELEASE_ID,
        egovKey: EGOV_API_KEY ? 'configured' : 'missing',
        time: new Date().toISOString()
    });
});

// ===== КОММЕНТАРИИ =====
app.post('/comments', commentLimiter, express.urlencoded({ extended: true }), asyncHandler(async (req, res) => {
  if (!commentsDb) return res.redirect(req.headers.referer || '/');
  const { type, slug, name, rating, text, backUrl } = req.body;
  if (!type || !slug || !text || text.trim().length < 3) {
    return res.redirect(backUrl || req.headers.referer || '/');
  }
  await commentsDb.add({
    type:   type.slice(0, 20),
    slug:   slug.slice(0, 120),
    name:   ((name || '').trim() || 'Аноним').slice(0, 50),
    rating: Math.min(5, Math.max(1, parseInt(rating) || 5)),
    text:   text.trim().slice(0, 600),
    ip:     req.ip,
  });
  res.redirect((backUrl || req.headers.referer || '/') + '?comment=sent');
}));

function requireAdminPassword(req, res, next) {
  const expected = process.env.ADMIN_PW || '';
  const authorization = String(req.headers.authorization || '');
  let provided = '';
  if (authorization.startsWith('Basic ')) {
    try {
      const decoded = Buffer.from(authorization.slice(6), 'base64').toString('utf8');
      provided = decoded.slice(decoded.indexOf(':') + 1);
    } catch (_) {}
  }
  if (!expected || !secretsEqual(provided, expected)) {
    res.set('WWW-Authenticate', 'Basic realm="ZakonExpert comments", charset="UTF-8"');
    return res.status(401).send('Authentication required');
  }
  next();
}

app.get('/admin/comments', requireAdminPassword, asyncHandler(async (req, res) => {
  const all = commentsDb ? await commentsDb.getAll() : [];
  res.render('admin/comments', { comments: all });
}));

app.post('/admin/comments/:id/approve', requireAdminPassword, express.urlencoded({ extended: true }), asyncHandler(async (req, res) => {
  if (commentsDb) await commentsDb.approve(req.params.id);
  res.redirect('/admin/comments');
}));

app.post('/admin/comments/:id/delete', requireAdminPassword, express.urlencoded({ extended: true }), asyncHandler(async (req, res) => {
  if (commentsDb) await commentsDb.remove(req.params.id);
  res.redirect('/admin/comments');
}));

// ===== BIN SEARCH =====
app.get('/bin-search', (req, res) => {
  const bin = (req.query.bin || '').replace(/\D/g, '').slice(0, 12);
  if (bin.length < 9) return res.render('bin-search/index', { bin, results: [], searched: false });
  const results = [];
  try { getBanksData().filter(b => b.bin === bin).forEach(b => results.push({ type: 'Банк', name: b.shortName || b.name, url: '/banks/' + b.slug })); } catch(e){}
  try { const { mfo, lombards } = getMfoData(); mfo.filter(m => m.bin === bin).forEach(m => results.push({ type: 'МФО', name: m.name, url: '/mfo/' + m.slug })); lombards.filter(m => m.bin === bin).forEach(m => results.push({ type: 'Ломбард', name: m.name, url: '/lombards/' + m.slug })); } catch(e){}
  try { getCollectors().filter(c => c.bin === bin).forEach(c => results.push({ type: 'Коллектор', name: c.name, url: '/collectors/' + c.slug })); } catch(e){}
  try { getInsuranceData().filter(c => c.bin === bin).forEach(c => results.push({ type: 'Страховая', name: c.shortName || c.name, url: '/insurance/' + c.slug })); } catch(e){}
  try { getGsiData().filter(g => g.bin && g.bin === bin).forEach(g => results.push({ type: 'ГСИ', name: g.name, url: '/gsi/' + g.slug })); } catch(e){}
  try {
    if (companiesDb && companiesDb.available()) {
      companiesDb.search(bin, 1, 5).items.forEach(company => results.push({
        type: 'Компания',
        name: company.name_ru || company.name_kk,
        url: '/company/' + company.slug,
      }));
    }
  } catch(e){}
  if (clicksDb) clicksDb.recordClick({ type: 'bin_search_completed', target: bin, page: '/bin-search', ip: req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown', ua: req.headers['user-agent'] || '' }).catch(() => {});
  res.render('bin-search/index', { bin, results, searched: true });
});

// ===== КАЛЬКУЛЯТОР =====
app.get('/calculator', (req, res) => res.render('calculator/index', {}));
app.get('/marshrut-dolzhnika', (req, res) => res.render('debt-route'));
app.get('/tools', (req, res) => res.render('tools/index', { tools: TOOLS }));
app.get('/tools/:slug', (req, res) => {
  const tool = findTool(req.params.slug);
  if (!tool) return sendNotFound(res);
  res.render('tools/tool', { tool, tools: TOOLS });
});

// A real 404 response prevents crawlers from treating missing profiles as
// indexable soft-404 redirects and gives visitors useful recovery links.
app.use((req, res) => sendNotFound(res));

// Централизованный обработчик должен находиться после всех маршрутов, иначе
// ошибки из объявленных ниже него страниц попадут в стандартный HTML-ответ
// Express и могут раскрыть лишние детали.
app.use((err, req, res, next) => {
  logger.error(`${err.status || 500} - ${err.message} - ${req.originalUrl} - ${req.method} - ${req.ip}`, err);
  if (!res.headersSent) {
    return res.status(err.status || 500).json({
      error: 'Внутренняя ошибка сервера',
      details: process.env.NODE_ENV === 'production' ? 'Произошла непредвиденная ошибка.' : err.message,
    });
  }
  next(err);
});

// Запуск сервера
app.listen(PORT, '0.0.0.0', () => {
    logger.info(`ZakonExpert сервер запущен на порту ${PORT}`);
    logger.info(`EGOV_API_KEY: ${EGOV_API_KEY ? 'задан ✓' : 'НЕ ЗАДАН — проверка ИИН не будет работать!'}`);
    // Запускаем Telegram бот (принимает команды /stats, /leads, /help)
    if (BACKGROUND_JOBS_ENABLED) {
      telegram.startPolling();
      logger.info('Telegram bot polling started ✓');
    } else {
      logger.info('Telegram bot polling disabled');
    }
});
