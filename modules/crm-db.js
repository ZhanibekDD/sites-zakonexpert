'use strict';

const Datastore = require('nedb-promises');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { enableAutocompaction } = require('./db-maintenance');

const DB_PATH = process.env.CRM_DB_PATH || path.join(__dirname, '..', 'data', 'crm.db');
const META_DB_PATH = process.env.CRM_META_DB_PATH || path.join(__dirname, '..', 'data', 'crm-meta.db');
const BACKUP_DIR = process.env.CRM_BACKUP_DIR || path.join(__dirname, '..', 'data', 'crm-backups');
const MAX_BACKUPS = Math.max(7, Math.min(120, Number.parseInt(process.env.CRM_BACKUP_KEEP_DAYS || '30', 10) || 30));

const db = Datastore.create({ filename: DB_PATH, autoload: true });
const metaDb = Datastore.create({ filename: META_DB_PATH, autoload: true });
enableAutocompaction(db);
enableAutocompaction(metaDb);

const STATUS = Object.freeze({
  new: 'Новый',
  contacted: 'Связались',
  agreed: 'Согласился',
  contract: 'Договор создан',
  waiting_payment: 'Ждём оплату',
  paid: 'Оплачено',
  in_work: 'В работе',
  done: 'Завершено',
  declined: 'Отказался',
  cancelled: 'Отменено',
  lost: 'Потерян',
});

const PIPELINE_STAGES = Object.freeze([
  'new',
  'contacted',
  'agreed',
  'contract',
  'waiting_payment',
  'paid',
  'in_work',
  'done',
  'declined',
  'cancelled',
  'lost',
]);

const ACTIVE_PIPELINE = Object.freeze([
  'new',
  'contacted',
  'agreed',
  'contract',
  'waiting_payment',
  'paid',
  'in_work',
  'done',
]);

const TERMINAL_STAGES = new Set(['done', 'declined', 'cancelled', 'lost']);
const STATUS_KEYS = new Set(Object.keys(STATUS));

const CONTRACT_STATUS = Object.freeze({
  draft: 'Черновик',
  sent: 'Отправлен',
  signed: 'Подписан',
  waiting_payment: 'Ждём оплату',
  paid: 'Оплачен',
  in_work: 'В работе',
  done: 'Завершён',
  cancelled: 'Не состоялся',
});
const CONTRACT_STATUS_KEYS = new Set(Object.keys(CONTRACT_STATUS));

function cleanText(value, max = 2000) {
  return String(value ?? '').replace(/\u0000/g, '').trim().slice(0, max);
}

function normalizePhone(value) {
  let digits = String(value || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.length === 11 && digits.startsWith('8')) digits = `7${digits.slice(1)}`;
  if (digits.length === 10) digits = `7${digits}`;
  return digits.slice(0, 15);
}

function normalizeIin(value) {
  const digits = String(value || '').replace(/\D/g, '');
  return digits.length <= 12 ? digits : digits.slice(0, 12);
}

function validIin(value) {
  return /^\d{12}$/.test(String(value || ''));
}

function amountNumber(value) {
  if (value === '' || value === null || value === undefined) return 0;
  const n = Number(String(value).replace(/\s/g, '').replace(',', '.'));
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n * 100) / 100;
}

function dateOnly(value) {
  const s = cleanText(value, 20);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
  return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : '';
}

function now() {
  return Date.now();
}

function timelineEvent(type, text, source = 'crm', at = now()) {
  return {
    id: crypto.randomUUID(),
    at,
    type: cleanText(type, 50),
    text: cleanText(text, 4000),
    source: cleanText(source, 80),
  };
}

function isAutoLeadSource(sourceType) {
  return ['website-auto', 'website', 'website-application'].includes(String(sourceType || ''));
}

function authoritativeIdentitySource(sourceType) {
  return ['contract-generator', 'contract-import', 'generator-api'].includes(String(sourceType || ''));
}

function baseClient(input = {}) {
  const ts = now();
  const status = STATUS_KEYS.has(input.status) ? input.status : 'new';
  const phone = cleanText(input.phone, 50);
  const iin = normalizeIin(input.iin);
  const externalRef = cleanText(input.externalClientRef || input.externalClientId, 200);
  return {
    name: cleanText(input.name, 180),
    iin,
    iinNorm: iin,
    birthDate: dateOnly(input.birthDate),
    address: cleanText(input.address, 800),
    documentNumber: cleanText(input.documentNumber, 100),
    email: cleanText(input.email, 200),
    phone,
    phoneNorm: normalizePhone(phone),
    source: cleanText(input.source, 160),
    issue: cleanText(input.issue, 1000),
    question: cleanText(input.question, 5000),
    page: cleanText(input.page, 400),
    campaign: cleanText(input.campaign, 200),
    manager: cleanText(input.manager, 120),
    status,
    work: cleanText(input.work, 5000),
    notes: cleanText(input.notes, 10000),
    nextAction: cleanText(input.nextAction, 1000),
    nextActionDate: dateOnly(input.nextActionDate),
    promiseAmount: amountNumber(input.promiseAmount),
    promiseDate: dateOnly(input.promiseDate),
    promiseNote: cleanText(input.promiseNote, 1000),
    paidAmount: amountNumber(input.paidAmount),
    paidAt: cleanText(input.paidAt, 40),
    paymentStatus: ['unpaid', 'partial', 'paid'].includes(input.paymentStatus) ? input.paymentStatus : 'unpaid',
    contracts: [],
    messages: [],
    timeline: [timelineEvent('created', 'Карточка клиента создана', input.sourceType || 'crm', ts)],
    sourceLeadIds: [],
    externalClientRefs: externalRef ? [externalRef] : [],
    promotedAt: input.promotedAt === 0 ? 0 : (Number(input.promotedAt) || (isAutoLeadSource(input.sourceType) ? 0 : ts)),
    createdAt: ts,
    updatedAt: ts,
    lastContactAt: 0,
  };
}

function activeContracts(client) {
  return (client?.contracts || []).filter(contract =>
    !contract.deletedAt && contract.status !== 'cancelled' && contract.contractStatus !== 'cancelled'
  );
}

function isWebsiteOnly(client) {
  if (!client) return false;
  if (Number(client.promotedAt || 0) > 0) return false;
  const fromLead = Array.isArray(client.sourceLeadIds) && client.sourceLeadIds.length > 0;
  if (!fromLead) return false;
  if (client.status && client.status !== 'new') return false;
  if (cleanText(client.work) || cleanText(client.notes) || cleanText(client.nextAction)) return false;
  if (Number(client.promiseAmount || 0) || Number(client.paidAmount || 0)) return false;
  if (activeContracts(client).length || (client.messages || []).length) return false;
  return true;
}

async function scheduleBackup() {
  try {
    const rows = await db.find({}).sort({ updatedAt: -1 });
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const day = new Date().toISOString().slice(0, 10);
    const target = path.join(BACKUP_DIR, `${day}.json`);
    const temp = `${target}.${process.pid}.tmp`;
    fs.writeFileSync(
      temp,
      JSON.stringify({ generatedAt: new Date().toISOString(), count: rows.length, clients: rows }, null, 2),
      { mode: 0o600 }
    );
    fs.renameSync(temp, target);
    const backups = fs.readdirSync(BACKUP_DIR)
      .filter(name => /^\d{4}-\d{2}-\d{2}\.json$/.test(name))
      .sort()
      .reverse();
    for (const old of backups.slice(MAX_BACKUPS)) {
      try { fs.unlinkSync(path.join(BACKUP_DIR, old)); } catch (_) {}
    }
  } catch (_) {
    // Backups are best effort and must never block a CRM write.
  }
}

let backupTimer = null;
function queueBackup() {
  if (backupTimer) return;
  backupTimer = setTimeout(async () => {
    backupTimer = null;
    await scheduleBackup();
  }, 1000);
  backupTimer.unref?.();
}

async function findByPhone(phone) {
  const phoneNorm = normalizePhone(phone);
  if (!phoneNorm) return null;
  return db.findOne({ phoneNorm });
}

async function findByIin(iin) {
  const iinNorm = normalizeIin(iin);
  if (!validIin(iinNorm)) return null;
  return db.findOne({ iinNorm });
}

async function findByExternalRef(value) {
  const ref = cleanText(value, 200);
  if (!ref) return null;
  return db.findOne({ externalClientRefs: ref });
}

async function findByIdentity(input = {}) {
  const externalRef = input.externalClientRef || input.externalClientId;
  const byExternal = externalRef ? await findByExternalRef(externalRef) : null;
  if (byExternal) return byExternal;
  const byIin = await findByIin(input.iin);
  if (byIin) return byIin;
  return findByPhone(input.phone);
}

async function getClient(id) {
  return db.findOne({ _id: cleanText(id, 80) });
}

function hasIdentity(input = {}) {
  return Boolean(
    normalizePhone(input.phone) ||
    validIin(normalizeIin(input.iin)) ||
    cleanText(input.externalClientRef || input.externalClientId, 200)
  );
}

async function createClient(input = {}) {
  const client = baseClient(input);
  if (!hasIdentity(input)) throw new Error('IDENTITY_REQUIRED');
  const existing = await findByIdentity(input);
  if (existing) return existing;
  const inserted = await db.insert(client);
  queueBackup();
  return inserted;
}

async function upsertByIdentity(input = {}, sourceType = 'crm') {
  if (!hasIdentity(input)) throw new Error('IDENTITY_REQUIRED');
  const phoneNorm = normalizePhone(input.phone);
  const iinNorm = normalizeIin(input.iin);
  const externalRef = cleanText(input.externalClientRef || input.externalClientId, 200);
  let client = await findByIdentity({ ...input, externalClientRef: externalRef });
  if (!client) return createClient({ ...input, externalClientRef: externalRef, sourceType });

  const set = { updatedAt: now() };
  if (!isAutoLeadSource(sourceType) && !client.promotedAt) set.promotedAt = now();
  const authoritative = authoritativeIdentitySource(sourceType);
  const copy = (field, value, max) => {
    const clean = cleanText(value, max);
    if (clean && (!client[field] || authoritative)) set[field] = clean;
  };

  copy('name', input.name, 180);
  copy('address', input.address, 800);
  copy('documentNumber', input.documentNumber, 100);
  copy('email', input.email, 200);
  copy('source', input.source, 160);
  copy('issue', input.issue, 1000);
  copy('question', input.question, 5000);
  copy('page', input.page, 400);
  copy('campaign', input.campaign, 200);
  copy('manager', input.manager, 120);
  if (!client.birthDate && input.birthDate) set.birthDate = dateOnly(input.birthDate);
  if (phoneNorm && (!client.phoneNorm || authoritative)) {
    set.phone = cleanText(input.phone, 50);
    set.phoneNorm = phoneNorm;
  }
  if (validIin(iinNorm) && (!client.iinNorm || authoritative)) {
    set.iin = iinNorm;
    set.iinNorm = iinNorm;
  }

  const modifier = { $set: set };
  if (externalRef && !(client.externalClientRefs || []).includes(externalRef)) {
    modifier.$addToSet = { externalClientRefs: externalRef };
  }
  await db.update({ _id: client._id }, modifier);
  queueBackup();
  return getClient(client._id);
}

async function upsertByPhone(input = {}, sourceType = 'crm') {
  if (!normalizePhone(input.phone)) throw new Error('PHONE_REQUIRED');
  return upsertByIdentity(input, sourceType);
}

async function upsertFromLead(lead = {}, { promote = false } = {}) {
  if (!normalizePhone(lead.phone) && !validIin(normalizeIin(lead.iin))) throw new Error('IDENTITY_REQUIRED');
  const client = await upsertByIdentity(
    { ...lead, iin: lead.iin || '' },
    promote ? 'website-promoted' : 'website-auto'
  );
  const leadId = cleanText(lead._id, 100);
  const linked = leadId && Array.isArray(client.sourceLeadIds) && client.sourceLeadIds.includes(leadId);

  if (leadId && !linked) {
    const set = {
      updatedAt: now(),
      source: client.source || cleanText(lead.source || 'website', 160),
      issue: client.issue || cleanText(lead.issue, 1000),
      question: client.question || cleanText(lead.question, 5000),
      page: client.page || cleanText(lead.page, 400),
      campaign: client.campaign || cleanText(lead.campaign, 200),
    };
    if (promote) set.promotedAt = now();
    await db.update({ _id: client._id }, {
      $addToSet: { sourceLeadIds: leadId },
      $push: {
        timeline: timelineEvent(
          'lead',
          `Заявка с сайта: ${cleanText(lead.issue || 'обращение', 200)}`,
          'website',
          Number(lead.ts) || now()
        ),
      },
      $set: set,
    });
    queueBackup();
  } else if (promote && !client.promotedAt) {
    await db.update({ _id: client._id }, {
      $set: { promotedAt: now(), updatedAt: now() },
      $push: { timeline: timelineEvent('lead-promoted', 'Лид переведён в клиентов', 'crm') },
    });
    queueBackup();
  }
  return getClient(client._id);
}

async function syncWebsiteLeads(leads = []) {
  let linked = 0;
  for (const lead of leads) {
    if (!normalizePhone(lead.phone) && !validIin(normalizeIin(lead.iin))) continue;
    try {
      await upsertFromLead(lead, { promote: false });
      linked += 1;
    } catch (_) {}
  }
  return linked;
}

function escapeRegex(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function listClients({ status = '', q = '', limit = 500, includeLeadOnly = false } = {}) {
  const query = {};
  if (STATUS_KEYS.has(status)) query.status = status;
  const term = cleanText(q, 120);
  if (term) {
    const rx = new RegExp(escapeRegex(term), 'i');
    const digits = normalizePhone(term);
    const iin = normalizeIin(term);
    query.$or = [
      { name: rx },
      { phone: rx },
      { iin: rx },
      { address: rx },
      { issue: rx },
      { work: rx },
      { notes: rx },
      { nextAction: rx },
      ...(digits ? [{ phoneNorm: new RegExp(escapeRegex(digits)) }] : []),
      ...(iin ? [{ iinNorm: new RegExp(escapeRegex(iin)) }] : []),
    ];
  }
  const rows = await db.find(query)
    .sort({ updatedAt: -1 })
    .limit(Math.max(1, Math.min(8000, Number(limit) || 500)));
  return includeLeadOnly ? rows : rows.filter(row => !isWebsiteOnly(row));
}

async function updateClient(id, patch = {}, source = 'crm') {
  const client = await getClient(id);
  if (!client) return null;
  const set = { updatedAt: now(), promotedAt: client.promotedAt || now() };
  const changed = [];
  const textFields = {
    name: 180,
    phone: 50,
    address: 800,
    documentNumber: 100,
    email: 200,
    source: 160,
    issue: 1000,
    question: 5000,
    page: 400,
    campaign: 200,
    manager: 120,
    work: 5000,
    notes: 10000,
    nextAction: 1000,
  };

  let finalPhone = client.phoneNorm || '';
  let finalIin = client.iinNorm || '';
  for (const [field, max] of Object.entries(textFields)) {
    if (!Object.prototype.hasOwnProperty.call(patch, field)) continue;
    set[field] = cleanText(patch[field], max);
    if (field === 'phone') {
      const normalized = normalizePhone(set.phone);
      if (normalized) {
        const clash = await db.findOne({ phoneNorm: normalized });
        if (clash && clash._id !== client._id) throw new Error('PHONE_EXISTS');
      }
      set.phoneNorm = normalized;
      finalPhone = normalized;
    }
    if (String(client[field] || '') !== String(set[field] || '')) changed.push(field);
  }

  if (Object.prototype.hasOwnProperty.call(patch, 'iin')) {
    const iinNorm = normalizeIin(patch.iin);
    if (iinNorm && !validIin(iinNorm)) throw new Error('IIN_INVALID');
    if (iinNorm) {
      const clash = await db.findOne({ iinNorm });
      if (clash && clash._id !== client._id) throw new Error('IIN_EXISTS');
    }
    set.iin = iinNorm;
    set.iinNorm = iinNorm;
    finalIin = iinNorm;
    if (client.iinNorm !== iinNorm) changed.push('iin');
  }

  if (Object.prototype.hasOwnProperty.call(patch, 'birthDate')) set.birthDate = dateOnly(patch.birthDate);
  if (Object.prototype.hasOwnProperty.call(patch, 'nextActionDate')) set.nextActionDate = dateOnly(patch.nextActionDate);
  if (!finalPhone && !validIin(finalIin) && !(client.externalClientRefs || []).length) throw new Error('IDENTITY_REQUIRED');

  if (Object.prototype.hasOwnProperty.call(patch, 'status') && STATUS_KEYS.has(patch.status)) {
    set.status = patch.status;
    if (client.status !== patch.status) changed.push('status');
  }

  const modifier = { $set: set };
  if (changed.length) {
    modifier.$push = {
      timeline: timelineEvent(
        'updated',
        changed.includes('status')
          ? `Статус: ${STATUS[set.status || client.status]}`
          : `Обновлены поля: ${changed.join(', ')}`,
        source
      ),
    };
  }
  await db.update({ _id: client._id }, modifier);
  queueBackup();
  return getClient(client._id);
}

async function setStatus(id, status, source = 'crm') {
  if (!STATUS_KEYS.has(status)) throw new Error('BAD_STATUS');
  return updateClient(id, { status }, source);
}

async function setStatusByPhone(phone, status, source = 'crm') {
  const client = await upsertByPhone({ phone }, source);
  return setStatus(client._id, status, source);
}

function advanceClientStage(current, requested) {
  if (!STATUS_KEYS.has(requested)) return current;
  if (requested === 'cancelled') return 'cancelled';
  if (TERMINAL_STAGES.has(current)) return current;
  const currentRank = ACTIVE_PIPELINE.indexOf(current);
  const requestedRank = ACTIVE_PIPELINE.indexOf(requested);
  if (requestedRank < 0) return current;
  if (currentRank < 0 || requestedRank > currentRank) return requested;
  return current;
}

async function addPromise(id, input = {}, source = 'crm') {
  const client = await getClient(id);
  if (!client) return null;
  const amount = amountNumber(input.amount);
  const date = dateOnly(input.date);
  const note = cleanText(input.note, 1000);
  const text = `Обещание оплаты${amount ? ` ${amount.toLocaleString('ru-RU')} ₸` : ''}${date ? ` до ${date}` : ''}${note ? ` — ${note}` : ''}`;
  await db.update({ _id: id }, {
    $set: {
      promiseAmount: amount,
      promiseDate: date,
      promiseNote: note,
      paymentStatus: client.paymentStatus === 'paid' ? 'paid' : 'unpaid',
      updatedAt: now(),
      promotedAt: client.promotedAt || now(),
    },
    $push: { timeline: timelineEvent('promise', text, source) },
  });
  queueBackup();
  return getClient(id);
}

async function addPromiseByPhone(phone, input = {}, source = 'crm') {
  const client = await upsertByPhone({ phone }, source);
  return addPromise(client._id, input, source);
}

async function addPayment(id, input = {}, source = 'crm') {
  const client = await getClient(id);
  if (!client) return null;
  const amount = amountNumber(input.amount);
  const paidAt = cleanText(input.paidAt, 40) || new Date().toISOString();
  const totalPaid = Math.round((Number(client.paidAmount || 0) + amount) * 100) / 100;
  const promised = Number(client.promiseAmount || 0);
  const paymentStatus = promised > 0 && totalPaid < promised ? 'partial' : 'paid';
  const status = paymentStatus === 'paid' ? advanceClientStage(client.status, 'paid') : client.status;
  await db.update({ _id: id }, {
    $set: {
      paidAmount: totalPaid,
      paidAt,
      paymentStatus,
      status,
      updatedAt: now(),
      promotedAt: client.promotedAt || now(),
    },
    $push: {
      timeline: timelineEvent(
        'payment',
        `Оплата ${amount.toLocaleString('ru-RU')} ₸${paymentStatus === 'partial' ? ' (частичная)' : ''}`,
        source
      ),
    },
  });
  queueBackup();
  return getClient(id);
}

async function addPaymentByPhone(phone, input = {}, source = 'crm') {
  const client = await upsertByPhone({ phone }, source);
  return addPayment(client._id, input, source);
}

let sequenceQueue = Promise.resolve();
async function currentMaxContractNumber() {
  const rows = await db.find({});
  let max = Math.max(0, Number.parseInt(process.env.CRM_CONTRACT_START_NUMBER || '0', 10) - 1 || 0);
  for (const row of rows) {
    for (const contract of row.contracts || []) {
      const match = String(contract.number || '').match(/^\s*(\d{1,9})\s*$/);
      if (match) max = Math.max(max, Number(match[1]));
    }
  }
  return max;
}

async function nextContractNumber() {
  const run = sequenceQueue.then(async () => {
    let meta = await metaDb.findOne({ key: 'contract-sequence' });
    if (!meta) {
      meta = await metaDb.insert({ key: 'contract-sequence', value: await currentMaxContractNumber(), updatedAt: now() });
    }
    const value = Number(meta.value || 0) + 1;
    await metaDb.update({ _id: meta._id }, { $set: { value, updatedAt: now() } });
    return String(value);
  });
  sequenceQueue = run.catch(() => {});
  return run;
}

function mapExternalContractStatus(input = {}) {
  const raw = cleanText(input.status || input.contractStatus, 80).toLowerCase();
  const payment = cleanText(input.paymentStatus, 80).toLowerCase();
  if (raw === 'cancelled' || raw === 'canceled') return 'cancelled';
  if (payment === 'paid' || raw === 'paid') return 'paid';
  if (raw === 'done' || raw === 'completed') return 'done';
  if (raw === 'in_work' || raw === 'in-work') return 'in_work';
  if (raw === 'waiting_payment' || raw === 'waiting-payment') return 'waiting_payment';
  if (raw === 'signed') return 'signed';
  if (raw === 'draft') return 'draft';
  if (raw === 'approved' || raw === 'final' || raw === 'finalized') return 'sent';
  return CONTRACT_STATUS_KEYS.has(raw) ? raw : 'draft';
}

function buildContract(input = {}, source = 'crm') {
  const sourceName = cleanText(source || input.source, 160) || 'crm';
  const status = CONTRACT_STATUS_KEYS.has(input.status)
    ? input.status
    : mapExternalContractStatus(input);
  const serviceSubject = cleanText(input.serviceSubject || input.service || input.issue, 6000);
  return {
    id: cleanText(input.id || crypto.randomUUID(), 100),
    externalId: cleanText(input.externalId || input.externalContractId, 200),
    generatorContractId: cleanText(input.generatorContractId, 100),
    title: cleanText(input.title || 'Договор оказания услуг', 300),
    number: cleanText(input.number, 160),
    amount: amountNumber(input.amount),
    currency: cleanText(input.currency || 'KZT', 12),
    date: dateOnly(input.date) || new Date().toISOString().slice(0, 10),
    city: cleanText(input.city || 'г. Талдыкорган', 120),
    paymentTerms: cleanText(input.paymentTerms, 1500),
    paymentType: cleanText(input.paymentType, 80),
    paymentStatus: cleanText(input.paymentStatus, 80),
    workPeriod: cleanText(input.workPeriod, 500),
    presetKey: cleanText(input.presetKey, 50),
    serviceSubject,
    serviceActions: cleanText(input.serviceActions, 6000),
    serviceDetails: Array.isArray(input.serviceDetails)
      ? input.serviceDetails.map(x => cleanText(x, 1000)).filter(Boolean).slice(0, 50)
      : [],
    resultDefinition: cleanText(input.resultDefinition, 6000),
    fileUrl: cleanText(input.fileUrl, 1000),
    fileKey: cleanText(input.fileKey, 120),
    storedFile: cleanText(input.storedFile, 1200),
    originalFilename: cleanText(input.originalFilename || input.originalName, 300),
    mimeType: cleanText(input.mimeType, 160),
    source: sourceName,
    status,
    contractStatus: cleanText(input.contractStatus, 80),
    signTokenHash: cleanText(input.signTokenHash, 128),
    signedAt: Number(input.signedAt || 0) || 0,
    signedIp: cleanText(input.signedIp, 100),
    signedUserAgent: cleanText(input.signedUserAgent, 500),
    documentHash: cleanText(input.documentHash || input.documentSha256, 128),
    importedHash: cleanText(input.importedHash, 128),
    hasPdf: Boolean(input.hasPdf),
    hasDocx: Boolean(input.hasDocx),
    clientSnapshot: input.clientSnapshot && typeof input.clientSnapshot === 'object' ? input.clientSnapshot : {},
    createdAt: Number(input.createdAt || now()) || now(),
    updatedAt: now(),
    deletedAt: Number(input.deletedAt || 0) || 0,
    deletedReason: cleanText(input.deletedReason, 500),
  };
}

function sameContract(existing, incoming) {
  if (incoming.externalId && existing.externalId === incoming.externalId) return true;
  if (incoming.importedHash && existing.importedHash === incoming.importedHash) return true;
  if (incoming.documentHash && existing.documentHash === incoming.documentHash && incoming.source === existing.source) return true;
  return false;
}

function stageFromContract(contract) {
  if (contract.status === 'cancelled' || contract.contractStatus === 'cancelled') return 'cancelled';
  if (contract.status === 'done') return 'done';
  if (contract.status === 'in_work') return 'in_work';
  if (contract.status === 'paid' || contract.paymentStatus === 'paid') return 'paid';
  if (contract.status === 'waiting_payment') return 'waiting_payment';
  return 'contract';
}

async function addContract(id, input = {}, source = 'crm') {
  const client = await getClient(id);
  if (!client) return null;
  const incoming = buildContract(input, source);
  const contracts = Array.isArray(client.contracts) ? client.contracts.slice() : [];
  const index = contracts.findIndex(item => sameContract(item, incoming));
  let contract;
  let created = index < 0;

  if (created) {
    contract = incoming;
    contracts.push(contract);
  } else {
    const current = contracts[index];
    contract = {
      ...current,
      ...incoming,
      id: current.id,
      createdAt: current.createdAt || incoming.createdAt,
      deletedAt: current.deletedAt || 0,
      deletedReason: current.deletedReason || '',
      updatedAt: now(),
    };
    contracts[index] = contract;
  }

  const requestedStage = stageFromContract(contract);
  const status = requestedStage === 'cancelled'
    ? 'cancelled'
    : advanceClientStage(client.status, requestedStage);
  const label = `${created ? 'Добавлен' : 'Обновлён'} ${contract.title}${contract.number ? ` №${contract.number}` : ''}${contract.amount ? ` — ${contract.amount.toLocaleString('ru-RU')} ₸` : ''}`;

  await db.update({ _id: id }, {
    $set: {
      contracts,
      status,
      updatedAt: now(),
      promotedAt: client.promotedAt || now(),
      issue: client.issue || contract.serviceSubject,
    },
    $push: { timeline: timelineEvent('contract', label, source) },
  });
  queueBackup();
  return { client: await getClient(id), contract, created };
}

async function addContractByIdentity(identity = {}, input = {}, source = 'crm') {
  const client = await upsertByIdentity({
    phone: identity.phone || input.phone,
    iin: identity.iin || input.iin,
    name: identity.name || input.name,
    address: identity.address || input.address,
    birthDate: identity.birthDate || input.birthDate,
    documentNumber: identity.documentNumber || input.documentNumber,
    externalClientRef: identity.externalClientRef || identity.externalClientId || input.externalClientRef,
    source,
  }, source);
  return addContract(client._id, input, source);
}

async function addContractByPhone(phone, input = {}, source = 'crm') {
  return addContractByIdentity({ phone, name: input.name }, input, source);
}

async function upsertContractFromIntegration(payload = {}, source = 'contract-generator') {
  const clientInput = payload.client && typeof payload.client === 'object' ? payload.client : {};
  const externalContractId = cleanText(payload.externalContractId || payload.externalId, 200);
  const sourceName = cleanText(payload.source || source, 160) || source;
  const externalClientRef = cleanText(
    clientInput.externalClientId || clientInput.externalClientRef || payload.externalClientId,
    200
  );

  const client = await upsertByIdentity({
    name: clientInput.name || payload.name,
    iin: clientInput.iin || payload.iin,
    phone: clientInput.phone || payload.phone,
    address: clientInput.address || payload.address,
    documentNumber: clientInput.documentNumber || payload.documentNumber,
    birthDate: clientInput.birthDate || payload.birthDate,
    email: clientInput.email || payload.email,
    externalClientRef,
    source: sourceName,
    issue: payload.service || payload.serviceSubject || payload.issue,
  }, source === 'contract-import' ? 'contract-import' : 'contract-generator');

  return addContract(client._id, {
    ...payload,
    externalId: externalContractId,
    serviceSubject: payload.serviceSubject || payload.service,
    documentHash: payload.documentHash || payload.documentSha256,
    originalFilename: payload.originalFilename || payload.originalName,
  }, sourceName);
}

async function getContract(clientId, contractId, { includeDeleted = false } = {}) {
  const client = await getClient(clientId);
  if (!client) return null;
  const contract = (client.contracts || []).find(item =>
    item.id === contractId && (includeDeleted || !item.deletedAt)
  );
  return contract ? { client, contract } : null;
}

async function findContractById(contractId) {
  const id = cleanText(contractId, 100);
  if (!id) return null;
  const rows = await db.find({});
  for (const client of rows) {
    const contract = (client.contracts || []).find(item => item.id === id);
    if (contract) return { client, contract };
  }
  return null;
}

async function updateContract(clientId, contractId, patch = {}, source = 'crm') {
  const client = await getClient(clientId);
  if (!client) return null;
  const contracts = Array.isArray(client.contracts) ? client.contracts.slice() : [];
  const index = contracts.findIndex(item => item.id === contractId);
  if (index < 0) return null;

  const current = contracts[index];
  const next = { ...current, updatedAt: now() };
  const textFields = [
    'title', 'number', 'city', 'paymentTerms', 'paymentType', 'paymentStatus', 'workPeriod',
    'presetKey', 'serviceSubject', 'serviceActions', 'resultDefinition', 'fileUrl', 'fileKey',
    'storedFile', 'originalFilename', 'mimeType', 'documentHash', 'signTokenHash', 'externalId',
    'generatorContractId', 'contractStatus', 'currency',
  ];
  for (const field of textFields) {
    if (!Object.prototype.hasOwnProperty.call(patch, field)) continue;
    const max = ['serviceSubject', 'serviceActions', 'resultDefinition'].includes(field) ? 6000 : 1500;
    next[field] = cleanText(patch[field], max);
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'amount')) next.amount = amountNumber(patch.amount);
  if (Object.prototype.hasOwnProperty.call(patch, 'date')) next.date = dateOnly(patch.date) || current.date;
  if (Object.prototype.hasOwnProperty.call(patch, 'status') && CONTRACT_STATUS_KEYS.has(patch.status)) next.status = patch.status;
  if (Object.prototype.hasOwnProperty.call(patch, 'signedAt')) next.signedAt = Number(patch.signedAt || 0) || 0;
  if (Object.prototype.hasOwnProperty.call(patch, 'signedIp')) next.signedIp = cleanText(patch.signedIp, 100);
  if (Object.prototype.hasOwnProperty.call(patch, 'signedUserAgent')) next.signedUserAgent = cleanText(patch.signedUserAgent, 500);
  if (Object.prototype.hasOwnProperty.call(patch, 'hasPdf')) next.hasPdf = Boolean(patch.hasPdf);
  if (Object.prototype.hasOwnProperty.call(patch, 'hasDocx')) next.hasDocx = Boolean(patch.hasDocx);
  if (Array.isArray(patch.serviceDetails)) next.serviceDetails = patch.serviceDetails.map(x => cleanText(x, 1000)).filter(Boolean).slice(0, 50);
  if (patch.clientSnapshot && typeof patch.clientSnapshot === 'object') next.clientSnapshot = patch.clientSnapshot;

  contracts[index] = next;
  const requestedStage = stageFromContract(next);
  const clientStatus = requestedStage === 'cancelled'
    ? 'cancelled'
    : advanceClientStage(client.status, requestedStage);
  await db.update({ _id: clientId }, {
    $set: {
      contracts,
      status: clientStatus,
      updatedAt: now(),
      promotedAt: client.promotedAt || now(),
    },
    $push: {
      timeline: timelineEvent(
        'contract-updated',
        `Договор №${next.number || '—'}: ${CONTRACT_STATUS[next.status] || next.status}`,
        source
      ),
    },
  });
  queueBackup();
  return { client: await getClient(clientId), contract: next };
}

async function deleteContract(clientId, contractId, reason = '', source = 'crm') {
  const client = await getClient(clientId);
  if (!client) return null;
  const contracts = Array.isArray(client.contracts) ? client.contracts.slice() : [];
  const index = contracts.findIndex(item => item.id === contractId);
  if (index < 0) return null;
  const contract = {
    ...contracts[index],
    statusBeforeDelete: contracts[index].status,
    deletedAt: now(),
    deletedReason: cleanText(reason || 'Договор не состоялся / работа не началась', 500),
    updatedAt: now(),
  };
  contracts[index] = contract;
  const remaining = contracts.filter(item => !item.deletedAt && item.status !== 'cancelled');
  const status = remaining.length ? client.status : (client.status === 'done' ? 'done' : 'cancelled');
  await db.update({ _id: clientId }, {
    $set: { contracts, status, updatedAt: now() },
    $push: {
      timeline: timelineEvent(
        'contract-deleted',
        `Удалён из активных договор №${contract.number || '—'}: ${contract.deletedReason}`,
        source
      ),
    },
  });
  queueBackup();
  return { client: await getClient(clientId), contract };
}

async function restoreContract(clientId, contractId, source = 'crm') {
  const client = await getClient(clientId);
  if (!client) return null;
  const contracts = Array.isArray(client.contracts) ? client.contracts.slice() : [];
  const index = contracts.findIndex(item => item.id === contractId);
  if (index < 0) return null;
  const contract = {
    ...contracts[index],
    status: CONTRACT_STATUS_KEYS.has(contracts[index].statusBeforeDelete)
      ? contracts[index].statusBeforeDelete
      : contracts[index].status,
    deletedAt: 0,
    deletedReason: '',
    statusBeforeDelete: '',
    updatedAt: now(),
  };
  contracts[index] = contract;
  const requestedStage = stageFromContract(contract);
  const status = client.status === 'cancelled'
    ? requestedStage
    : advanceClientStage(client.status, requestedStage);
  await db.update({ _id: clientId }, {
    $set: { contracts, status, updatedAt: now(), promotedAt: client.promotedAt || now() },
    $push: {
      timeline: timelineEvent('contract-restored', `Восстановлен договор №${contract.number || '—'}`, source),
    },
  });
  queueBackup();
  return { client: await getClient(clientId), contract };
}

async function cancelContract(clientId, contractId, source = 'crm') {
  const client = await getClient(clientId);
  if (!client) return null;
  const contracts = Array.isArray(client.contracts) ? client.contracts.slice() : [];
  const index = contracts.findIndex(item => item.id === contractId);
  if (index < 0) return null;
  const contract = {
    ...contracts[index],
    status: 'cancelled',
    contractStatus: 'cancelled',
    updatedAt: now(),
  };
  contracts[index] = contract;
  await db.update({ _id: clientId }, {
    $set: { contracts, status: 'cancelled', updatedAt: now(), promotedAt: client.promotedAt || now() },
    $push: {
      timeline: timelineEvent(
        'contract-cancelled',
        `Договор${contract.number ? ` №${contract.number}` : ''} отменён`,
        source
      ),
    },
  });
  queueBackup();
  return { client: await getClient(clientId), contract };
}

async function findContractBySignTokenHash(hash) {
  const tokenHash = cleanText(hash, 128);
  if (!tokenHash) return null;
  const client = await db.findOne({ 'contracts.signTokenHash': tokenHash });
  if (!client) return null;
  const contract = (client.contracts || []).find(item =>
    item.signTokenHash === tokenHash && !item.deletedAt && item.status !== 'cancelled'
  );
  return contract ? { client, contract } : null;
}

async function signContractByTokenHash(hash, input = {}) {
  const found = await findContractBySignTokenHash(hash);
  if (!found) return null;
  if (found.contract.signedAt) return found;
  return updateContract(found.client._id, found.contract.id, {
    status: 'signed',
    signedAt: now(),
    signedIp: input.ip,
    signedUserAgent: input.userAgent,
    documentHash: input.documentHash || found.contract.documentHash,
  }, 'client-sign');
}

function messageText(input = {}) {
  if (input.text) return cleanText(input.text, 8000);
  if (input.type) return `[${cleanText(input.type, 80)}]`;
  return '[сообщение]';
}

async function recordMessageByPhone(input = {}) {
  const phone = input.phone || input.waId;
  const client = await upsertByPhone({ phone, name: input.name, source: input.channel || 'whatsapp' }, input.channel || 'whatsapp');
  const messageId = cleanText(input.messageId, 200);
  if (messageId && Array.isArray(client.messages) && client.messages.some(m => m.messageId === messageId)) return client;
  const msg = {
    id: crypto.randomUUID(),
    messageId,
    channel: cleanText(input.channel || 'whatsapp', 40),
    direction: input.direction === 'out' ? 'out' : 'in',
    text: messageText(input),
    at: Number(input.at) || now(),
  };
  await db.update({ _id: client._id }, {
    $push: {
      messages: msg,
      timeline: timelineEvent(
        'message',
        `${msg.direction === 'in' ? 'Входящее' : 'Исходящее'} ${msg.channel}: ${msg.text.slice(0, 300)}`,
        msg.channel,
        msg.at
      ),
    },
    $set: {
      updatedAt: now(),
      lastContactAt: msg.at,
      promotedAt: client.promotedAt || now(),
    },
  });
  queueBackup();
  return getClient(client._id);
}

async function addNoteByPhone(phone, text, source = 'crm') {
  const client = await upsertByPhone({ phone }, source);
  const note = cleanText(text, 4000);
  await db.update({ _id: client._id }, {
    $set: {
      notes: [client.notes, note].filter(Boolean).join('\n').slice(-10000),
      updatedAt: now(),
      promotedAt: client.promotedAt || now(),
    },
    $push: { timeline: timelineEvent('note', note, source) },
  });
  queueBackup();
  return getClient(client._id);
}

async function summary() {
  const all = await db.find({});
  const rows = all.filter(row => !isWebsiteOnly(row));
  const byStatus = Object.fromEntries(Object.keys(STATUS).map(key => [key, 0]));
  let promiseTotal = 0;
  let paidTotal = 0;
  let overduePromises = 0;
  let contractsTotal = 0;
  let contractsWaiting = 0;
  const today = new Date().toISOString().slice(0, 10);

  for (const row of rows) {
    if (Object.prototype.hasOwnProperty.call(byStatus, row.status)) byStatus[row.status] += 1;
    promiseTotal += Number(row.promiseAmount || 0);
    paidTotal += Number(row.paidAmount || 0);
    if (row.promiseDate && row.promiseDate < today && row.paymentStatus !== 'paid') overduePromises += 1;
    for (const contract of activeContracts(row)) {
      contractsTotal += 1;
      if (['draft', 'sent', 'signed', 'waiting_payment'].includes(contract.status)) contractsWaiting += 1;
    }
  }

  return {
    total: rows.length,
    hiddenLeadOnly: all.length - rows.length,
    byStatus,
    promiseTotal: Math.round(promiseTotal * 100) / 100,
    paidTotal: Math.round(paidTotal * 100) / 100,
    overduePromises,
    contractsTotal,
    contractsWaiting,
  };
}

async function exportAll() {
  return db.find({}).sort({ updatedAt: -1 });
}

module.exports = {
  STATUS,
  STATUS_KEYS,
  PIPELINE_STAGES,
  CONTRACT_STATUS,
  CONTRACT_STATUS_KEYS,
  normalizePhone,
  normalizeIin,
  isWebsiteOnly,
  activeContracts,
  createClient,
  upsertByIdentity,
  upsertByPhone,
  upsertFromLead,
  syncWebsiteLeads,
  findByPhone,
  findByIin,
  findByExternalRef,
  findByIdentity,
  getClient,
  listClients,
  updateClient,
  setStatus,
  setStatusByPhone,
  addPromise,
  addPromiseByPhone,
  addPayment,
  addPaymentByPhone,
  nextContractNumber,
  addContract,
  addContractByIdentity,
  addContractByPhone,
  upsertContractFromIntegration,
  getContract,
  findContractById,
  updateContract,
  deleteContract,
  restoreContract,
  cancelContract,
  findContractBySignTokenHash,
  signContractByTokenHash,
  recordMessageByPhone,
  addNoteByPhone,
  summary,
  exportAll,
  scheduleBackup,
};
