'use strict';

const Datastore = require('nedb-promises');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { enableAutocompaction } = require('./db-maintenance');

const DB_PATH = process.env.CRM_DB_PATH || path.join(__dirname, '..', 'data', 'crm.db');
const BACKUP_DIR = process.env.CRM_BACKUP_DIR || path.join(__dirname, '..', 'data', 'crm-backups');
const MAX_BACKUPS = Math.max(7, Math.min(120, Number.parseInt(process.env.CRM_BACKUP_KEEP_DAYS || '30', 10) || 30));

const db = Datastore.create({
  filename: DB_PATH,
  autoload: true,
});
enableAutocompaction(db);

const STATUS = Object.freeze({
  new: 'Новый',
  contacted: 'Связались',
  agreed: 'Согласился',
  declined: 'Отказался',
  in_work: 'В работе',
  waiting_payment: 'Ждём оплату',
  paid: 'Оплачено',
  done: 'Завершено',
  lost: 'Потерян',
});
const STATUS_KEYS = new Set(Object.keys(STATUS));

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

function amountNumber(value) {
  if (value === '' || value === null || value === undefined) return 0;
  const n = Number(String(value).replace(/\s/g, '').replace(',', '.'));
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n * 100) / 100;
}

function dateOnly(value) {
  const s = cleanText(value, 20);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '';
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
  return {
    name: cleanText(input.name, 160),
    phone,
    phoneNorm: normalizePhone(phone),
    source: cleanText(input.source, 160),
    issue: cleanText(input.issue, 240),
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
    fs.writeFileSync(temp, JSON.stringify({
      generatedAt: new Date().toISOString(),
      count: rows.length,
      clients: rows,
    }, null, 2), { mode: 0o600 });
    fs.renameSync(temp, target);

    const backups = fs.readdirSync(BACKUP_DIR)
      .filter(name => /^\d{4}-\d{2}-\d{2}\.json$/.test(name))
      .sort()
      .reverse();
    for (const old of backups.slice(MAX_BACKUPS)) {
      try { fs.unlinkSync(path.join(BACKUP_DIR, old)); } catch (_) {}
    }
  } catch (_) {
    // Backup is best-effort; CRM writes must not fail because backup failed.
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

async function getClient(id) {
  return db.findOne({ _id: cleanText(id, 80) });
}

async function createClient(input = {}) {
  const client = baseClient(input);
  if (!client.phoneNorm) throw new Error('PHONE_REQUIRED');
  const existing = await db.findOne({ phoneNorm: client.phoneNorm });
  if (existing) return existing;
  const inserted = await db.insert(client);
  queueBackup();
  return inserted;
}

async function upsertByPhone(input = {}, sourceType = 'crm') {
  const phoneNorm = normalizePhone(input.phone);
  if (!phoneNorm) throw new Error('PHONE_REQUIRED');
  let client = await db.findOne({ phoneNorm });
  if (!client) {
    return createClient({ ...input, sourceType });
  }

  const $set = { updatedAt: now() };
  if (!client.name && input.name) $set.name = cleanText(input.name, 160);
  if (!client.source && input.source) $set.source = cleanText(input.source, 160);
  if (!client.issue && input.issue) $set.issue = cleanText(input.issue, 240);
  if (!client.question && input.question) $set.question = cleanText(input.question, 4000);
  if (!client.page && input.page) $set.page = cleanText(input.page, 400);
  if (!client.campaign && input.campaign) $set.campaign = cleanText(input.campaign, 200);

  await db.update({ _id: client._id }, { $set });
  client = await db.findOne({ _id: client._id });
  return client;
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
        issue: client.issue || cleanText(lead.issue, 240),
        question: client.question || cleanText(lead.question, 4000),
        page: client.page || cleanText(lead.page, 400),
        campaign: client.campaign || cleanText(lead.campaign, 200),
      },
    });
    queueBackup();
  }
  return db.findOne({ _id: client._id });
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
    query.$or = [
      { name: rx },
      { phone: rx },
      { issue: rx },
      { work: rx },
      { notes: rx },
      ...(digits ? [{ phoneNorm: new RegExp(escapeRegex(digits)) }] : []),
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
    source: 160,
    issue: 240,
    question: 4000,
    page: 400,
    campaign: 200,
    work: 4000,
    notes: 8000,
  };
  for (const [field, max] of Object.entries(textFields)) {
    if (Object.prototype.hasOwnProperty.call(patch, field)) {
      set[field] = cleanText(patch[field], max);
      if (field === 'phone') {
        const normalized = normalizePhone(set.phone);
        if (!normalized) throw new Error('PHONE_REQUIRED');
        const clash = await db.findOne({ phoneNorm: normalized });
        if (clash && clash._id !== client._id) throw new Error('PHONE_EXISTS');
        set.phoneNorm = normalized;
      }
      if (String(client[field] || '') !== String(set[field] || '')) changed.push(field);
    }
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'status') && STATUS_KEYS.has(patch.status)) {
    set.status = patch.status;
    if (client.status !== patch.status) changed.push('status');
  }

  const modifier = { $set: set };
  if (changed.length) {
    const readable = changed.includes('status')
      ? `Статус: ${STATUS[set.status || client.status]}`
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

async function setStatusByPhone(phone, status, source = 'telegram') {
  const client = await upsertByPhone({ phone }, source);
  return setStatus(client._id, status, source);
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

async function addPromiseByPhone(phone, input = {}, source = 'telegram') {
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
  const nextStatus = paymentStatus === 'paid' && ['new', 'contacted', 'agreed', 'waiting_payment'].includes(client.status)
    ? 'paid'
    : client.status;
  await db.update({ _id: id }, {
    $set: {
      paidAmount: totalPaid,
      paidAt,
      paymentStatus,
      status: nextStatus,
      updatedAt: now(),
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

async function addPaymentByPhone(phone, input = {}, source = 'telegram') {
  const client = await upsertByPhone({ phone }, source);
  return addPayment(client._id, input, source);
}

async function addContract(id, input = {}, source = 'crm') {
  const client = await getClient(id);
  if (!client) return null;
  const contract = {
    id: crypto.randomUUID(),
    title: cleanText(input.title || 'Договор', 300),
    number: cleanText(input.number, 160),
    amount: amountNumber(input.amount),
    date: dateOnly(input.date) || new Date().toISOString().slice(0, 10),
    fileUrl: cleanText(input.fileUrl, 1000),
    source: cleanText(source, 80),
    createdAt: now(),
  };
  await db.update({ _id: id }, {
    $push: {
      contracts: contract,
      timeline: timelineEvent(
        'contract',
        `${contract.title}${contract.number ? ` №${contract.number}` : ''}${contract.amount ? ` — ${contract.amount.toLocaleString('ru-RU')} ₸` : ''}`,
        source
      ),
    },
    $set: { updatedAt: now() },
  });
  queueBackup();
  return { client: await getClient(id), contract };
}

async function addContractByPhone(phone, input = {}, source = 'telegram') {
  const client = await upsertByPhone({ phone, name: input.name }, source);
  return addContract(client._id, input, source);
}

function messageText(input = {}) {
  if (input.text) return cleanText(input.text, 8000);
  if (input.type) return `[${cleanText(input.type, 80)}]`;
  return '[сообщение]';
}

async function recordMessageByPhone(input = {}) {
  const phone = input.phone || input.waId;
  const client = await upsertByPhone({
    phone,
    name: input.name,
    source: input.channel || 'whatsapp',
  }, input.channel || 'whatsapp');

  const messageId = cleanText(input.messageId, 200);
  if (messageId && Array.isArray(client.messages) && client.messages.some(m => m.messageId === messageId)) {
    return client;
  }

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
    },
  });
  queueBackup();
  return getClient(client._id);
}

async function addNoteByPhone(phone, text, source = 'telegram') {
  const client = await upsertByPhone({ phone }, source);
  const note = cleanText(text, 4000);
  await db.update({ _id: client._id }, {
    $set: {
      notes: [client.notes, note].filter(Boolean).join('\n').slice(-8000),
      updatedAt: now(),
    },
    $push: { timeline: timelineEvent('note', note, source) },
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
  normalizePhone,
  createClient,
  upsertByPhone,
  upsertFromLead,
  syncWebsiteLeads,
  findByPhone,
  getClient,
  listClients,
  updateClient,
  setStatus,
  setStatusByPhone,
  addPromise,
  addPromiseByPhone,
  addPayment,
  addPaymentByPhone,
  addContract,
  addContractByPhone,
  recordMessageByPhone,
  addNoteByPhone,
  summary,
  exportAll,
  scheduleBackup,
};
