const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const fs = require('fs');
const helmet = require('helmet');
const compression = require('compression');
const axios = require('axios');
const xml2js = require('xml2js');
const { v4: uuidv4 } = require('uuid');
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

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use(helmet());
app.use(compression());

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
// ИЗМЕНЕНО: Возвращаем ключ API прямо в код
const EGOV_API_KEY = "374f869ccd81431387ee8e872b6ea15d";

// Функция для проверки ограничений (ЗАГЛУШКА)
async function checkRestrictions(iin) { // Убрали неиспользуемый параметр 'page'
    try {
        const formattedIIN = String(iin).replace(/[^\d]/g, '');
        if (formattedIIN.length !== 12) {
            // ИЗМЕНЕНО: Логируем через logger.warn и выбрасываем ошибку
            const errorMsg = 'ИИН должен содержать 12 цифр';
            logger.warn(`Попытка проверить ограничения с неверным ИИН: ${iin}`);
            throw new Error(errorMsg);
        }
        // ИЗМЕНЕНО: logger.info и logger.warn
        logger.info(`Вызов заглушки checkRestrictions для ИИН: ${formattedIIN}`);
        logger.warn('ВНИМАНИЕ: Функция checkRestrictions не реализована для API, возвращает пустой результат.');
        return [];

    } catch (error) {
        // ИЗМЕНЕНО: logger.error
        logger.error('Ошибка в заглушке checkRestrictions:', error);
        return [];
    }
}

// --- НАЧАЛО: Новая функция для проверки должника через API eGov ---
async function checkDebtorViaApi(iin) {
    const formattedIIN = String(iin).replace(/[^\d]/g, '');
    if (formattedIIN.length !== 12) {
        // ИЗМЕНЕНО: logger.warn и ошибка
        const errorMsg = 'ИИН должен содержать 12 цифр';
        logger.warn(`Попытка проверить должника с неверным ИИН: ${iin}`);
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
    logger.info(`Отправка SOAP запроса для ИИН ${formattedIIN} на ${EGOV_API_URL}`);
    try {
        const response = await axios.post(EGOV_API_URL, soapBody, { headers, timeout: 30000 }); // Добавлен таймаут запроса
        // ИЗМЕНЕНО: logger.info
        logger.info(`SOAP ответ получен для ИИН ${formattedIIN}. Статус: ${response.status}`);

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
        logger.info(`Результат проверки ИИН ${formattedIIN}: код статуса '${statusCode}', сообщение '${statusMessage}', должник найден (наличие rows): ${isDebtor}`);

        return {
            isDebtor: isDebtor,
            details: isDebtor ? debtorDataRows : null
        };

    } catch (error) {
        // ИЗМЕНЕНО: logger.error
        logger.error(`Ошибка при вызове API eGov или парсинге ответа для ИИН ${formattedIIN}:`, error);
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
            debtorInfo: debtorResult, // Возвращаем результат как есть
            restrictions: restrictionsResult
        });
        // ИЗМЕНЕНО: Логируем успешный ответ
        logger.info(`Успешно отправлен ответ для ИИН ${iin.substring(0, 4)}********. Должник найден: ${debtorResult.isDebtor}`);

    } catch (error) {
        // Ошибка уже залогирована в checkDebtorViaApi или asyncHandler
        // ИЗМЕНЕНО: Логируем факт отправки ошибки клиенту
        logger.error(`Отправка ошибки 500 клиенту для ИИН ${iin ? iin.substring(0, 4) + '********' : 'пустой'}: ${error.message}`);
        res.status(500).json({ error: 'Ошибка сервера при проверке должника через API', details: error.message });
    }

}));

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
  // ИЗМЕНЕНО: logger.info
  logger.info(`Сервер запущен на порту ${PORT} и доступен в локальной сети`);
});