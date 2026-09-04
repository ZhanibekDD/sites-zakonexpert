'use strict';

const axios = require('axios');
const xml2js = require('xml2js');
const { v4: uuidv4 } = require('uuid');
const { validateBin } = require('../../modules/kgd-counterparty');

function registerCheckRoutes(app, dependencies) {
  const {
    EGOV_API_URL,
    EGOV_API_KEY,
    telegram,
    companyCheckService,
    asyncHandler,
    externalApiLimiter,
    logger,
  } = dependencies;

  // Маскировка ИИН для безопасного логирования
  function maskIin(iin) {
      const clean = String(iin || '').replace(/\D/g, '');
      return clean.length >= 4 ? clean.slice(0, 4) + '********' : 'невалидный';
  }

  const COMPANY_CHECK_CACHE_TTL_MS = 30 * 60 * 1000;
  const COMPANY_CHECK_CACHE_LIMIT = 1000;
  const companyCheckCache = new Map();

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
      if (req.body?.consent !== true) {
          return res.status(400).json({ error: 'Необходимо согласие на разовую обработку ИИН' });
      }
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

  // ===== BANKRUPTCY CHECK (tazalau.qoldau.kz) =====
  const handleBankruptcyCheck = asyncHandler(async (req, res) => {
    res.set('Cache-Control', 'private, no-store');
    const submittedIin = req.method === 'POST' ? req.body?.iin : req.query.iin;
    const iin = String(submittedIin || '').replace(/\D/g, '');
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

    function publicResult(settled) {
      if (settled.status !== 'fulfilled') return { ok: false, rows: [], total: 0, error: 'SOURCE_UNAVAILABLE' };
      return { ok: true, ...parseHtmlTable(settled.value.data) };
    }

    const results = {
      outOfCourt: publicResult(r1),
      judicial: publicResult(r2),
      recovery: publicResult(r3),
    };
    const availableSources = Object.values(results).filter(source => source.ok).length;
    res.json({
      ...results,
      meta: {
        checkedAt: new Date().toISOString(),
        availableSources,
        totalSources: 3,
        complete: availableSources === 3,
      },
    });
  });
  app.get('/api/bankruptcy-check', externalApiLimiter, handleBankruptcyCheck);
  app.post('/api/bankruptcy-check', externalApiLimiter, handleBankruptcyCheck);

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

  app.post('/api/company-check', externalApiLimiter, async (req, res) => {
    res.set('Cache-Control', 'private, no-store');
    const bin = validateBin(req.body?.bin);
    if (!bin) {
      return res.status(400).json({
        error: 'Введите БИН из 12 цифр.',
        code: 'INVALID_BIN',
      });
    }
    const cached = companyCheckCache.get(bin);
    if (cached && Date.now() - cached.savedAt < COMPANY_CHECK_CACHE_TTL_MS) {
      res.set('X-Data-Cache', 'HIT');
      return res.json({ ...cached.report, meta: { cached: true, cacheTtlMinutes: 30 } });
    }
    if (cached) companyCheckCache.delete(bin);

    try {
      const report = await companyCheckService.check(bin);
      if (companyCheckCache.size >= COMPANY_CHECK_CACHE_LIMIT) {
        const oldestKey = companyCheckCache.keys().next().value;
        if (oldestKey) companyCheckCache.delete(oldestKey);
      }
      companyCheckCache.set(bin, { report, savedAt: Date.now() });
      res.set('X-Data-Cache', 'MISS');
      return res.json({ ...report, meta: { cached: false, cacheTtlMinutes: 30 } });
    } catch (error) {
      if (error.code === 'NO_OFFICIAL_DATA') {
        const localRegistryChecked = error.sources?.egov === 'not_found';
        return res.status(localRegistryChecked ? 404 : 503).json({
          error: localRegistryChecked
            ? 'Организация с таким БИН не найдена в подключённых официальных источниках.'
            : 'Подключённые официальные источники временно не вернули данные.',
          code: 'NO_OFFICIAL_DATA',
        });
      }
      logger.error(`[Company check] Request failed: ${error.code || error.message}`);
      return res.status(502).json({
        error: 'Не удалось собрать отчёт из официальных источников. Повторите через несколько минут.',
        code: 'OFFICIAL_SOURCES_UNAVAILABLE',
      });
    }
  });

}

module.exports = { registerCheckRoutes };
