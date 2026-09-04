'use strict';



function installErrorHandlers(app, dependencies) {
  const { sendNotFound, logger } = dependencies;

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

}

module.exports = { installErrorHandlers };
