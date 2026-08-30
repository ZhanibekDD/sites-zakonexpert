'use strict';

const Datastore = require('nedb-promises');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { enableAutocompaction } = require('./db-maintenance');

const DB_PATH = process.env.CRM_DB_PATH || path.join(__dirname, '..', 'data', 'crm.db');
const BACKUP_DIR = process.env.CRM_BACKUP_DIR || path.join(__dirname, '..', 'data', 'crm-backups');
const MAX_BACKUPS = Math.max(7, Math.min(120, Number.parseInt(process.env.CRM_BACKUP_KEEP_DAYS || '30', 10) || 30));

const db = Datastore.create({ filename: DB_PATH, autoload: true });
enableAutocompaction(db);

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
const STATUS_KEYS = new Set(Object.keys(STATUS));
const TERMINAL_STAGES = new Set(['done', 'declined', 'cancelled', 'lost']);

function cleanText(value, max = 2000) {
  return String(value ?? '').trim().slice(0, max);
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
  return /^\d{12}$/.test(digits) ? digits : '';
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
  const m = s.match(/^(\d{2})[./-](\d{2})[./-](\d{4})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : '';
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

function baseClient(input = {}) {
  const ts = now();
  const status = STATUS_KEYS.has(input.status) ? input.status : 'new';
  const phone = cleanText(input.phone, 50);
  const iin = normalizeIin(input.iin);
  return {
    name: cleanText(input.name, 160),
    iin,
    iinNorm: iin,
    phone,
    phoneNorm: normalizePhone(phone),
    email: cleanText(input.email, 200),
    address: cleanText(input.address, 800),
    documentNumber: cleanText(input.documentNumber, 100),
    source: cleanText(input.source, 160),
    issue: cleanText(input.issue, 500),
    question: cleanText(input.question, 4000),
    page: cleanText(input.page, 400),
    campaign: cleanText(input.campaign, 200),
    status,
    work: cleanText(input.work, 4000),
    notes: cleanText(input.notes, 8000),
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
    externalClientRefs: [],
    createdAt: ts,
    updatedAt: ts,
    lastContactAt: 0,
  };
}

async function scheduleBackup() {
  try {
    const rows = await db.find({}).sort({ updatedAt: -1 });
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const day = new Date().toISOString().slice(0, 10);
    const target = path.join(BACKUP_DIR, `${day}.json`);
    const temp = `${target}.${process.pid}.tmp`;
    fs.writeFileSync(temp, JSON.stringify({ generatedAt: new Date().toISOString(), count: rows.length, clients: rows }, null, 2), { mode: 0o600 });
    fs.renameSync(temp, target);

    const backups = fs.readdirSync(BACKUP_DIR)
      .filter(name => /^\d{4}-\d{2}-\d{2}\.json$/.test(name))
      .sort()
      .reverse();
    for (const old of backups.slice(MAX_BACKUPS)) {
      try { fs.unlinkSync(path.join(BACKUP_DIR, old)); } catch (_) {}
    }
  } catch (_) {
    // A backup failure must never block a CRM write.
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
  if (!iinNorm) return null;
  return db.findOne({ iinNorm });
}

async function findByExternalRef(ref) {
  const externalRef = cleanText(ref, 200);
  if (!externalRef) return null;
  return db.findOne({ externalClientRefs: externalRef });
}

async function getClient(id) {
  return db.findOne({ _id: cleanText(id, 80) });
}

async function createClientInternal(input = {}, { requirePhone = false } = {}) {
  const client = baseClient(input);
  if (requirePhone && !client.phoneNorm) throw new Error('PHONE_REQUIRED');
  if (!client.phoneNorm && !client.iinNorm && !cleanText(input.externalClientRef, 200)) {
    throw new Error('IDENTIFIER_REQUIRED');
  }

  let existing = null;
  if (client.iinNorm) existing = await findByIin(client.iinNorm);
  if (!existing && client.phoneNorm) existing = await findByPhone(client.phoneNorm);
  if (existing) return existing;

  const externalRef = cleanText(input.externalClientRef, 200);
  if (externalRef) client.externalClientRefs.push(externalRef);
  const inserted = await db.insert(client);
  queueBackup();
  return inserted;
}

async function createClient(input = {}) {
  return createClientInternal(input, { requirePhone: true });
}

async function upsertByIdentity(input = {}, sourceType = 'crm') {
  const phoneNorm = normalizePhone(input.phone);
  const iinNorm = normalizeIin(input.iin);
  const externalRef = cleanText(input.externalClientRef || input.externalClientId, 200);

  let client = externalRef ? await findByExternalRef(externalRef) : null;
  if (!client && iinNorm) client = await findByIin(iinNorm);
  if (!client && phoneNorm) client = await findByPhone(phoneNorm);
  if (!client) {
    return createClientInternal({ ...input, iin: iinNorm, externalClientRef: externalRef, sourceType });
  }

  const set = { updatedAt: now() };
  const assignIfUseful = (field, value, max) => {
    const clean = cleanText(value, max);
    if (clean && (!client[field] || sourceType === 'contract-generator' || sourceType === 'contract-import')) set[field] = clean;
  };
  assignIfUseful('name', input.name, 160);
  assignIfUseful('email', input.email, 200);
  assignIfUseful('address', input.address, 800);
  assignIfUseful('documentNumber', input.documentNumber, 100);
  assignIfUseful('source', input.source, 160);
  assignIfUseful('issue', input.issue, 500);
  assignIfUseful('question', input.question, 4000);
  assignIfUseful('page', input.page, 400);
  assignIfUseful('campaign', input.campaign, 200);

  if (iinNorm) {
    set.iin = iinNorm;
    set.iinNorm = iinNorm;
  }
  if (phoneNorm) {
    set.phone = cleanText(input.phone, 50);
    set.phoneNorm = phoneNorm;
  }

  const modifier = { $set: set };
  if (externalRef && !(client.externalClientRefs || []).includes(externalRef)) {
    modifier.$addToSet = { externalClientRefs: externalRef };
  }
  await db.update({ _id: client._id }, modifier);
  return getClient(client._id);
}

async function upsertByPhone(input = {}, sourceType = 'crm') {
  if (!normalizePhone(input.phone)) throw new Error('PHONE_REQUIRED');
  return upsertByIdentity(input, sourceType);
}

async function upsertFromLead(lead = {}) {
  const client = await upsertByPhone(lead, 'website');
  const leadId = cleanText(lead._id, 100);
  const alreadyLinked = leadId && Array.isArray(client.sourceLeadIds) && client.sourceLeadIds.includes(leadId);
  if (leadId && !alreadyLinked) {
    await db.update({ _id: client._id }, {
      $addToSet: { sourceLeadIds: leadId },
      $push: { timeline: timelineEvent('lead', `Заявка с сайта: ${cleanText(lead.issue || 'обращение', 200)}`, 'website', Number(lead.ts) || now()) },
      $set: {
        updatedAt: now(),
        source: client.source || cleanText(lead.source || 'website', 160),
        issue: client.issue || cleanText(lead.issue, 500),
        question: client.question || cleanText(lead.question, 4000),
        page: client.page || cleanText(lead.page, 400),
        campaign: client.campaign || cleanText(lead.campaign, 200),
      },
    });
    queueBackup();
  }
  return getClient(client._id);
}

async function syncWebsiteLeads(leads = []) {
  let createdOrLinked = 0;
  for (const lead of leads) {
    if (!normalizePhone(lead.phone)) continue;
    try {
      const before = await findByPhone(lead.phone);
      const linkedBefore = before && lead._id && Array.isArray(before.sourceLeadIds) && before.sourceLeadIds.includes(lead._id);
      await upsertFromLead(lead);
      if (!before || !linkedBefore) createdOrLinked += 1;
    } catch (_) {}
  }
  return createdOrLinked;
}

function escapeRegex(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function listClients({ status = '', q = '', limit = 500 } = {}) {
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
      ...(digits ? [{ phoneNorm: new RegExp(escapeRegex(digits)) }] : []),
      ...(iin ? [{ iinNorm: iin }] : []),
    ];
  }
  return db.find(query).sort({ updatedAt: -1 }).limit(Math.max(1, Math.min(5000, Number(limit) || 500)));
}

async function updateClient(id, patch = {}, source = 'crm') {
  const client = await getClient(id);
  if (!client) return null;

  const set = { updatedAt: now() };
  const changed = [];
  const textFields = {
    name: 160,
    phone: 50,
    email: 200,
    address: 800,
    documentNumber: 100,
    source: 160,
    issue: 500,
    question: 4000,
    page: 400,
    campaign: 200,
    work: 4000,
    notes: 8000,
  };
  for (const [field, max] of Object.entries(textFields)) {
    if (!Object.prototype.hasOwnProperty.call(patch, field)) continue;
    set[field] = cleanText(patch[field], max);
    if (field === 'phone') {
      const normalized = normalizePhone(set.phone);
      if (set.phone && !normalized) throw new Error('PHONE_INVALID');
      if (normalized) {
        const clash = await db.findOne({ phoneNorm: normalized });
        if (clash && clash._id !== client._id) throw new Error('PHONE_EXISTS');
      }
      set.phoneNorm = normalized;
    }
    if (String(client[field] || '') !== String(set[field] || '')) changed.push(field);
  }

  if (Object.prototype.hasOwnProperty.call(patch, 'iin')) {
    const normalized = normalizeIin(patch.iin);
    if (patch.iin && !normalized) throw new Error('IIN_INVALID');
    if (normalized) {
      const clash = await db.findOne({ iinNorm: normalized });
      if (clash && clash._id !== client._id) throw new Error('IIN_EXISTS');
    }
    set.iin = normalized;
    set.iinNorm = normalized;
    if (client.iin !== normalized) changed.push('iin');
  }

  if (Object.prototype.hasOwnProperty.call(patch, 'status') && STATUS_KEYS.has(patch.status)) {
    set.status = patch.status;
    if (client.status !== patch.status) changed.push('status');
  }

  const modifier = { $set: set };
  if (changed.length) {
    const readable = changed.includes('status')
      ? `Стадия: ${STATUS[set.status || client.status]}`
      : `Обновлены поля: ${changed.join(', ')}`;
    modifier.$push = { timeline: timelineEvent('updated', readable, source) };
  }
  await db.update({ _id: client._id }, modifier);
  queueBackup();
  return getClient(client._id);
}

async function setStatus(id, status, source = 'crm') {
  if (!STATUS_KEYS.has(status)) throw new Error('BAD_STATUS');
  return updateClient(id, { status }, source);
}

function stageRank(status) {
  return PIPELINE_STAGES.indexOf(status);
}

function nextStage(current, requested) {
  if (!STATUS_KEYS.has(requested)) return current;
  if (TERMINAL_STAGES.has(current)) return current;
  const currentRank = stageRank(current);
  const requestedRank = stageRank(requested);
  if (requested === 'cancelled') return 'cancelled';
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
    },
    $push: { timeline: timelineEvent('promise', text, source) },
  });
  queueBackup();
  return getClient(id);
}

async function addPayment(id, input = {}, source = 'crm') {
  const client = await getClient(id);
  if (!client) return null;
  const amount = amountNumber(input.amount);
  const paidAt = cleanText(input.paidAt, 40) || new Date().toISOString();
  const totalPaid = Math.round((Number(client.paidAmount || 0) + amount) * 100) / 100;
  const promised = Number(client.promiseAmount || 0);
  const paymentStatus = promised > 0 && totalPaid < promised ? 'partial' : 'paid';
  const status = paymentStatus === 'paid' ? nextStage(client.status, 'paid') : client.status;
  await db.update({ _id: id }, {
    $set: { paidAmount: totalPaid, paidAt, paymentStatus, status, updatedAt: now() },
    $push: { timeline: timelineEvent('payment', `Оплата ${amount.toLocaleString('ru-RU')} ₸${paymentStatus === 'partial' ? ' (частичная)' : ''}`, source) },
  });
  queueBackup();
  return getClient(id);
}

function normalizeContract(input = {}, source = 'crm') {
  return {
    id: cleanText(input.id, 100) || crypto.randomUUID(),
    externalId: cleanText(input.externalId || input.externalContractId, 200),
    generatorContractId: cleanText(input.generatorContractId, 100),
    title: cleanText(input.title || 'Договор', 300),
    number: cleanText(input.number, 160),
    amount: amountNumber(input.amount),
    currency: cleanText(input.currency || 'KZT', 12),
    date: dateOnly(input.date) || new Date().toISOString().slice(0, 10),
    service: cleanText(input.service || input.issue, 4000),
    serviceDetails: Array.isArray(input.serviceDetails) ? input.serviceDetails.map(x => cleanText(x, 1000)).filter(Boolean).slice(0, 50) : [],
    paymentType: cleanText(input.paymentType, 80),
    paymentStatus: cleanText(input.paymentStatus, 80),
    contractStatus: cleanText(input.contractStatus || input.status, 80),
    documentSha256: cleanText(input.documentSha256, 128),
    hasPdf: Boolean(input.hasPdf),
    hasDocx: Boolean(input.hasDocx),
    fileUrl: cleanText(input.fileUrl, 1000),
    storedFile: cleanText(input.storedFile, 1200),
    originalName: cleanText(input.originalName, 240),
    mimeType: cleanText(input.mimeType, 160),
    source: cleanText(source, 80),
    createdAt: Number(input.createdAt) || now(),
    updatedAt: now(),
  };
}

function sameContract(existing, incoming) {
  if (incoming.externalId && existing.externalId === incoming.externalId) return true;
  if (incoming.documentSha256 && existing.documentSha256 === incoming.documentSha256) return true;
  return Boolean(incoming.number && existing.number === incoming.number && existing.source === incoming.source);
}

async function addContract(id, input = {}, source = 'crm') {
  const client = await getClient(id);
  if (!client) return null;
  const contract = normalizeContract(input, source);
  const contracts = Array.isArray(client.contracts) ? [...client.contracts] : [];
  const index = contracts.findIndex(item => sameContract(item, contract));
  const isNew = index < 0;
  if (isNew) {
    contracts.push(contract);
  } else {
    const old = contracts[index];
    contracts[index] = {
      ...old,
      ...Object.fromEntries(Object.entries(contract).filter(([, value]) => value !== '' && value !== 0 && value !== false)),
      id: old.id,
      createdAt: old.createdAt,
      updatedAt: now(),
    };
  }

  let status = client.status;
  if (contract.contractStatus === 'cancelled' || contract.contractStatus === 'canceled') status = 'cancelled';
  else if (contract.paymentStatus === 'paid') status = nextStage(status, 'paid');
  else status = nextStage(status, 'contract');

  const text = `${isNew ? 'Добавлен' : 'Обновлён'} ${contract.title}${contract.number ? ` №${contract.number}` : ''}${contract.amount ? ` — ${contract.amount.toLocaleString('ru-RU')} ₸` : ''}`;
  await db.update({ _id: id }, {
    $set: { contracts, status, updatedAt: now(), issue: client.issue || contract.service },
    $push: { timeline: timelineEvent('contract', text, source) },
  });
  queueBackup();
  return { client: await getClient(id), contract: contracts[isNew ? contracts.length - 1 : index], created: isNew };
}

async function upsertContractFromIntegration(payload = {}, source = 'contract-generator') {
  const clientInput = payload.client || {};
  const externalContractId = cleanText(payload.externalContractId, 200);
  const sourceName = cleanText(payload.source || source, 160) || source;
  const fallbackExternalClientRef = cleanText(clientInput.externalClientId, 200) || (externalContractId ? `contract:${externalContractId}` : '');

  const client = await upsertByIdentity({
    name: clientInput.name || payload.name,
    iin: clientInput.iin || payload.iin,
    phone: clientInput.phone || payload.phone,
    email: clientInput.email || payload.email,
    address: clientInput.address || payload.address,
    documentNumber: clientInput.documentNumber || payload.documentNumber,
    externalClientRef: fallbackExternalClientRef,
    source: sourceName,
    issue: payload.service || payload.issue,
  }, source === 'contract-import' ? 'contract-import' : 'contract-generator');

  return addContract(client._id, {
    externalContractId,
    generatorContractId: payload.generatorContractId,
    title: payload.title || 'Договор оказания услуг',
    number: payload.number,
    amount: payload.amount,
    currency: payload.currency,
    date: payload.date,
    service: payload.service,
    serviceDetails: payload.serviceDetails,
    paymentType: payload.paymentType,
    paymentStatus: payload.paymentStatus,
    contractStatus: payload.contractStatus,
    documentSha256: payload.documentSha256,
    hasPdf: payload.hasPdf,
    hasDocx: payload.hasDocx,
    fileUrl: payload.fileUrl,
    storedFile: payload.storedFile,
    originalName: payload.originalName,
    mimeType: payload.mimeType,
  }, sourceName);
}

async function cancelContract(clientId, contractId, source = 'crm') {
  const client = await getClient(clientId);
  if (!client) return null;
  const contracts = Array.isArray(client.contracts) ? [...client.contracts] : [];
  const index = contracts.findIndex(item => item.id === contractId);
  if (index < 0) return null;
  contracts[index] = { ...contracts[index], contractStatus: 'cancelled', updatedAt: now() };
  await db.update({ _id: clientId }, {
    $set: { contracts, status: 'cancelled', updatedAt: now() },
    $push: { timeline: timelineEvent('contract_cancelled', `Договор${contracts[index].number ? ` №${contracts[index].number}` : ''} отменён`, source) },
  });
  queueBackup();
  return { client: await getClient(clientId), contract: contracts[index] };
}

async function findContractById(contractId) {
  const id = cleanText(contractId, 100);
  if (!id) return null;
  const clients = await db.find({});
  for (const client of clients) {
    const contract = (client.contracts || []).find(item => item.id === id);
    if (contract) return { client, contract };
  }
  return null;
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
      timeline: timelineEvent('message', `${msg.direction === 'in' ? 'Входящее' : 'Исходящее'} ${msg.channel}: ${msg.text.slice(0, 300)}`, msg.channel, msg.at),
    },
    $set: { updatedAt: now(), lastContactAt: msg.at },
  });
  queueBackup();
  return getClient(client._id);
}

async function summary() {
  const rows = await db.find({});
  const byStatus = Object.fromEntries(Object.keys(STATUS).map(key => [key, 0]));
  let promiseTotal = 0;
  let paidTotal = 0;
  let overduePromises = 0;
  const today = new Date().toISOString().slice(0, 10);

  for (const row of rows) {
    if (Object.prototype.hasOwnProperty.call(byStatus, row.status)) byStatus[row.status] += 1;
    promiseTotal += Number(row.promiseAmount || 0);
    paidTotal += Number(row.paidAmount || 0);
    if (row.promiseDate && row.promiseDate < today && row.paymentStatus !== 'paid') overduePromises += 1;
  }

  return {
    total: rows.length,
    byStatus,
    promiseTotal: Math.round(promiseTotal * 100) / 100,
    paidTotal: Math.round(paidTotal * 100) / 100,
    overduePromises,
  };
}

async function exportAll() {
  return db.find({}).sort({ updatedAt: -1 });
}

module.exports = {
  STATUS,
  STATUS_KEYS,
  PIPELINE_STAGES,
  normalizePhone,
  normalizeIin,
  createClient,
  upsertByIdentity,
  upsertByPhone,
  upsertFromLead,
  syncWebsiteLeads,
  findByPhone,
  findByIin,
  getClient,
  listClients,
  updateClient,
  setStatus,
  addPromise,
  addPayment,
  addContract,
  upsertContractFromIntegration,
  cancelContract,
  findContractById,
  recordMessageByPhone,
  summary,
  exportAll,
  scheduleBackup,
};
