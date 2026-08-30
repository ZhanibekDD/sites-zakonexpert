'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const crmDb = require('./crm-db');
const crmContracts = require('./crm-contracts');

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
  const body = { u: username, exp: Date.now() + 12 * 60 * 60 * 1000, csrf: crypto.randomBytes(24).toString('base64url') };
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
      "default-src 'self'", "base-uri 'self'", "frame-ancestors 'none'", "form-action 'self'", "object-src 'none'",
      "script-src 'self' 'unsafe-inline'", "style-src 'self' 'unsafe-inline'", "img-src 'self' data:", "connect-src 'self'",
    ].join('; '),
  });
  next();
}

function publicContractHeaders(req, res, next) {
  res.set({
    'Cache-Control': 'private, no-store, max-age=0',
    'Pragma': 'no-cache',
    'X-Robots-Tag': 'noindex, nofollow, noarchive',
    'X-Frame-Options': 'DENY',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
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
  const token = String(req.headers['x-csrf-token'] || (req.body && !Buffer.isBuffer(req.body) ? req.body._csrf : '') || '');
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

function requestIp(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return forwarded || String(req.ip || req.socket.remoteAddress || '').slice(0, 100);
}

function isoDate(value) {
  const s = String(value || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](20\d{2})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return '';
}

function dependencyMessage(error) {
  if (['CRM_PDF_DEPENDENCY_MISSING', 'CRM_DOCX_DEPENDENCY_MISSING', 'CRM_PDF_PARSE_DEPENDENCY_MISSING'].includes(error.message)) {
    return 'Модуль договоров добавлен, но на сервере ещё нужно выполнить «Установка NPM» в Plesk.';
  }
  return error.message || 'Ошибка модуля договоров';
}

async function sendTelegramDocument(file, filename, caption = '') {
  const token = String(process.env.TELEGRAM_BOT_TOKEN || '').trim();
  const chatId = String(process.env.TELEGRAM_CHAT_ID || '').trim();
  if (!token || !chatId) throw new Error('Telegram не настроен');
  const form = new FormData();
  form.append('chat_id', chatId);
  form.append('caption', String(caption || '').slice(0, 1000));
  form.append('document', new Blob([fs.readFileSync(file)]), filename);
  await axios.post(`https://api.telegram.org/bot${token}/sendDocument`, form, { timeout: 20000 });
}

function secureContractUrl(clientId, contractId, kind) {
  return `/api/crm/clients/${encodeURIComponent(clientId)}/contracts/${encodeURIComponent(contractId)}/file/${kind}`;
}

function installCrm(app, express) {
  const router = express.Router();

  // Public signing routes are isolated from the private CRM session.
  router.get('/contract/sign/:token', publicContractHeaders, async (req, res) => {
    const hash = crmContracts.hashSignToken(req.params.token);
    const found = await crmDb.findContractBySignTokenHash(hash);
    if (!found) return res.status(404).send('Ссылка недействительна или договор удалён.');
    return res.render('crm/sign', { client: found.client, contract: found.contract, token: req.params.token, signed: Boolean(found.contract.signedAt), error: false });
  });

  router.get('/contract/sign/:token/file.pdf', publicContractHeaders, async (req, res) => {
    const hash = crmContracts.hashSignToken(req.params.token);
    const found = await crmDb.findContractBySignTokenHash(hash);
    if (!found || !found.contract.fileKey) return res.status(404).send('Файл не найден');
    const file = crmContracts.readFile(found.contract.fileKey, 'pdf');
    if (!file) return res.status(404).send('Файл не найден');
    res.type('application/pdf');
    res.set('Content-Disposition', `inline; filename="contract-${String(found.contract.number || 'zakonexpert').replace(/[^a-zA-Z0-9_-]/g, '_')}.pdf"`);
    return res.sendFile(path.resolve(file));
  });

  router.post('/contract/sign/:token', publicContractHeaders, express.urlencoded({ extended: false, limit: '32kb' }), async (req, res) => {
    if (String(req.body?.agree || '') !== 'yes') {
      const hash = crmContracts.hashSignToken(req.params.token);
      const found = await crmDb.findContractBySignTokenHash(hash);
      if (!found) return res.status(404).send('Ссылка недействительна');
      return res.status(400).render('crm/sign', { client: found.client, contract: found.contract, token: req.params.token, signed: false, error: true });
    }
    const hash = crmContracts.hashSignToken(req.params.token);
    const found = await crmDb.findContractBySignTokenHash(hash);
    if (!found) return res.status(404).send('Ссылка недействительна');
    const docHash = found.contract.documentHash || crmContracts.documentHashFromContract(found.contract);
    const signed = await crmDb.signContractByTokenHash(hash, { ip: requestIp(req), userAgent: String(req.headers['user-agent'] || '').slice(0, 500), documentHash: docHash });
    if (!signed) return res.status(404).send('Ссылка недействительна');
    if (signed.contract.fileKey && signed.contract.source === 'crm-generator') {
      try {
        const regenerated = await crmContracts.generateFiles({ ...signed.contract, clientName: signed.client.name, clientIin: signed.client.iin, clientPhone: signed.client.phone, clientAddress: signed.client.address });
        await crmDb.updateContract(signed.client._id, signed.contract.id, { fileKey: regenerated.fileKey, documentHash: regenerated.documentHash }, 'client-sign');
      } catch (_) {}
    }
    const refreshed = await crmDb.getContract(signed.client._id, signed.contract.id);
    return res.render('crm/sign', { client: refreshed.client, contract: refreshed.contract, token: req.params.token, signed: true, error: false });
  });

  router.use(securityHeaders);

  // WhatsApp Cloud API webhook must receive raw JSON so x-hub-signature-256 can be verified.
  router.get('/api/whatsapp/webhook', (req, res) => {
    const verifyToken = String(process.env.WHATSAPP_VERIFY_TOKEN || '').trim();
    const mode = String(req.query['hub.mode'] || '');
    const token = String(req.query['hub.verify_token'] || '');
    const challenge = String(req.query['hub.challenge'] || '');
    if (verifyToken && mode === 'subscribe' && safeEqual(token, verifyToken)) return res.status(200).send(challenge);
    return res.status(403).send('Forbidden');
  });

  router.post('/api/whatsapp/webhook', express.raw({ type: 'application/json', limit: '1mb' }), async (req, res) => {
    if (!verifyWhatsAppSignature(req.body, String(req.headers['x-hub-signature-256'] || ''))) return res.status(401).send('Invalid signature');
    let payload;
    try { payload = JSON.parse(req.body.toString('utf8')); } catch (_) { return res.status(400).send('Bad JSON'); }
    try {
      for (const entry of payload.entry || []) {
        for (const change of entry.changes || []) {
          const value = change.value || {};
          const contactByWaId = new Map((value.contacts || []).map(contact => [String(contact.wa_id || ''), contact.profile?.name || '']));
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
    } catch (_) {}
    return res.status(200).send('EVENT_RECEIVED');
  });

  // PDF import is raw and private. Existing contract PDFs can be dropped here in bulk from the browser.
  router.post('/api/crm/contracts/import', requireCrm, express.raw({ type: 'application/pdf', limit: '15mb' }), requireCsrf, async (req, res) => {
    try {
      const filenameB64 = String(req.headers['x-file-name-b64'] || '');
      const filename = filenameB64 ? Buffer.from(filenameB64, 'base64').toString('utf8') : 'contract.pdf';
      const imported = await crmContracts.importPdf(req.body, filename);
      const fields = imported.fields || {};
      let client = null;
      const explicitClientId = String(req.query.clientId || '').trim();
      if (explicitClientId) client = await crmDb.getClient(explicitClientId);
      if (!client) client = await crmDb.findByIdentity({ phone: fields.phone, iin: fields.iin });
      if (!client) {
        client = await crmDb.createClient({ name: fields.name, phone: fields.phone, iin: fields.iin, address: fields.address, source: 'contract-import', sourceType: 'contract-import' });
      } else {
        client = await crmDb.updateClient(client._id, {
          name: client.name || fields.name,
          phone: client.phone || fields.phone,
          iin: client.iin || fields.iin,
          address: client.address || fields.address,
        }, 'contract-import');
      }
      const result = await crmDb.addContract(client._id, {
        title: 'Ранее созданный договор',
        number: fields.number,
        amount: fields.amount,
        date: isoDate(fields.date) || crmContracts.almatyDateParts().iso,
        workPeriod: fields.workPeriod,
        serviceSubject: fields.serviceSubject,
        fileKey: imported.fileKey,
        originalFilename: imported.originalFilename,
        importedHash: imported.importedHash,
        status: 'sent',
        clientSnapshot: { name: client.name, iin: client.iin, phone: client.phone, address: client.address },
      }, 'contract-import');
      return res.status(201).json({ ok: true, client: result.client, contract: result.contract, parsed: fields });
    } catch (error) {
      if (error.message === 'IDENTITY_REQUIRED') return res.status(422).json({ error: 'Не удалось найти в PDF телефон или ИИН. Откройте карточку клиента и импортируйте PDF из неё.' });
      return res.status(error.message.includes('DEPENDENCY') ? 503 : 400).json({ error: dependencyMessage(error) });
    }
  });

  router.use(express.json({ limit: '768kb' }));
  router.use(express.urlencoded({ extended: false, limit: '64kb' }));

  router.get('/crm/login', (req, res) => {
    if (readSession(req)) return res.redirect('/crm');
    return res.render('crm/login', { configured: sessionConfigured(), error: req.query.error === '1' });
  });

  router.post('/crm/login', (req, res) => {
    if (!loginAllowed(req)) return res.status(429).render('crm/login', { configured: sessionConfigured(), error: true });
    if (!sessionConfigured()) return res.status(503).render('crm/login', { configured: false, error: false });
    const expectedUser = String(process.env.CRM_USERNAME || 'admin').trim();
    const expectedPassword = String(process.env.CRM_PASSWORD || '');
    const user = String(req.body.username || '').trim();
    const password = String(req.body.password || '');
    if (!safeEqual(user, expectedUser) || !safeEqual(password, expectedPassword)) return res.status(401).render('crm/login', { configured: true, error: true });
    const session = createSession(user);
    res.setHeader('Set-Cookie', `zke_crm=${encodeURIComponent(session.token)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=43200`);
    return res.redirect('/crm');
  });

  router.get('/crm', requireCrm, async (req, res) => {
    return res.render('crm/dashboard', {
      csrf: req.crmSession.csrf,
      username: req.crmSession.u,
      statusLabels: crmDb.STATUS,
      contractStatusLabels: crmDb.CONTRACT_STATUS,
      servicePresets: crmContracts.SERVICE_PRESETS,
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

  router.get('/api/crm/summary', requireCrm, async (req, res) => res.json(await crmDb.summary()));

  router.get('/api/crm/clients', requireCrm, async (req, res) => {
    const clients = await crmDb.listClients({ status: String(req.query.status || ''), q: String(req.query.q || ''), limit: req.query.limit });
    return res.json({ clients });
  });

  router.get('/api/crm/leads', requireCrm, async (req, res) => {
    try {
      const leadsDb = require('./leads-db');
      const limit = Math.max(1, Math.min(5000, Number(req.query.limit) || 1000));
      const leads = await leadsDb.getRecent(limit);
      const allClients = await crmDb.listClients({ limit: 8000, includeLeadOnly: true });
      const promotedIds = new Set();
      for (const client of allClients) {
        if (!client.promotedAt) continue;
        for (const id of client.sourceLeadIds || []) promotedIds.add(id);
      }
      return res.json({ leads: leads.map(lead => ({ ...lead, promoted: promotedIds.has(lead._id) })) });
    } catch (_) {
      return res.json({ leads: [] });
    }
  });

  router.post('/api/crm/leads/:id/promote', requireCrm, requireCsrf, async (req, res) => {
    try {
      const leadsDb = require('./leads-db');
      const leads = await leadsDb.getRecent(5000);
      const lead = leads.find(item => item._id === req.params.id);
      if (!lead) return res.status(404).json({ error: 'Лид не найден' });
      const client = await crmDb.upsertFromLead(lead, { promote: true });
      return res.json({ client });
    } catch (error) {
      return res.status(400).json({ error: dependencyMessage(error) });
    }
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
      if (error.message === 'IDENTITY_REQUIRED') return res.status(400).json({ error: 'Укажите телефон или ИИН' });
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
      if (error.message === 'IIN_EXISTS') return res.status(409).json({ error: 'Этот ИИН уже есть в CRM' });
      if (error.message === 'IDENTITY_REQUIRED') return res.status(400).json({ error: 'У клиента должен быть телефон или ИИН' });
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

  // Manual contract record (for a link or metadata that already exists elsewhere).
  router.post('/api/crm/clients/:id/contracts', requireCrm, requireCsrf, async (req, res) => {
    const result = await crmDb.addContract(req.params.id, req.body || {}, 'crm');
    if (!result) return res.status(404).json({ error: 'NOT_FOUND' });
    return res.json(result);
  });

  // Full contract generator: same core fields as the Telegram generator, now inside CRM.
  router.post('/api/crm/clients/:id/contracts/generate', requireCrm, requireCsrf, async (req, res) => {
    try {
      const client = await crmDb.getClient(req.params.id);
      if (!client) return res.status(404).json({ error: 'NOT_FOUND' });
      const number = String(req.body?.number || '').trim() || await crmDb.nextContractNumber();
      const draft = crmContracts.normalizeDraft({ ...req.body, number, source: 'crm-generator' }, client);
      const token = crmContracts.signToken();
      const files = await crmContracts.generateFiles(draft);
      const result = await crmDb.addContract(client._id, {
        ...draft,
        fileKey: files.fileKey,
        documentHash: files.documentHash,
        signTokenHash: token.hash,
        status: req.body?.status || 'draft',
        clientSnapshot: { name: client.name, iin: client.iin, phone: client.phone, address: client.address },
      }, 'crm-generator');
      return res.status(201).json({
        client: result.client,
        contract: result.contract,
        signUrl: `${req.protocol}://${req.get('host')}/contract/sign/${token.raw}`,
        pdfUrl: secureContractUrl(client._id, result.contract.id, 'pdf'),
        docxUrl: secureContractUrl(client._id, result.contract.id, 'docx'),
      });
    } catch (error) {
      return res.status(error.message.includes('DEPENDENCY') ? 503 : 400).json({ error: dependencyMessage(error) });
    }
  });

  router.patch('/api/crm/clients/:id/contracts/:contractId', requireCrm, requireCsrf, async (req, res) => {
    const result = await crmDb.updateContract(req.params.id, req.params.contractId, req.body || {}, 'crm');
    if (!result) return res.status(404).json({ error: 'NOT_FOUND' });
    return res.json(result);
  });

  router.delete('/api/crm/clients/:id/contracts/:contractId', requireCrm, requireCsrf, async (req, res) => {
    const result = await crmDb.deleteContract(req.params.id, req.params.contractId, req.body?.reason || '', 'crm');
    if (!result) return res.status(404).json({ error: 'NOT_FOUND' });
    return res.json(result);
  });

  router.post('/api/crm/clients/:id/contracts/:contractId/restore', requireCrm, requireCsrf, async (req, res) => {
    const result = await crmDb.restoreContract(req.params.id, req.params.contractId, 'crm');
    if (!result) return res.status(404).json({ error: 'NOT_FOUND' });
    return res.json(result);
  });

  router.post('/api/crm/clients/:id/contracts/:contractId/sign-link', requireCrm, requireCsrf, async (req, res) => {
    const found = await crmDb.getContract(req.params.id, req.params.contractId);
    if (!found) return res.status(404).json({ error: 'NOT_FOUND' });
    const token = crmContracts.signToken();
    const updated = await crmDb.updateContract(req.params.id, req.params.contractId, { signTokenHash: token.hash }, 'crm');
    return res.json({ contract: updated.contract, signUrl: `${req.protocol}://${req.get('host')}/contract/sign/${token.raw}` });
  });

  router.get('/api/crm/clients/:id/contracts/:contractId/file/:kind', requireCrm, async (req, res) => {
    const found = await crmDb.getContract(req.params.id, req.params.contractId);
    if (!found || !found.contract.fileKey) return res.status(404).json({ error: 'Файл не найден' });
    const kind = req.params.kind === 'docx' ? 'docx' : 'pdf';
    let file = crmContracts.readFile(found.contract.fileKey, kind);
    if (!file && kind === 'pdf') file = crmContracts.readFile(found.contract.fileKey, 'upload');
    if (!file) return res.status(404).json({ error: 'Файл не найден' });
    const ext = kind === 'docx' ? 'docx' : 'pdf';
    const filename = `ZakonExpert_${String(found.contract.number || found.contract.id).replace(/[^a-zA-Z0-9_-]/g, '_')}.${ext}`;
    res.type(kind === 'docx' ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' : 'application/pdf');
    res.set('Content-Disposition', `attachment; filename="${filename}"`);
    return res.sendFile(path.resolve(file));
  });

  router.post('/api/crm/clients/:id/contracts/:contractId/telegram', requireCrm, requireCsrf, async (req, res) => {
    try {
      const found = await crmDb.getContract(req.params.id, req.params.contractId);
      if (!found || !found.contract.fileKey) return res.status(404).json({ error: 'Файл не найден' });
      let file = crmContracts.readFile(found.contract.fileKey, 'pdf') || crmContracts.readFile(found.contract.fileKey, 'upload');
      if (!file) return res.status(404).json({ error: 'PDF не найден' });
      const filename = `ZakonExpert_${String(found.contract.number || found.contract.id).replace(/[^a-zA-Z0-9_-]/g, '_')}.pdf`;
      await sendTelegramDocument(file, filename, `${found.client.name || found.client.phone || 'Клиент'} · договор №${found.contract.number || '—'} · ${Number(found.contract.amount || 0).toLocaleString('ru-RU')} ₸`);
      await crmDb.updateContract(found.client._id, found.contract.id, { status: found.contract.status === 'draft' ? 'sent' : found.contract.status }, 'telegram');
      return res.json({ ok: true });
    } catch (error) {
      return res.status(502).json({ error: error.message || 'Не удалось отправить в Telegram' });
    }
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
    if (!client.phoneNorm) return res.status(400).json({ error: 'У клиента нет номера телефона' });
    try {
      const response = await axios.post(`https://graph.facebook.com/${graphVersion}/${phoneNumberId}/messages`, {
        messaging_product: 'whatsapp', recipient_type: 'individual', to: client.phoneNorm, type: 'text', text: { body: text, preview_url: false },
      }, { headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }, timeout: 15000 });
      const messageId = response.data?.messages?.[0]?.id || '';
      await crmDb.recordMessageByPhone({ phone: client.phoneNorm, name: client.name, channel: 'whatsapp', direction: 'out', text, messageId, at: Date.now() });
      return res.json({ ok: true, messageId });
    } catch (error) {
      return res.status(502).json({ error: error.response?.data?.error?.message || 'WhatsApp не принял сообщение' });
    }
  });

  router.get('/api/crm/export.json', requireCrm, async (req, res) => {
    const clients = await crmDb.exportAll();
    res.set('Content-Disposition', `attachment; filename="zakonexpert-crm-${new Date().toISOString().slice(0, 10)}.json"`);
    return res.json({ generatedAt: new Date().toISOString(), clients });
  });

  router.get('/api/crm/export.csv', requireCrm, async (req, res) => {
    const clients = (await crmDb.exportAll()).filter(client => !crmDb.isWebsiteOnly(client));
    const rows = [
      ['ФИО', 'ИИН', 'Телефон', 'Статус', 'Работа', 'Следующее действие', 'Дата действия', 'Обещано', 'Дата обещания', 'Оплачено', 'Источник', 'Договоры', 'Примечания'],
      ...clients.map(client => [
        client.name, client.iin, client.phone, crmDb.STATUS[client.status] || client.status, client.work, client.nextAction, client.nextActionDate,
        client.promiseAmount || '', client.promiseDate || '', client.paidAmount || '', client.source,
        crmDb.activeContracts(client).map(c => `${c.title}${c.number ? ` №${c.number}` : ''}`).join('; '), client.notes,
      ]),
    ];
    const csv = '\uFEFF' + rows.map(row => row.map(csvCell).join(';')).join('\r\n');
    res.type('text/csv; charset=utf-8');
    res.set('Content-Disposition', `attachment; filename="zakonexpert-crm-${new Date().toISOString().slice(0, 10)}.csv"`);
    return res.send(csv);
  });

  // Contract-bot bridge. Future Telegram-generated contracts can POST full metadata here.
  router.post('/api/crm/integrations/contracts', async (req, res) => {
    if (!integrationAuthorized(req)) return res.status(401).json({ error: 'UNAUTHORIZED' });
    try {
      const result = await crmDb.addContractByIdentity({ phone: req.body?.phone, iin: req.body?.iin, name: req.body?.name, address: req.body?.address, birthDate: req.body?.birthDate }, {
        title: req.body?.title, number: req.body?.number, amount: req.body?.amount, date: req.body?.date, fileUrl: req.body?.fileUrl,
        paymentTerms: req.body?.paymentTerms, workPeriod: req.body?.workPeriod, presetKey: req.body?.presetKey,
        serviceSubject: req.body?.serviceSubject, serviceActions: req.body?.serviceActions, resultDefinition: req.body?.resultDefinition,
        status: req.body?.status || 'sent',
      }, 'contract-bot');
      return res.status(201).json({ ok: true, clientId: result.client._id, contractId: result.contract.id });
    } catch (error) {
      return res.status(400).json({ error: ['PHONE_REQUIRED', 'IDENTITY_REQUIRED'].includes(error.message) ? 'IDENTITY_REQUIRED' : 'BAD_REQUEST' });
    }
  });

  router.post('/api/crm/integrations/contracts/next-number', async (req, res) => {
    if (!integrationAuthorized(req)) return res.status(401).json({ error: 'UNAUTHORIZED' });
    return res.json({ number: await crmDb.nextContractNumber() });
  });

  app.use(router);
}

module.exports = { installCrm, readSession, sessionConfigured, verifyWhatsAppSignature };
