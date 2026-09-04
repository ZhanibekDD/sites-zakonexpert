'use strict';

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const helmet = require('helmet');
const compression = require('compression');
const { BANK_ARREST_HUB_PATH, BANK_ARREST_PATH_SET } = require('../../modules/bank-arrest-pages');
const { LEGAL_INTENT_PATH_SET } = require('../../modules/legal-intent-pages');
const { ROOT_DIR } = require('../paths');

function installMiddleware(app, dependencies) {
  const { telegram } = dependencies;

  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  // Template engine for news pages
  app.set('view engine', 'ejs');
  app.set('views', path.join(ROOT_DIR, 'views'));

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
          ],
          styleSrc: ["'self'", "'unsafe-inline'", 'https://cdn.jsdelivr.net', 'https://fonts.googleapis.com'],
          fontSrc: ["'self'", 'data:', 'https://cdn.jsdelivr.net', 'https://fonts.gstatic.com'],
          imgSrc: ["'self'", 'data:', 'https:'],
          connectSrc: [
            "'self'",
            'https://cdn.jsdelivr.net',
            'https://mc.yandex.ru',
            'https://yandex.ru',
          ],
          frameSrc: [
            "'self'",
            'https://maps.google.com',
            'https://www.google.com',
            'https://yandex.ru',
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
      origin: process.env.CORS_ORIGIN || false, // в production задайте CORS_ORIGIN=https://zakonexpert.kz
      methods: ['GET', 'POST'],
      allowedHeaders: ['Content-Type', 'X-Admin-Key'],
  }));
  app.use(express.json()); // заменяет bodyParser.json()

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

  // Search terms belong in the client-side state, not in crawlable canonical
  // URLs. This route must precede express.static because notary-search.html is a
  // physical file and would otherwise be served before Express can normalize it.
  app.get('/notary-search', (req, res, next) => {
    const entries = Object.entries(req.query || {}).flatMap(([key, value]) =>
      (Array.isArray(value) ? value : [value]).map(item => [key, String(item || '')])
    ).filter(([, value]) => value);
    if (!entries.length) return next();
    res.redirect(301, `/notary-search#${new URLSearchParams(entries).toString()}`);
  });

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
    const filePath = path.join(ROOT_DIR, 'public', req.path);
    if (!fs.existsSync(filePath)) return next();
    const qs = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
    res.redirect(301, cleanPath + qs);
  });

  // Working databases/exports must never be web-reachable, even if something
  // is dropped into public/data/ by mistake (found a stray .db-wal file there
  // during a storage audit — nothing in the app writes there, but express.static
  // would have served it to anyone who requested the URL directly).
  app.use('/data', (req, res) => res.status(404).end());

  app.use(express.static(path.join(ROOT_DIR, 'public'), {
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
    '/services.html', '/contact.html', '/zakony.html', '/reviews', '/reviews.html',
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
    '/notaries', '/zamena-notariusa', '/bailiffs',
    '/notary-search', '/bailiff-search',
    '/banks', '/mfo', '/courts', '/chambers', '/companies', '/collectors', '/lombards',
    '/gsi', '/insurance', '/credit-bureaus', '/regulators', '/emergency',
    '/news', '/statyi',
  ]);
  app.use((req, res, next) => {
    const notifyVisits = /^(1|true|yes)$/i.test(process.env.TELEGRAM_VISIT_NOTIFICATIONS || '');
    const growthTracked = req.path === BANK_ARREST_HUB_PATH
      || BANK_ARREST_PATH_SET.has(req.path)
      || LEGAL_INTENT_PATH_SET.has(req.path);
    if (notifyVisits && req.method === 'GET' && (TRACKED_PATHS.has(req.path) || growthTracked)) {
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
    res.sendFile(path.join(ROOT_DIR, 'public', 'index.html'));
  });

}

module.exports = { installMiddleware };
