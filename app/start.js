'use strict';

const { createRuntime } = require('./runtime');
const { createApp } = require('./create-app');
const { startBackgroundJobs } = require('./background-jobs');

function startServer() {
  const runtime = createRuntime();
  const app = createApp(runtime);
  const { config, logger, services } = runtime;
  const { PORT, EGOV_API_KEY, BACKGROUND_JOBS_ENABLED } = config;
  const { kgdCounterparty, goszakup, telegram } = services;
  startBackgroundJobs({ ...config, ...services, logger });
  return app.listen(PORT, '0.0.0.0', () => {
    logger.info(`ZakonExpert сервер запущен на порту ${PORT}`);
    logger.info(`EGOV_API_KEY: ${EGOV_API_KEY ? 'задан ✓' : 'НЕ ЗАДАН — проверка ИИН не будет работать!'}`);
    logger.info(`KGD_API_TOKEN: ${kgdCounterparty.configured ? 'задан ✓' : 'НЕ ЗАДАН — налоговый раздел будет недоступен'}`);
    logger.info(`GOSZAKUP_API_TOKEN: ${goszakup.configured ? 'задан ✓' : 'НЕ ЗАДАН — раздел госзакупок будет недоступен'}`);
    // Запускаем Telegram бот (принимает команды /stats, /leads, /help)
    if (BACKGROUND_JOBS_ENABLED) {
      telegram.startPolling();
      logger.info('Telegram bot polling started ✓');
    } else {
      logger.info('Telegram bot polling disabled');
    }
  });
}

module.exports = { startServer };
