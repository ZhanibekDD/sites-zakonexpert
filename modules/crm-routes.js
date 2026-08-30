'use strict';

const crypto = require('crypto');
const axios = require('axios');
const crmDb = require('./crm-db');

function safeEqual(a, b) {
  const aa = Buffer.from(String(a || ''));
  const bb = Buffer.from(String(b || ''));
  if (aa.length !== bb.length) return false;
  return crypto.timingSafeEqual(aa, bb);
}

function cookieValue(req, name) {
  const raw = String(req.headers.cookie || '');
  for (const part of raw.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return '';
}

function b64url(value) {
  return Buffer.from(value).toString('base64url');
}

function sessionSecret() {
  return String(process.env.CRM_SESSION_SECRET || '').trim();
}

function sessionConfigured() {
  return Boolean(String(process.env.CRM_PASSWORD || '').trim() && sessionSecret().length >= 24);
}

function signPayload(payload) {
  return crypto.createHmac('sha256', sessionSecret()).update(payload).digest('base64url');
}

function createSession(username) {
  const body = {
    u: username,
    exp: Date.now() + 12 * 60 * 60 * 1000,
    csrf: crypto.randomBytes(24).toString('base64url'),
  };
  const payload = b64url(JSON.stringify(body));
  return { token: `${payload}.${signPayload(payload)}`, body };
}

function readSession(req) {
  if (!sessionConfigured()) return null;
  const token = cookieValue(req, 'zke_crm');
  const [payload, signature] = token.split('.');
  if (!payload || !signature || !safeEqual(signature, signPayload(payload))) return null;
  try {
    const body = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!body || Number(body.exp) < Date.now() || !body.csrf) return null;
    return body;
  } catch (_) {
    return null;
  }
}

function securityHeaders(req, res, next) {
  res.set({
    'Cache-Control': 'private, no-store, max-age=0',
    'Pragma': 'no-cache',
    'X-Robots-Tag': 'noindex, nofollow, noarchive',
    'X-Frame-Options': 'DENY',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Content-Security-Policy': [
      "default-src 'self'",
      "base-uri 'self'",
      "frame-ancestors 'none'",
      "form-action 'self'",
      "object-src 'none'",
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data:",
      "connect-src 'self'",
    ].join('; '),
  });
  next();
}

const loginBuckets = new Map();
function loginAllowed(req) {
  const key = String(req.ip || req.socket.remoteAddress || 'unknown');
  const ts = Date.now();
  const current = loginBuckets.get(key);
  if (!current || ts - current.startedAt > 15 * 60 * 1000) {
    loginBuckets.set(key, { startedAt: ts, count: 1 });
    return true;
  }
  current.count += 1;
  return current.count <= 8;
}

function requireCrm(req, res, next) {
  const session = readSession(req);
  if (!session) {
    if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'AUTH_REQUIRED' });
    return res.redirect('/crm/login');
  }
  req.crmSession = session;
  next();
}

function requireCsrf(req, res, next) {
  if (!req.crmSession) return res.status(401).json({ error: 'AUTH_REQUIRED' });
  const token = String(req.headers['x-csrf-token'] || req.body?._csrf || '');
  if (!token || !safeEqual(token, req.crmSession.csrf)) return res.status(403).json({ error: 'BAD_CSRF' });
  next();
}

function integrationAuthorized(req) {
  const expected = String(process.env.CRM_INTEGRATION_KEY || '').trim();
  const provided = String(req.headers['x-crm-integration-key'] || '').trim();
  return expected.length >= 24 && safeEqual(provided, expected);
}

function extractWhatsAppText(message = {}) {
  if (message.text?.body) return message.text.body;
  if (message.button?.text) return message.button.text;
  if (message.interactive?.button_reply?.title) return message.interactive.button_reply.title;
  if (message.interactive?.list_reply?.title) return message.interactive.list_reply.title;
  if (message.document?.filename) return `[Документ] ${message.document.filename}`;
  if (message.image) return '[Изображение]';
  if (message.audio) return '[Аудио]';
  if (message.video) return '[Видео]';
  if (message.location) return '[Геолокация]';
  if (message.contacts) return '[Контакт]';
  return `[${message.type || 'сообщение'}]`;
}

function verifyWhatsAppSignature(rawBody, signature) {
  const secret = String(process.env.WHATSAPP_APP_SECRET || '').trim();
  if (!secret || !signature || !Buffer.isBuffer(rawBody)) return false;
  const expected = `sha256=${crypto.createHmac('sha256', secret).update(rawBody).digest('hex')}`;
  return safeEqual(signature, expected);
}

function csvCell(value) {
  const text = String(value ?? '').replace(/\r?\n/g, ' ');
  return `"${text.replace(/"/g, '""')}"`;
}

async function syncWebsiteLeads() {
  try {
    const leadsDb = require('./leads-db');
    const leads = await leadsDb.getRecent(5000);
    return crmDb.syncWebsiteLeads(leads);
  } catch (_) {
    return 0;
  }
}

function installCrm(app, express) {
  const router = express.Router();
  router.use(securityHeaders);

  // WhatsApp Cloud API webhook must receive raw JSON so x-hub-signature-256 can be verified.
  router.get('/api/whatsapp/webhook', (req, res) => {
    const verifyToken = String(process.env.WHATSAPP_VERIFY_TOKEN || '').trim();
    const mode = String(req.query['hub.mode'] || '');
    const token = String(req.query['hub.verify_token'] || '');
    const challenge = String(req.query['hub.challenge'] || '');
    if (verifyToken && mode === 'subscribe' && safeEqual(token, verifyToken)) {
      return res.status(200).send(challenge);
    }
    return res.status(403).send('Forbidden');
  });

  router.post('/api/whatsapp/webhook', express.raw({ type: 'application/json', limit: '1mb' }), async (req, res) => {
    if (!verifyWhatsAppSignature(req.body, String(req.headers['x-hub-signature-256'] || ''))) {
      return res.status(401).send('Invalid signature');
    }
    let payload;
    try {
      payload = JSON.parse(req.body.toString('utf8'));
    } catch (_) {
      return res.status(400).send('Bad JSON');
    }

    try {
      for (const entry of payload.entry || []) {
        for (const change of entry.changes || []) {
          const value = change.value || {};
          const contactByWaId = new Map((value.contacts || []).map(contact => [
            String(contact.wa_id || ''),
            contact.profile?.name || '',
          ]));
          for (const message of value.messages || []) {
            const phone = String(message.from || '');
            if (!phone) continue;
            await crmDb.recordMessageByPhone({
              phone,
              name: contactByWaId.get(phone) || '',
              channel: 'whatsapp',
              direction: 'in',
              text: extractWhatsAppText(message),
              type: message.type,
              messageId: message.id,
              at: Number(message.timestamp || 0) * 1000 || Date.now(),
            });
          }
        }
      }
    } catch (_) {
      // Meta expects a fast 200; a malformed individual event must not create retries forever.
    }
    return res.status(200).send('EVENT_RECEIVED');
  });

  router.use(express.json({ limit: '512kb' }));
  router.use(express.urlencoded({ extended: false, limit: '64kb' }));

  router.get('/crm/login', (req, res) => {
    if (readSession(req)) return res.redirect('/crm');
    return res.render('crm/login', {
      configured: sessionConfigured(),
      error: req.query.error === '1',
    });
  });

  router.post('/crm/login', (req, res) => {
    if (!loginAllowed(req)) return res.status(429).render('crm/login', { configured: sessionConfigured(), error: true });
    if (!sessionConfigured()) return res.status(503).render('crm/login', { configured: false, error: false });

    const expectedUser = String(process.env.CRM_USERNAME || 'admin').trim();
    const expectedPassword = String(process.env.CRM_PASSWORD || '');
    const user = String(req.body.username || '').trim();
    const password = String(req.body.password || '');
    if (!safeEqual(user, expectedUser) || !safeEqual(password, expectedPassword)) {
      return res.status(401).render('crm/login', { configured: true, error: true });
    }

    const session = createSession(user);
    res.setHeader('Set-Cookie', `zke_crm=${encodeURIComponent(session.token)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=43200`);
    return res.redirect('/crm');
  });

  router.get('/crm', requireCrm, async (req, res) => {
    await syncWebsiteLeads();
    return res.render('crm/dashboard', {
      csrf: req.crmSession.csrf,
      username: req.crmSession.u,
      statusLabels: crmDb.STATUS,
      integrations: {
        telegram: Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID),
        whatsapp: Boolean(process.env.WHATSAPP_ACCESS_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID && process.env.WHATSAPP_APP_SECRET),
      },
    });
  });

  router.post('/crm/logout', requireCrm, requireCsrf, (req, res) => {
    res.setHeader('Set-Cookie', 'zke_crm=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0');
    return res.redirect('/crm/login');
  });

  router.get('/api/crm/summary', requireCrm, async (req, res) => {
    await syncWebsiteLeads();
    return res.json(await crmDb.summary());
  });

  router.get('/api/crm/clients', requireCrm, async (req, res) => {
    await syncWebsiteLeads();
    const clients = await crmDb.listClients({
      status: String(req.query.status || ''),
      q: String(req.query.q || ''),
      limit: req.query.limit,
    });
    return res.json({ clients });
  });

  router.get('/api/crm/clients/:id', requireCrm, async (req, res) => {
    const client = await crmDb.getClient(req.params.id);
    if (!client) return res.status(404).json({ error: 'NOT_FOUND' });
    return res.json({ client });
  });

  router.post('/api/crm/clients', requireCrm, requireCsrf, async (req, res) => {
    try {
      const client = await crmDb.createClient(req.body || {});
      return res.status(201).json({ client });
    } catch (error) {
      if (error.message === 'PHONE_REQUIRED') return res.status(400).json({ error: 'Укажите номер телефона' });
      return res.status(500).json({ error: 'Не удалось создать клиента' });
    }
  });

  router.patch('/api/crm/clients/:id', requireCrm, requireCsrf, async (req, res) => {
    try {
      const client = await crmDb.updateClient(req.params.id, req.body || {}, 'crm');
      if (!client) return res.status(404).json({ error: 'NOT_FOUND' });
      return res.json({ client });
    } catch (error) {
      if (error.message === 'PHONE_EXISTS') return res.status(409).json({ error: 'Этот номер уже есть в CRM' });
      if (error.message === 'PHONE_REQUIRED') return res.status(400).json({ error: 'Укажите номер телефона' });
      return res.status(500).json({ error: 'Не удалось сохранить' });
    }
  });

  router.post('/api/crm/clients/:id/promise', requireCrm, requireCsrf, async (req, res) => {
    const client = await crmDb.addPromise(req.params.id, req.body || {}, 'crm');
    if (!client) return res.status(404).json({ error: 'NOT_FOUND' });
    return res.json({ client });
  });

  router.post('/api/crm/clients/:id/payment', requireCrm, requireCsrf, async (req, res) => {
    const client = await crmDb.addPayment(req.params.id, req.body || {}, 'crm');
    if (!client) return res.status(404).json({ error: 'NOT_FOUND' });
    return res.json({ client });
  });

  router.post('/api/crm/clients/:id/contracts', requireCrm, requireCsrf, async (req, res) => {
    const result = await crmDb.addContract(req.params.id, req.body || {}, 'crm');
    if (!result) return res.status(404).json({ error: 'NOT_FOUND' });
    return res.json(result);
  });

  router.post('/api/crm/clients/:id/whatsapp', requireCrm, requireCsrf, async (req, res) => {
    const client = await crmDb.getClient(req.params.id);
    if (!client) return res.status(404).json({ error: 'NOT_FOUND' });

    const accessToken = String(process.env.WHATSAPP_ACCESS_TOKEN || '').trim();
    const phoneNumberId = String(process.env.WHATSAPP_PHONE_NUMBER_ID || '').trim();
    const graphVersion = String(process.env.WHATSAPP_GRAPH_VERSION || 'v25.0').trim();
    const text = String(req.body?.text || '').trim().slice(0, 4000);
    if (!accessToken || !phoneNumberId) return res.status(503).json({ error: 'WhatsApp Cloud API ещё не подключён' });
    if (!text) return res.status(400).json({ error: 'Введите сообщение' });

    try {
      const response = await axios.post(
        `https://graph.facebook.com/${graphVersion}/${phoneNumberId}/messages`,
        {
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: client.phoneNorm,
          type: 'text',
          text: { body: text, preview_url: false },
        },
        {
          headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
          timeout: 15000,
        }
      );
      const messageId = response.data?.messages?.[0]?.id || '';
      await crmDb.recordMessageByPhone({
        phone: client.phoneNorm,
        name: client.name,
        channel: 'whatsapp',
        direction: 'out',
        text,
        messageId,
        at: Date.now(),
      });
      return res.json({ ok: true, messageId });
    } catch (error) {
      const metaMessage = error.response?.data?.error?.message || 'WhatsApp не принял сообщение';
      return res.status(502).json({ error: metaMessage });
    }
  });

  router.get('/api/crm/export.json', requireCrm, async (req, res) => {
    const clients = await crmDb.exportAll();
    res.set('Content-Disposition', `attachment; filename="zakonexpert-crm-${new Date().toISOString().slice(0, 10)}.json"`);
    return res.json({ generatedAt: new Date().toISOString(), clients });
  });

  router.get('/api/crm/export.csv', requireCrm, async (req, res) => {
    const clients = await crmDb.exportAll();
    const rows = [
      ['ФИО', 'Телефон', 'Статус', 'Работа', 'Обещано', 'Дата обещания', 'Оплачено', 'Источник', 'Договоры', 'Примечания'],
      ...clients.map(client => [
        client.name,
        client.phone,
        crmDb.STATUS[client.status] || client.status,
        client.work,
        client.promiseAmount || '',
        client.promiseDate || '',
        client.paidAmount || '',
        client.source,
        (client.contracts || []).map(c => `${c.title}${c.number ? ` №${c.number}` : ''}`).join('; '),
        client.notes,
      ]),
    ];
    const csv = '\uFEFF' + rows.map(row => row.map(csvCell).join(';')).join('\r\n');
    res.type('text/csv; charset=utf-8');
    res.set('Content-Disposition', `attachment; filename="zakonexpert-crm-${new Date().toISOString().slice(0, 10)}.csv"`);
    return res.send(csv);
  });

  // Generic endpoint for the existing contract generator/bot. Once that service
  // POSTs here, contracts appear in CRM without copying data by hand.
  router.post('/api/crm/integrations/contracts', async (req, res) => {
    if (!integrationAuthorized(req)) return res.status(401).json({ error: 'UNAUTHORIZED' });
    try {
      const result = await crmDb.addContractByPhone(req.body?.phone, {
        name: req.body?.name,
        title: req.body?.title,
        number: req.body?.number,
        amount: req.body?.amount,
        date: req.body?.date,
        fileUrl: req.body?.fileUrl,
      }, 'contract-bot');
      return res.status(201).json({ ok: true, clientId: result.client._id, contractId: result.contract.id });
    } catch (error) {
      return res.status(400).json({ error: error.message === 'PHONE_REQUIRED' ? 'PHONE_REQUIRED' : 'BAD_REQUEST' });
    }
  });

  app.use(router);
}

module.exports = {
  installCrm,
  readSession,
  sessionConfigured,
  verifyWhatsAppSignature,
};
