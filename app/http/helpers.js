'use strict';

const path = require('path');
const crypto = require('crypto');
const { ROOT_DIR } = require('../paths');

function createHttpHelpers(dependencies) {
  const { logger } = dependencies;

  // Утилита для обработки асинхронных запросов
  const asyncHandler = fn => (req, res, next) =>
    Promise.resolve().then(() => fn(req, res, next)).catch(err => {
        logger.error('Ошибка в асинхронном обработчике:', err); // Логируем ошибку
        next(err); // Передаем ошибку дальше стандартному обработчику Express
    });

  function sendNotFound(res) {
    res.status(404).sendFile(path.join(ROOT_DIR, 'public', '404.html'), error => {
      if (error && !res.headersSent) res.status(404).send('Страница не найдена');
    });
  }

  function sendGone(res) {
    res.set('Cache-Control', 'no-store');
    res.status(410).sendFile(path.join(ROOT_DIR, 'public', '404.html'), error => {
      if (error && !res.headersSent) res.status(410).send('Раздел удалён');
    });
  }

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

  return { asyncHandler, sendNotFound, sendGone, checkAdminKey, requireAdminPassword };
}

module.exports = { createHttpHelpers };
