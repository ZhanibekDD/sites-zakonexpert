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
  '/banks', '/mfo', '/courts', '/chambers', '/companies', '/collectors', '/lombards',
  '/gsi', '/insurance', '/credit-bureaus', '/regulators', '/emergency',
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
      note: (r['Примечание'] || existing.note || '').trim(),
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
    const shortName = parenMatches.length
      ? parenMatches[parenMatches.length - 1].replace(/[()]/g, '').trim()
      : name.replace(/^АО\s+"[^"]+"\s+/i, '').replace(/^«|»$/g, '').trim();
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
app.get('/banks',     (req, res) => res.render('banks/catalog', { banks: getBanksData() }));
app.get('/mfo',       (req, res) => res.render('mfo/catalog'));
app.get('/courts',    (req, res) => res.render('courts/catalog', { courts: getCourtsData() }));
app.get('/chambers',  (req, res) => res.render('chambers/catalog', { chambers: getChambersData() }));
app.get('/companies',     (req, res) => res.render('companies/catalog'));
app.get('/gsi',           (req, res) => res.render('gsi/catalog', { items: getGsiData() }));
app.get('/gsi/:slug',     (req, res) => {
  const item = getGsiData().find(g => g.slug === req.params.slug);
  if (!item) return res.status(404).redirect('/gsi');
  res.render('gsi/item', { item });
});
app.get('/insurance',     (req, res) => res.render('insurance/catalog', { items: getInsuranceData() }));
app.get('/insurance/:slug', (req, res) => {
  const item = getInsuranceData().find(c => c.slug === req.params.slug);
  if (!item) return res.status(404).redirect('/insurance');
  res.render('insurance/item', { item });
});
app.get('/credit-bureaus',(req, res) => res.render('credit-bureaus/catalog', { items: parseSemicolonCSV(path.join(__dirname, 'Кредитные_бюро_Казахстана.csv')) }));
app.get('/regulators',    (req, res) => res.render('regulators/catalog', { items: parseSemicolonCSV(path.join(__dirname, 'Финансовые_регуляторы_Казахстана.csv')) }));
app.get('/emergency',     (req, res) => res.render('emergency/catalog', { items: parseSemicolonCSV(path.join(__dirname, 'Экстренные_и_справочные_номера_Казахстана.csv')) }));

// ITEM PAGES: BANKS
app.get('/banks/:slug', (req, res) => {
  const bank = getBanksData().find(b => b.slug === req.params.slug);
  if (!bank) return res.status(404).redirect('/banks');
  res.render('banks/item', { bank });
});

// ITEM PAGES: COURTS
app.get('/courts/:slug', (req, res) => {
  const court = getCourtsData().find(c => c.slug === req.params.slug);
  if (!court) return res.status(404).redirect('/courts');
  res.render('courts/item', { court });
});

// ITEM PAGES: CHAMBERS
app.get('/chambers/:slug', (req, res) => {
  const chamber = getChambersData().find(c => c.slug === req.params.slug);
  if (!chamber) return res.status(404).redirect('/chambers');
  res.render('chambers/item', { chamber });
});

// ===== CSV-BACKED CATALOGS: COLLECTORS / LOMBARDS =====
function parseSemicolonCSV(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const lines = raw.split(/\r?\n/);
    const headers = lines[0].split(';').map(h => h.replace(/^"|"$/g, '').trim());
    const rows = [];
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      // simple quoted-field parser for semicolon delimiter
      const fields = [];
      let cur = '', inQ = false;
      for (let c = 0; c < line.length; c++) {
        const ch = line[c];
        if (ch === '"') {
          if (inQ && line[c + 1] === '"') { cur += '"'; c++; }
          else inQ = !inQ;
        } else if (ch === ';' && !inQ) {
          fields.push(cur.trim()); cur = '';
        } else { cur += ch; }
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
      const entryName = (r['Название (реестр АРРФР)'] || '').replace(/^[«"ТОО\s«»]+|[«»"]+$/g,'').trim();
      const entry = {
        name: entryName,
        slug: slugify(entryName) || 'bin-' + (r['БИН'] || ''),
        nameFull: r['Полное название (гос. регистр)'] || '',
        bin: r['БИН'] || '',
        address: r['Юридический адрес'] || '',
        leader: r['Руководитель'] || '',
        note: r['Примечание'] || '',
      };
      if (cat === 'МФО') _mfoCache.mfo.push(entry);
      else if (cat === 'Ломбард') _mfoCache.lombards.push(entry);
      else if (cat === 'Кредитное товарищество') _mfoCache.kredTov.push(entry);
    });
  }
  return _mfoCache;
}

app.get('/collectors', (req, res) => {
  const items = getCollectors();
  res.render('collectors/catalog', { items });
});

app.get('/collectors/:slug', (req, res) => {
  const item = getCollectors().find(c => c.slug === req.params.slug);
  if (!item) return res.status(404).redirect('/collectors');
  res.render('collectors/item', { item });
});

app.get('/mfo', (req, res) => {
  const { mfo } = getMfoData();
  res.render('mfo/catalog', { mfo });
});

app.get('/mfo/:slug', (req, res) => {
  const { mfo } = getMfoData();
  const item = mfo.find(m => m.slug === req.params.slug);
  if (!item) return res.status(404).redirect('/mfo');
  res.render('mfo/item', { item });
});

app.get('/lombards', (req, res) => {
  const { lombards } = getMfoData();
  res.render('lombards/catalog', { items: lombards });
});

app.get('/lombards/:slug', (req, res) => {
  const { lombards } = getMfoData();
  const item = lombards.find(l => l.slug === req.params.slug);
  if (!item) return res.status(404).redirect('/lombards');
  res.render('lombards/item', { item });
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
  '/mediator':                         'mediator.html',
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
    { url: '/mediator', priority: '0.8', freq: 'monthly' },
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
  const isAdvokat = article.category === 'Адвокат';
  const relatedRaw = tagsArr.length > 0
    ? await newsDb.getByTags(tagsArr[0])
    : await newsDb.getPublished(5, 0);
  const related = relatedRaw
    .filter(r => r.slug !== article.slug && (isAdvokat ? r.category === 'Адвокат' : r.category !== 'Адвокат'))
    .slice(0, 4);

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

// ===== CLICK TRACKING =====
let clicksDb = null;
try { clicksDb = require('./modules/clicks-db'); } catch (e) { logger.warn('clicks-db not loaded: ' + e.message); }

app.post('/api/track-click', asyncHandler(async (req, res) => {
  const { type, target, page } = req.body || {};
  if (!type || !target) return res.json({ ok: false });
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
  const ua = req.headers['user-agent'] || '';
  if (clicksDb) clicksDb.recordClick({ type, target, page: page || '/', ip, ua }).catch(() => {});
  telegram.notifyClick(type, target, page || '/', ip, ua);
  res.json({ ok: true });
}));

// ===== LEAD FORM (chatbot / contact form) =====
let leadsDb = null;
try { leadsDb = require('./modules/leads-db'); } catch (e) { logger.warn('leads-db not loaded: ' + e.message); }

app.post('/api/lead', asyncHandler(async (req, res) => {
  const { name, phone, issue, question, page } = req.body || {};
  if (!phone) return res.status(400).json({ error: 'Телефон обязателен' });
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
  const ua = req.headers['user-agent'] || '';
  if (leadsDb) leadsDb.recordLead({ name, phone, issue, question, page, ip, ua }).catch(() => {});
  telegram.notifyLead({ name, phone, issue, question, page }, ip, ua);
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
    // Запускаем Telegram бот (принимает команды /stats, /leads, /help)
    telegram.startPolling();
    logger.info('Telegram bot polling started ✓');
});