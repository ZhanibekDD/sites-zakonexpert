'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const jobs = require('./crm-generation-jobs');
const { readSession } = require('./crm-routes');
const { safeFilename, resolveStoredFile, storeUpload, saveParsedImport } = require('./crm-contract-import');

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

function requireIntegration(req, res, next) {
  const expected = String(process.env.CRM_INTEGRATION_KEY || '').trim();
  const provided = String(req.headers['x-crm-integration-key'] || '').trim();
  if (expected.length < 24 || !safeEqual(expected, provided)) return res.status(401).json({ error: 'UNAUTHORIZED' });
  next();
}

function allowedUpload(filename, mimeType) {
  const ext = path.extname(filename || '').toLowerCase();
  if (!['.pdf', '.docx', '.txt'].includes(ext)) return false;
  const mime = String(mimeType || '').toLowerCase();
  if (!mime) return true;
  return mime === 'application/pdf'
    || mime.includes('wordprocessingml')
    || mime === 'text/plain'
    || mime === 'application/octet-stream';
}

function installCrmImportPull(app, express) {
  // This route intentionally shadows the older synchronous importer in crm-routes.js.
  // The file is stored privately first; the canonical contract service then downloads and
  // parses it through an outbound HTTPS worker. No public generator API is required.
  app.post(
    '/api/crm/import-contract',
    requireCrm,
    express.json({ limit: '14mb' }),
    requireCsrf,
    async (req, res) => {
      const key = String(process.env.CRM_INTEGRATION_KEY || '').trim();
      if (key.length < 24) return res.status(503).json({ error: 'Сначала задайте CRM_INTEGRATION_KEY' });

      const filename = safeFilename(req.body?.filename || 'contract');
      const mimeType = String(req.body?.mimeType || '').slice(0, 160);
      const dataBase64 = String(req.body?.dataBase64 || '');
      if (!allowedUpload(filename, mimeType)) return res.status(415).json({ error: 'Разрешены PDF, DOCX и TXT' });
      if (!dataBase64 || dataBase64.length > 14_000_000) return res.status(413).json({ error: 'Файл слишком большой' });

      let buffer;
      try {
        buffer = Buffer.from(dataBase64, 'base64');
        if (!buffer.length || buffer.length > 10 * 1024 * 1024) throw new Error('size');
      } catch (_) {
        return res.status(400).json({ error: 'Повреждённый файл' });
      }

      try {
        const stored = storeUpload(buffer, filename);
        const job = await jobs.createImportJob({
          filename,
          mimeType,
          sha256: stored.sha256,
          storedFile: stored.storedFile,
          requestedClientId: String(req.body?.clientId || '').slice(0, 100),
        }, req.crmSession.u || 'crm');
        return res.status(202).json({ ok: true, queued: true, jobId: job.id, status: job.status, filename });
      } catch (_) {
        return res.status(500).json({ error: 'Не удалось сохранить договор для разбора' });
      }
    }
  );

  // This typed claim shadows the older create-only claim route. Both creation and parsing
  // now share one persistent FIFO queue and the worker can dispatch by job.kind.
  app.post(
    '/api/crm/integrations/generator/jobs/claim',
    express.json({ limit: '32kb' }),
    requireIntegration,
    async (req, res) => {
      const job = await jobs.claimNext(String(req.body?.workerId || '').slice(0, 180));
      return res.json({
        job: job ? {
          id: job.id,
          kind: job.kind || jobs.KINDS.CREATE,
          payload: job.payload,
          attempts: job.attempts,
          leaseUntil: job.leaseUntil,
        } : null,
      });
    }
  );

  app.get('/api/crm/integrations/generator/jobs/:id/file', requireIntegration, async (req, res, next) => {
    const job = await jobs.getJob(req.params.id);
    if (!job || job.kind !== jobs.KINDS.PARSE) return next();
    const target = resolveStoredFile(job.payload?.storedFile);
    if (!target || !fs.existsSync(target)) return res.status(404).json({ error: 'FILE_NOT_FOUND' });
    const filename = safeFilename(job.payload?.filename || path.basename(target));
    const ext = path.extname(filename).toLowerCase();
    const mimeType = job.payload?.mimeType
      || (ext === '.pdf' ? 'application/pdf' : ext === '.docx' ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' : 'text/plain');
    res.set('Content-Type', mimeType);
    res.set('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
    return res.sendFile(target);
  });

  // Parse jobs complete with structured extracted data instead of a newly generated
  // contract payload. Create-contract jobs fall through to crm-generator-create.js.
  app.post(
    '/api/crm/integrations/generator/jobs/:id/complete',
    express.json({ limit: '512kb' }),
    requireIntegration,
    async (req, res, next) => {
      const job = await jobs.getJob(req.params.id);
      if (!job || job.kind !== jobs.KINDS.PARSE) return next();
      const parsed = req.body?.parsed;
      if (!parsed || typeof parsed !== 'object') return res.status(400).json({ error: 'PARSED_CONTRACT_REQUIRED' });
      try {
        const synced = await saveParsedImport({
          parsed,
          storedFile: job.payload.storedFile,
          filename: job.payload.filename,
          mimeType: job.payload.mimeType,
          sha256: job.payload.sha256,
        });
        const completed = await jobs.complete(job.id, {
          clientId: synced.client._id,
          contractId: synced.contract.id,
          number: synced.contract.number,
          filename: job.payload.filename,
          imported: true,
        });
        return res.json({ ok: true, job: completed ? { id: completed.id, status: completed.status, result: completed.result } : null });
      } catch (error) {
        if (error.message === 'IDENTIFIER_REQUIRED') {
          await jobs.fail(job.id, 'Не удалось определить клиента: в договоре нет распознаваемого ИИН или телефона');
          return res.status(422).json({ error: 'CLIENT_IDENTIFIER_REQUIRED' });
        }
        await jobs.fail(job.id, error.message || 'IMPORT_SYNC_FAILED');
        return res.status(422).json({ error: 'IMPORT_SYNC_FAILED' });
      }
    }
  );
}

module.exports = { installCrmImportPull, allowedUpload };
