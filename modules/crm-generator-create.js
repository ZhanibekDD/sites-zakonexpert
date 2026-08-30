'use strict';

const crypto = require('crypto');
const axios = require('axios');
const crmDb = require('./crm-db');
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
  return Boolean(generatorBaseUrl() && integrationKey().length >= 24);
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

function installCrmGeneratorCreate(app, express) {
  // Keep dashboard.ejs focused on the Kanban itself. This middleware injects the optional
  // generator UI only into the authenticated CRM page and leaves the public site untouched.
  app.use((req, res, next) => {
    if (req.path !== '/crm') return next();
    const originalRender = res.render.bind(res);
    res.render = function renderWithGenerator(view, options, callback) {
      if (view !== 'crm/dashboard' || typeof callback === 'function') {
        return originalRender(view, options, callback);
      }
      return originalRender(view, options, (error, html) => {
        if (error) return next(error);
        return res.send(injectGeneratorUi(html));
      });
    };
    return next();
  });

  app.post(
    '/api/crm/generator/create',
    requireCrm,
    express.json({ limit: '256kb' }),
    requireCsrf,
    async (req, res) => {
      if (!generatorConfigured()) {
        return res.status(503).json({ error: 'Генератор договоров ещё не подключён к CRM' });
      }

      const body = req.body || {};
      let crmClient = null;
      if (body.clientId) crmClient = await crmDb.getClient(cleanText(body.clientId, 100));

      const name = cleanText(body.name || crmClient?.name, 255);
      const iin = normalizeIin(body.iin || crmClient?.iin);
      const phone = cleanText(body.phone || crmClient?.phone, 32);
      const address = cleanText(body.address || crmClient?.address, 512);
      const service = cleanText(body.service || crmClient?.work || crmClient?.issue, 2000);
      const amount = positiveInt(body.amount);
      const paymentType = ['prepayment', 'after_result', 'split', 'already_paid', 'custom'].includes(body.paymentType)
        ? body.paymentType
        : 'prepayment';

      if (name.length < 3) return res.status(400).json({ error: 'Укажите ФИО клиента' });
      if (iin.length !== 12) return res.status(400).json({ error: 'Укажите ИИН клиента: 12 цифр' });
      if (service.length < 3) return res.status(400).json({ error: 'Укажите услугу / что нужно сделать' });
      if (!amount) return res.status(400).json({ error: 'Укажите стоимость договора' });

      const serviceDetails = Array.isArray(body.serviceDetails)
        ? body.serviceDetails.map(item => cleanText(item, 1000)).filter(Boolean).slice(0, 50)
        : cleanText(body.serviceDetails, 5000).split(/\r?\n|;/).map(item => item.trim()).filter(Boolean).slice(0, 50);

      const payload = {
        client: {
          name,
          iin,
          phone,
          address,
          document_number: cleanText(body.documentNumber || crmClient?.documentNumber, 64),
          birth_date: null,
        },
        service,
        service_details: serviceDetails,
        amount,
        payment_type: paymentType,
        first_payment: optionalInt(body.firstPayment),
        second_payment: optionalInt(body.secondPayment),
        work_period: cleanText(body.workPeriod || 'до 30 календарных дней', 500) || null,
        result_definition: cleanText(body.resultDefinition, 4000) || null,
        subject_paragraph: null,
        actions_paragraph: null,
      };

      if (paymentType === 'split') {
        if (payload.first_payment === null || payload.second_payment === null) {
          return res.status(400).json({ error: 'Для оплаты частями укажите обе суммы' });
        }
        if (payload.first_payment + payload.second_payment !== amount) {
          return res.status(400).json({ error: 'Суммы двух платежей должны равняться стоимости договора' });
        }
      }

      try {
        const response = await axios.post(
          `${generatorBaseUrl()}/internal/crm/create-contract`,
          payload,
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

        return res.status(201).json({
          ok: true,
          clientId: synced?.client?._id || crmClient?._id || '',
          contractId: synced?.contract?.id || '',
          number: contractPayload?.number || '',
          generatorContractId: contractPayload?.generatorContractId || '',
        });
      } catch (error) {
        const detail = error.response?.data?.detail;
        const messages = {
          UNAUTHORIZED: 'Ключ интеграции CRM и генератора не совпадает',
          CRM_MANAGER_NOT_CONFIGURED: 'В генераторе не указан SUPERADMIN_TELEGRAM_IDS',
          CRM_MANAGER_NOT_FOUND: 'Генератор не нашёл активного пользователя для создания договора',
          CONTRACT_CREATE_FAILED: 'Генератор не смог сформировать договор',
        };
        if (messages[detail]) return res.status(error.response?.status || 502).json({ error: messages[detail] });
        return res.status(502).json({ error: 'Не удалось создать договор в системе договоров' });
      }
    }
  );
}

module.exports = { installCrmGeneratorCreate, generatorConfigured };
