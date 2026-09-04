'use strict';

const crypto = require('crypto');
const axios = require('axios');
const crmDb = require('./crm-db');
const jobs = require('./crm-generation-jobs');
const { readSession } = require('./crm-routes');

function safeEqual(a, b) {
  const aa = Buffer.from(String(a || ''));
  const bb = Buffer.from(String(b || ''));
  if (aa.length !== bb.length) return false;
  return crypto.timingSafeEqual(aa, bb);
}

function requireCrm(req, res, next) {
  const session = readSession(req);
  if (!session) return res.status(401).json({ error: 'AUTH_REQUIRED' });
  req.crmSession = session;
  next();
}

function requireCsrf(req, res, next) {
  const token = String(req.headers['x-csrf-token'] || req.body?._csrf || '');
  if (!token || !req.crmSession?.csrf || !safeEqual(token, req.crmSession.csrf)) {
    return res.status(403).json({ error: 'BAD_CSRF' });
  }
  next();
}

function generatorBaseUrl() {
  return String(process.env.CRM_GENERATOR_API_URL || '').trim().replace(/\/+$/, '');
}

function integrationKey() {
  return String(process.env.CRM_INTEGRATION_KEY || '').trim();
}

function generatorConfigured() {
  // Pull mode needs no public generator URL. A shared 24+ char secret is enough: the
  // generator polls zakonexpert.kz outbound over HTTPS and never exposes port 8000.
  return integrationKey().length >= 24;
}

function directGeneratorConfigured() {
  return Boolean(generatorBaseUrl() && generatorConfigured());
}

function integrationAuthorized(req) {
  const expected = integrationKey();
  const provided = String(req.headers['x-crm-integration-key'] || '').trim();
  return expected.length >= 24 && safeEqual(expected, provided);
}

function requireIntegration(req, res, next) {
  if (!integrationAuthorized(req)) return res.status(401).json({ error: 'UNAUTHORIZED' });
  next();
}

function cleanText(value, max = 4000) {
  return String(value ?? '').replace(/\u0000/g, '').trim().slice(0, max);
}

function normalizeIin(value) {
  return String(value || '').replace(/\D/g, '').slice(0, 12);
}

function positiveInt(value) {
  const n = Number(String(value ?? '').replace(/\s/g, '').replace(',', '.'));
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.round(n);
}

function optionalInt(value) {
  if (value === '' || value === null || value === undefined) return null;
  const n = Number(String(value).replace(/\s/g, '').replace(',', '.'));
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n);
}

function injectGeneratorUi(html) {
  const marker = '<script src="/js/crm-generator-ui.js"></script>';
  if (String(html).includes(marker)) return html;
  return String(html).replace('</body>', `${marker}</body>`);
}

async function normalizeRequest(body = {}) {
  let crmClient = null;
  if (body.clientId) crmClient = await crmDb.getClient(cleanText(body.clientId, 100));

  const normalized = {
    clientId: cleanText(body.clientId || crmClient?._id, 100),
    name: cleanText(body.name || crmClient?.name, 255),
    iin: normalizeIin(body.iin || crmClient?.iin),
    phone: cleanText(body.phone || crmClient?.phone, 32),
    address: cleanText(body.address || crmClient?.address, 512),
    documentNumber: cleanText(body.documentNumber || crmClient?.documentNumber, 64),
    service: cleanText(body.service || crmClient?.work || crmClient?.issue, 2000),
    serviceDetails: Array.isArray(body.serviceDetails)
      ? body.serviceDetails.map(item => cleanText(item, 1000)).filter(Boolean).slice(0, 50)
      : cleanText(body.serviceDetails, 5000).split(/\r?\n|;/).map(item => item.trim()).filter(Boolean).slice(0, 50),
    amount: positiveInt(body.amount),
    paymentType: ['prepayment', 'after_result', 'split', 'already_paid', 'custom'].includes(body.paymentType)
      ? body.paymentType
      : 'prepayment',
    firstPayment: optionalInt(body.firstPayment),
    secondPayment: optionalInt(body.secondPayment),
    workPeriod: cleanText(body.workPeriod || 'до 30 календарных дней', 500),
    resultDefinition: cleanText(body.resultDefinition, 4000),
  };

  if (normalized.name.length < 3) throw Object.assign(new Error('Укажите ФИО клиента'), { status: 400 });
  if (normalized.iin.length !== 12) throw Object.assign(new Error('Укажите ИИН клиента: 12 цифр'), { status: 400 });
  if (normalized.service.length < 3) throw Object.assign(new Error('Укажите услугу / что нужно сделать'), { status: 400 });
  if (!normalized.amount) throw Object.assign(new Error('Укажите стоимость договора'), { status: 400 });
  if (normalized.paymentType === 'split') {
    if (normalized.firstPayment === null || normalized.secondPayment === null) {
      throw Object.assign(new Error('Для оплаты частями укажите обе суммы'), { status: 400 });
    }
    if (normalized.firstPayment + normalized.secondPayment !== normalized.amount) {
      throw Object.assign(new Error('Суммы двух платежей должны равняться стоимости договора'), { status: 400 });
    }
  }
  return normalized;
}

function toGeneratorPayload(input) {
  return {
    client: {
      name: input.name,
      iin: input.iin,
      phone: input.phone,
      address: input.address,
      document_number: input.documentNumber,
      birth_date: null,
    },
    service: input.service,
    service_details: input.serviceDetails,
    amount: input.amount,
    payment_type: input.paymentType,
    first_payment: input.firstPayment,
    second_payment: input.secondPayment,
    work_period: input.workPeriod || null,
    result_definition: input.resultDefinition || null,
    subject_paragraph: null,
    actions_paragraph: null,
  };
}

async function createDirect(input) {
  const response = await axios.post(
    `${generatorBaseUrl()}/internal/crm/create-contract`,
    toGeneratorPayload(input),
    {
      headers: {
        'X-CRM-Integration-Key': integrationKey(),
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      timeout: 120000,
      maxContentLength: 2 * 1024 * 1024,
      maxBodyLength: 512 * 1024,
    }
  );
  const contractPayload = response.data?.contract;
  let synced = null;
  if (contractPayload && typeof contractPayload === 'object') {
    synced = await crmDb.upsertContractFromIntegration(contractPayload, 'crm-generator');
  }
  return {
    ok: true,
    queued: false,
    clientId: synced?.client?._id || input.clientId || '',
    contractId: synced?.contract?.id || '',
    number: contractPayload?.number || '',
    generatorContractId: contractPayload?.generatorContractId || '',
  };
}

function generatorError(error) {
  const detail = error.response?.data?.detail;
  const messages = {
    UNAUTHORIZED: 'Ключ интеграции CRM и генератора не совпадает',
    CRM_MANAGER_NOT_CONFIGURED: 'В генераторе не указан SUPERADMIN_TELEGRAM_IDS',
    CRM_MANAGER_NOT_FOUND: 'Генератор не нашёл активного пользователя для создания договора',
    CONTRACT_CREATE_FAILED: 'Генератор не смог сформировать договор',
  };
  return messages[detail] || 'Не удалось создать договор в системе договоров';
}

function publicJob(job) {
  if (!job) return null;
  return {
    id: job.id,
    status: job.status,
    attempts: Number(job.attempts || 0),
    error: job.error || '',
    result: job.result || null,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  };
}

function installCrmGeneratorCreate(app, express) {
  // Keep dashboard.ejs focused on the Kanban itself. The optional generator UI is injected
  // only into the authenticated CRM page; public pages remain untouched.
  app.use((req, res, next) => {
    if (req.path !== '/crm') return next();
    const originalRender = res.render.bind(res);
    res.render = function renderWithGenerator(view, options, callback) {
      if (view !== 'crm/dashboard' || typeof callback === 'function') return originalRender(view, options, callback);
      return originalRender(view, options, (error, html) => {
        if (error) return next(error);
        return res.send(injectGeneratorUi(html));
      });
    };
    next();
  });

  app.post('/api/crm/generator/create', requireCrm, express.json({ limit: '256kb' }), requireCsrf, async (req, res) => {
    if (!generatorConfigured()) return res.status(503).json({ error: 'Сначала задайте CRM_INTEGRATION_KEY' });
    let input;
    try { input = await normalizeRequest(req.body || {}); }
    catch (error) { return res.status(error.status || 400).json({ error: error.message }); }

    // If a public/internal generator API URL exists, keep fast synchronous mode. Otherwise
    // use the safer default: enqueue and let the already-running generator bot pull it.
    if (directGeneratorConfigured()) {
      try { return res.status(201).json(await createDirect(input)); }
      catch (error) { return res.status(error.response?.status || 502).json({ error: generatorError(error) }); }
    }

    const job = await jobs.createJob(input, req.crmSession.u || 'crm');
    return res.status(202).json({ ok: true, queued: true, jobId: job.id, status: job.status });
  });

  app.get('/api/crm/generator/jobs/:id', requireCrm, async (req, res) => {
    const job = await jobs.getJob(req.params.id);
    if (!job) return res.status(404).json({ error: 'JOB_NOT_FOUND' });
    return res.json({ job: publicJob(job) });
  });

  app.post('/api/crm/generator/jobs/:id/retry', requireCrm, express.json({ limit: '16kb' }), requireCsrf, async (req, res) => {
    const job = await jobs.retry(req.params.id);
    if (!job) return res.status(409).json({ error: 'Задание нельзя повторить' });
    return res.json({ job: publicJob(job) });
  });

  // Outbound-pull API. The generator reaches these endpoints from its own server; no
  // generator port/domain needs to be exposed to the internet.
  app.post('/api/crm/integrations/generator/jobs/claim', express.json({ limit: '32kb' }), requireIntegration, async (req, res) => {
    const job = await jobs.claimNext(cleanText(req.body?.workerId, 180));
    return res.json({ job: job ? { id: job.id, payload: job.payload, attempts: job.attempts, leaseUntil: job.leaseUntil } : null });
  });

  app.post('/api/crm/integrations/generator/jobs/:id/heartbeat', express.json({ limit: '32kb' }), requireIntegration, async (req, res) => {
    const ok = await jobs.heartbeat(req.params.id, cleanText(req.body?.workerId, 180));
    return res.status(ok ? 200 : 409).json({ ok });
  });

  app.post('/api/crm/integrations/generator/jobs/:id/complete', express.json({ limit: '512kb' }), requireIntegration, async (req, res) => {
    const contractPayload = req.body?.contract;
    if (!contractPayload || typeof contractPayload !== 'object') return res.status(400).json({ error: 'CONTRACT_REQUIRED' });
    try {
      const synced = await crmDb.upsertContractFromIntegration(contractPayload, 'crm-generator-pull');
      const job = await jobs.complete(req.params.id, {
        clientId: synced.client._id,
        contractId: synced.contract.id,
        number: synced.contract.number,
        generatorContractId: synced.contract.generatorContractId,
      });
      if (!job) return res.status(404).json({ error: 'JOB_NOT_FOUND' });
      return res.json({ ok: true, job: publicJob(job) });
    } catch (error) {
      return res.status(422).json({ error: error.message === 'IDENTIFIER_REQUIRED' ? 'CLIENT_IDENTIFIER_REQUIRED' : 'SYNC_FAILED' });
    }
  });

  app.post('/api/crm/integrations/generator/jobs/:id/fail', express.json({ limit: '64kb' }), requireIntegration, async (req, res) => {
    const job = await jobs.fail(req.params.id, cleanText(req.body?.error || 'GENERATION_FAILED', 1200));
    if (!job) return res.status(404).json({ error: 'JOB_NOT_FOUND' });
    return res.json({ ok: true });
  });
}

module.exports = { installCrmGeneratorCreate, generatorConfigured, directGeneratorConfigured, toGeneratorPayload };
