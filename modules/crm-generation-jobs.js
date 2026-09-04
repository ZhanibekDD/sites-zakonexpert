'use strict';

const Datastore = require('nedb-promises');
const path = require('path');
const crypto = require('crypto');
const { enableAutocompaction } = require('./db-maintenance');

const JOB_DB_PATH = process.env.CRM_JOB_DB_PATH || path.join(__dirname, '..', 'data', 'crm-generation-jobs.db');
const LEASE_MS = Math.max(60_000, Math.min(30 * 60_000, Number(process.env.CRM_JOB_LEASE_MS || 10 * 60_000)));
const KEEP_MS = Math.max(24 * 60 * 60_000, Math.min(90 * 24 * 60 * 60_000, Number(process.env.CRM_JOB_KEEP_MS || 30 * 24 * 60 * 60_000)));

const db = Datastore.create({ filename: JOB_DB_PATH, autoload: true });
enableAutocompaction(db);

const KINDS = Object.freeze({
  CREATE: 'create_contract',
  PARSE: 'parse_contract',
});

function cleanText(value, max = 8000) {
  return String(value ?? '').replace(/\u0000/g, '').trim().slice(0, max);
}

function cleanCreatePayload(input = {}) {
  return {
    clientId: cleanText(input.clientId, 100),
    name: cleanText(input.name, 255),
    iin: String(input.iin || '').replace(/\D/g, '').slice(0, 12),
    phone: cleanText(input.phone, 32),
    address: cleanText(input.address, 512),
    documentNumber: cleanText(input.documentNumber, 64),
    service: cleanText(input.service, 2000),
    serviceDetails: Array.isArray(input.serviceDetails)
      ? input.serviceDetails.map(item => cleanText(item, 1000)).filter(Boolean).slice(0, 50)
      : cleanText(input.serviceDetails, 5000).split(/\r?\n|;/).map(v => v.trim()).filter(Boolean).slice(0, 50),
    amount: Math.max(0, Math.round(Number(input.amount || 0) || 0)),
    paymentType: ['prepayment', 'after_result', 'split', 'already_paid', 'custom'].includes(input.paymentType)
      ? input.paymentType
      : 'prepayment',
    firstPayment: input.firstPayment === '' || input.firstPayment == null ? null : Math.max(0, Math.round(Number(input.firstPayment) || 0)),
    secondPayment: input.secondPayment === '' || input.secondPayment == null ? null : Math.max(0, Math.round(Number(input.secondPayment) || 0)),
    workPeriod: cleanText(input.workPeriod || 'до 30 календарных дней', 500),
    resultDefinition: cleanText(input.resultDefinition, 4000),
  };
}

function cleanImportPayload(input = {}) {
  return {
    filename: path.basename(cleanText(input.filename || 'contract', 240)),
    mimeType: cleanText(input.mimeType, 160),
    sha256: cleanText(input.sha256, 64).toLowerCase(),
    storedFile: cleanText(input.storedFile, 1200),
    requestedClientId: cleanText(input.requestedClientId, 100),
  };
}

function cleanPayload(input = {}, kind = KINDS.CREATE) {
  return kind === KINDS.PARSE ? cleanImportPayload(input) : cleanCreatePayload(input);
}

async function cleanup() {
  const cutoff = Date.now() - KEEP_MS;
  try { await db.remove({ updatedAt: { $lt: cutoff } }, { multi: true }); } catch (_) {}
}

async function createJob(input = {}, createdBy = 'crm', kind = KINDS.CREATE) {
  const now = Date.now();
  const safeKind = kind === KINDS.PARSE ? KINDS.PARSE : KINDS.CREATE;
  const payload = cleanPayload(input, safeKind);
  const job = {
    id: crypto.randomUUID(),
    kind: safeKind,
    status: 'pending',
    payload,
    createdBy: cleanText(createdBy, 120),
    attempts: 0,
    claimedAt: 0,
    leaseUntil: 0,
    completedAt: 0,
    failedAt: 0,
    error: '',
    result: null,
    createdAt: now,
    updatedAt: now,
  };
  await db.insert(job);
  cleanup().catch(() => {});
  return job;
}

async function createImportJob(input = {}, createdBy = 'crm') {
  return createJob(input, createdBy, KINDS.PARSE);
}

async function getJob(id) {
  return db.findOne({ id: cleanText(id, 100) });
}

async function claimNext(workerId = '') {
  const now = Date.now();
  let job = await db.findOne({ status: 'pending' }).sort({ createdAt: 1 });
  if (!job) job = await db.findOne({ status: 'claimed', leaseUntil: { $lt: now } }).sort({ createdAt: 1 });
  if (!job) return null;

  const selector = job.status === 'pending'
    ? { _id: job._id, status: 'pending' }
    : { _id: job._id, status: 'claimed', leaseUntil: { $lt: now } };
  const next = {
    status: 'claimed',
    claimedAt: now,
    leaseUntil: now + LEASE_MS,
    workerId: cleanText(workerId, 180),
    attempts: Number(job.attempts || 0) + 1,
    updatedAt: now,
  };
  const count = await db.update(selector, { $set: next }, {});
  if (!count) return null;
  return getJob(job.id);
}

async function heartbeat(id, workerId = '') {
  const now = Date.now();
  const selector = { id: cleanText(id, 100), status: 'claimed' };
  if (workerId) selector.workerId = cleanText(workerId, 180);
  const count = await db.update(selector, { $set: { leaseUntil: now + LEASE_MS, updatedAt: now } }, {});
  return Boolean(count);
}

async function complete(id, result = {}) {
  const now = Date.now();
  const cleanResult = {
    clientId: cleanText(result.clientId, 100),
    contractId: cleanText(result.contractId, 100),
    number: cleanText(result.number, 120),
    generatorContractId: cleanText(result.generatorContractId, 120),
    filename: cleanText(result.filename, 240),
    imported: Boolean(result.imported),
  };
  const count = await db.update(
    { id: cleanText(id, 100) },
    { $set: { status: 'complete', result: cleanResult, error: '', completedAt: now, leaseUntil: 0, updatedAt: now } },
    {}
  );
  return count ? getJob(id) : null;
}

async function fail(id, error = '') {
  const now = Date.now();
  const count = await db.update(
    { id: cleanText(id, 100) },
    { $set: { status: 'failed', error: cleanText(error || 'GENERATION_FAILED', 1200), failedAt: now, leaseUntil: 0, updatedAt: now } },
    {}
  );
  return count ? getJob(id) : null;
}

async function retry(id) {
  const now = Date.now();
  const count = await db.update(
    { id: cleanText(id, 100), status: 'failed' },
    { $set: { status: 'pending', error: '', failedAt: 0, claimedAt: 0, leaseUntil: 0, updatedAt: now } },
    {}
  );
  return count ? getJob(id) : null;
}

module.exports = {
  KINDS,
  createJob,
  createImportJob,
  getJob,
  claimNext,
  heartbeat,
  complete,
  fail,
  retry,
  cleanPayload,
  cleanCreatePayload,
  cleanImportPayload,
};
