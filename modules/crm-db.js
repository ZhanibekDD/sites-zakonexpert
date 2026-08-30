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

const STATUS = Object.freeze({ new: 'Новый', contacted: 'Связались', agreed: 'Согласился', declined: 'Отказался', in_work: 'В работе', waiting_payment: 'Ждём оплату', paid: 'Оплачено', done: 'Завершено', lost: 'Потерян' });
const STATUS_KEYS = new Set(Object.keys(STATUS));
const CONTRACT_STATUS = Object.freeze({ draft: 'Черновик', sent: 'Отправлен', signed: 'Подписан', waiting_payment: 'Ждём оплату', paid: 'Оплачен', in_work: 'В работе', done: 'Завершён', cancelled: 'Не состоялся' });
const CONTRACT_STATUS_KEYS = new Set(Object.keys(CONTRACT_STATUS));

function cleanText(value, max = 2000) { return String(value ?? '').replace(/\u0000/g, '').trim().slice(0, max); }
function normalizePhone(value) { let digits = String(value || '').replace(/\D/g, ''); if (!digits) return ''; if (digits.length === 11 && digits.startsWith('8')) digits = `7${digits.slice(1)}`; if (digits.length === 10) digits = `7${digits}`; return digits.slice(0, 15); }
function normalizeIin(value) { return String(value || '').replace(/\D/g, '').slice(0, 12); }
function amountNumber(value) { if (value === '' || value === null || value === undefined) return 0; const n = Number(String(value).replace(/\s/g, '').replace(',', '.')); if (!Number.isFinite(n) || n < 0) return 0; return Math.round(n * 100) / 100; }
function dateOnly(value) { const s = cleanText(value, 20); return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : ''; }
function now() { return Date.now(); }
function timelineEvent(type, text, source = 'crm', at = now()) { return { id: crypto.randomUUID(), at, type: cleanText(type, 50), text: cleanText(text, 4000), source: cleanText(source, 80) }; }
function isAutoLeadSource(sourceType) { return ['website-auto', 'website', 'website-application'].includes(String(sourceType || '')); }

function baseClient(input = {}) {
  const ts = now();
  const status = STATUS_KEYS.has(input.status) ? input.status : 'new';
  const phone = cleanText(input.phone, 50);
  const iin = normalizeIin(input.iin);
  return {
    name: cleanText(input.name, 180), iin, iinNorm: iin, birthDate: dateOnly(input.birthDate), address: cleanText(input.address, 500), phone, phoneNorm: normalizePhone(phone),
    source: cleanText(input.source, 160), issue: cleanText(input.issue, 500), question: cleanText(input.question, 5000), page: cleanText(input.page, 400), campaign: cleanText(input.campaign, 200), manager: cleanText(input.manager, 120), status,
    work: cleanText(input.work, 5000), notes: cleanText(input.notes, 10000), nextAction: cleanText(input.nextAction, 1000), nextActionDate: dateOnly(input.nextActionDate),
    promiseAmount: amountNumber(input.promiseAmount), promiseDate: dateOnly(input.promiseDate), promiseNote: cleanText(input.promiseNote, 1000), paidAmount: amountNumber(input.paidAmount), paidAt: cleanText(input.paidAt, 40), paymentStatus: ['unpaid', 'partial', 'paid'].includes(input.paymentStatus) ? input.paymentStatus : 'unpaid',
    contracts: [], messages: [], timeline: [timelineEvent('created', 'Карточка клиента создана', input.sourceType || 'crm', ts)], sourceLeadIds: [], promotedAt: input.promotedAt === 0 ? 0 : (Number(input.promotedAt) || (isAutoLeadSource(input.sourceType) ? 0 : ts)), createdAt: ts, updatedAt: ts, lastContactAt: 0,
  };
}

function activeContracts(client) { return (client.contracts || []).filter(contract => !contract.deletedAt); }
function isWebsiteOnly(client) { if (!client) return false; if (Number(client.promotedAt || 0) > 0) return false; const fromLead = Array.isArray(client.sourceLeadIds) && client.sourceLeadIds.length > 0; if (!fromLead) return false; if (client.status && client.status !== 'new') return false; if (cleanText(client.work) || cleanText(client.notes) || cleanText(client.nextAction)) return false; if (Number(client.promiseAmount || 0) || Number(client.paidAmount || 0)) return false; if (activeContracts(client).length || (client.messages || []).length) return false; return true; }

async function scheduleBackup() {
  try {
    const rows = await db.find({}).sort({ updatedAt: -1 });
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const day = new Date().toISOString().slice(0, 10);
    const target = path.join(BACKUP_DIR, `${day}.json`);
    const temp = `${target}.${process.pid}.tmp`;
    fs.writeFileSync(temp, JSON.stringify({ generatedAt: new Date().toISOString(), count: rows.length, clients: rows }, null, 2), { mode: 0o600 });
    fs.renameSync(temp, target);
    const backups = fs.readdirSync(BACKUP_DIR).filter(name => /^\d{4}-\d{2}-\d{2}\.json$/.test(name)).sort().reverse();
    for (const old of backups.slice(MAX_BACKUPS)) { try { fs.unlinkSync(path.join(BACKUP_DIR, old)); } catch (_) {} }
  } catch (_) {}
}
let backupTimer = null;
function queueBackup() { if (backupTimer) return; backupTimer = setTimeout(async () => { backupTimer = null; await scheduleBackup(); }, 1000); backupTimer.unref?.(); }

async function findByPhone(phone) { const phoneNorm = normalizePhone(phone); if (!phoneNorm) return null; return db.findOne({ phoneNorm }); }
async function findByIin(iin) { const iinNorm = normalizeIin(iin); if (!iinNorm) return null; return db.findOne({ iinNorm }); }
async function findByIdentity(input = {}) { const byPhone = await findByPhone(input.phone); if (byPhone) return byPhone; return findByIin(input.iin); }
async function getClient(id) { return db.findOne({ _id: cleanText(id, 80) }); }

async function createClient(input = {}) { const client = baseClient(input); if (!client.phoneNorm && !client.iinNorm) throw new Error('IDENTITY_REQUIRED'); const existing = await findByIdentity(client); if (existing) return existing; const inserted = await db.insert(client); queueBackup(); return inserted; }

async function upsertByIdentity(input = {}, sourceType = 'crm') {
  const phoneNorm = normalizePhone(input.phone); const iinNorm = normalizeIin(input.iin); if (!phoneNorm && !iinNorm) throw new Error('IDENTITY_REQUIRED');
  let client = await findByIdentity({ phone: input.phone, iin: input.iin }); if (!client) return createClient({ ...input, sourceType });
  const $set = { updatedAt: now() };
  if (!client.name && input.name) $set.name = cleanText(input.name, 180); if (!client.phoneNorm && phoneNorm) { $set.phone = cleanText(input.phone, 50); $set.phoneNorm = phoneNorm; } if (!client.iinNorm && iinNorm) { $set.iin = iinNorm; $set.iinNorm = iinNorm; }
  if (!client.birthDate && input.birthDate) $set.birthDate = dateOnly(input.birthDate); if (!client.address && input.address) $set.address = cleanText(input.address, 500); if (!client.source && input.source) $set.source = cleanText(input.source, 160); if (!client.issue && input.issue) $set.issue = cleanText(input.issue, 500); if (!client.question && input.question) $set.question = cleanText(input.question, 5000); if (!client.page && input.page) $set.page = cleanText(input.page, 400); if (!client.campaign && input.campaign) $set.campaign = cleanText(input.campaign, 200); if (!isAutoLeadSource(sourceType) && !client.promotedAt) $set.promotedAt = now();
  await db.update({ _id: client._id }, { $set }); return db.findOne({ _id: client._id });
}
async function upsertByPhone(input = {}, sourceType = 'crm') { if (!normalizePhone(input.phone)) throw new Error('PHONE_REQUIRED'); return upsertByIdentity(input, sourceType); }

async function upsertFromLead(lead = {}, { promote = false } = {}) {
  const client = await upsertByIdentity({ ...lead, iin: lead.iin || '' }, promote ? 'website-promoted' : 'website-auto'); const leadId = cleanText(lead._id, 100); const linked = leadId && Array.isArray(client.sourceLeadIds) && client.sourceLeadIds.includes(leadId);
  if (leadId && !linked) {
    const set = { updatedAt: now(), source: client.source || cleanText(lead.source || 'website', 160), issue: client.issue || cleanText(lead.issue, 500), question: client.question || cleanText(lead.question, 5000), page: client.page || cleanText(lead.page, 400), campaign: client.campaign || cleanText(lead.campaign, 200) }; if (promote) set.promotedAt = now();
    await db.update({ _id: client._id }, { $addToSet: { sourceLeadIds: leadId }, $push: { timeline: timelineEvent('lead', `Заявка с сайта: ${cleanText(lead.issue || 'обращение', 200)}`, 'website', Number(lead.ts) || now()) }, $set: set }); queueBackup();
  } else if (promote && !client.promotedAt) { await db.update({ _id: client._id }, { $set: { promotedAt: now(), updatedAt: now() }, $push: { timeline: timelineEvent('lead-promoted', 'Лид переведён в клиентов', 'crm') } }); queueBackup(); }
  return db.findOne({ _id: client._id });
}
async function syncWebsiteLeads(leads = []) { let linked = 0; for (const lead of leads) { if (!normalizePhone(lead.phone) && !normalizeIin(lead.iin)) continue; try { await upsertFromLead(lead, { promote: false }); linked += 1; } catch (_) {} } return linked; }

function escapeRegex(value) { return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
async function listClients({ status = '', q = '', limit = 500, includeLeadOnly = false } = {}) {
  const query = {}; if (STATUS_KEYS.has(status)) query.status = status; const term = cleanText(q, 120);
  if (term) { const rx = new RegExp(escapeRegex(term), 'i'); const digits = normalizePhone(term); const iin = normalizeIin(term); query.$or = [{ name: rx }, { phone: rx }, { iin: rx }, { address: rx }, { issue: rx }, { work: rx }, { notes: rx }, { nextAction: rx }, ...(digits ? [{ phoneNorm: new RegExp(escapeRegex(digits)) }] : []), ...(iin ? [{ iinNorm: new RegExp(escapeRegex(iin)) }] : [])]; }
  const rows = await db.find(query).sort({ updatedAt: -1 }).limit(Math.max(1, Math.min(8000, Number(limit) || 500))); return includeLeadOnly ? rows : rows.filter(row => !isWebsiteOnly(row));
}

async function updateClient(id, patch = {}, source = 'crm') {
  const client = await getClient(id); if (!client) return null; const set = { updatedAt: now(), promotedAt: client.promotedAt || now() }; const changed = [];
  const textFields = { name: 180, phone: 50, address: 500, source: 160, issue: 500, question: 5000, page: 400, campaign: 200, manager: 120, work: 5000, notes: 10000, nextAction: 1000 };
  for (const [field, max] of Object.entries(textFields)) { if (!Object.prototype.hasOwnProperty.call(patch, field)) continue; set[field] = cleanText(patch[field], max); if (field === 'phone') { const normalized = normalizePhone(set.phone); if (normalized) { const clash = await db.findOne({ phoneNorm: normalized }); if (clash && clash._id !== client._id) throw new Error('PHONE_EXISTS'); } set.phoneNorm = normalized; } if (String(client[field] || '') !== String(set[field] || '')) changed.push(field); }
  if (Object.prototype.hasOwnProperty.call(patch, 'iin')) { const iinNorm = normalizeIin(patch.iin); if (iinNorm) { const clash = await db.findOne({ iinNorm }); if (clash && clash._id !== client._id) throw new Error('IIN_EXISTS'); } set.iin = iinNorm; set.iinNorm = iinNorm; if (client.iinNorm !== iinNorm) changed.push('iin'); }
  if (Object.prototype.hasOwnProperty.call(patch, 'birthDate')) set.birthDate = dateOnly(patch.birthDate); if (Object.prototype.hasOwnProperty.call(patch, 'nextActionDate')) set.nextActionDate = dateOnly(patch.nextActionDate);
  if (!set.phoneNorm && !set.iinNorm && !client.phoneNorm && !client.iinNorm) throw new Error('IDENTITY_REQUIRED'); if (Object.prototype.hasOwnProperty.call(patch, 'status') && STATUS_KEYS.has(patch.status)) { set.status = patch.status; if (client.status !== patch.status) changed.push('status'); }
  const modifier = { $set: set }; if (changed.length) modifier.$push = { timeline: timelineEvent('updated', changed.includes('status') ? `Статус: ${STATUS[set.status || client.status]}` : `Обновлены поля: ${changed.join(', ')}`, source) };
  await db.update({ _id: client._id }, modifier); queueBackup(); return getClient(client._id);
}
async function setStatus(id, status, source = 'crm') { if (!STATUS_KEYS.has(status)) throw new Error('BAD_STATUS'); return updateClient(id, { status }, source); }
async function setStatusByPhone(phone, status, source = 'telegram') { const client = await upsertByPhone({ phone }, source); return setStatus(client._id, status, source); }

async function addPromise(id, input = {}, source = 'crm') { const client = await getClient(id); if (!client) return null; const amount = amountNumber(input.amount); const date = dateOnly(input.date); const note = cleanText(input.note, 1000); const text = `Обещание оплаты${amount ? ` ${amount.toLocaleString('ru-RU')} ₸` : ''}${date ? ` до ${date}` : ''}${note ? ` — ${note}` : ''}`; await db.update({ _id: id }, { $set: { promiseAmount: amount, promiseDate: date, promiseNote: note, paymentStatus: client.paymentStatus === 'paid' ? 'paid' : 'unpaid', updatedAt: now(), promotedAt: client.promotedAt || now() }, $push: { timeline: timelineEvent('promise', text, source) } }); queueBackup(); return getClient(id); }
async function addPromiseByPhone(phone, input = {}, source = 'telegram') { const client = await upsertByPhone({ phone }, source); return addPromise(client._id, input, source); }
async function addPayment(id, input = {}, source = 'crm') { const client = await getClient(id); if (!client) return null; const amount = amountNumber(input.amount); const paidAt = cleanText(input.paidAt, 40) || new Date().toISOString(); const totalPaid = Math.round((Number(client.paidAmount || 0) + amount) * 100) / 100; const promised = Number(client.promiseAmount || 0); const paymentStatus = promised > 0 && totalPaid < promised ? 'partial' : 'paid'; const nextStatus = paymentStatus === 'paid' && ['new', 'contacted', 'agreed', 'waiting_payment'].includes(client.status) ? 'paid' : client.status; await db.update({ _id: id }, { $set: { paidAmount: totalPaid, paidAt, paymentStatus, status: nextStatus, updatedAt: now(), promotedAt: client.promotedAt || now() }, $push: { timeline: timelineEvent('payment', `Оплата ${amount.toLocaleString('ru-RU')} ₸${paymentStatus === 'partial' ? ' (частичная)' : ''}`, source) } }); queueBackup(); return getClient(id); }
async function addPaymentByPhone(phone, input = {}, source = 'telegram') { const client = await upsertByPhone({ phone }, source); return addPayment(client._id, input, source); }

let sequenceQueue = Promise.resolve();
async function currentMaxContractNumber() { const rows = await db.find({}); let max = Math.max(0, Number.parseInt(process.env.CRM_CONTRACT_START_NUMBER || '0', 10) - 1 || 0); for (const row of rows) for (const contract of row.contracts || []) { const match = String(contract.number || '').match(/^\s*(\d{1,9})\s*$/); if (match) max = Math.max(max, Number(match[1])); } return max; }
async function nextContractNumber() { const run = sequenceQueue.then(async () => { let meta = await metaDb.findOne({ key: 'contract-sequence' }); if (!meta) meta = await metaDb.insert({ key: 'contract-sequence', value: await currentMaxContractNumber(), updatedAt: now() }); const value = Number(meta.value || 0) + 1; await metaDb.update({ _id: meta._id }, { $set: { value, updatedAt: now() } }); return String(value); }); sequenceQueue = run.catch(() => {}); return run; }

function buildContract(input = {}, source = 'crm') { const status = CONTRACT_STATUS_KEYS.has(input.status) ? input.status : 'draft'; return { id: cleanText(input.id || crypto.randomUUID(), 100), title: cleanText(input.title || 'Договор оказания услуг', 300), number: cleanText(input.number, 160), amount: amountNumber(input.amount), date: dateOnly(input.date) || new Date().toISOString().slice(0, 10), city: cleanText(input.city || 'г. Талдыкорган', 120), paymentTerms: cleanText(input.paymentTerms, 1500), workPeriod: cleanText(input.workPeriod, 500), presetKey: cleanText(input.presetKey, 50), serviceSubject: cleanText(input.serviceSubject, 6000), serviceActions: cleanText(input.serviceActions, 6000), resultDefinition: cleanText(input.resultDefinition, 6000), fileUrl: cleanText(input.fileUrl, 1000), fileKey: cleanText(input.fileKey, 120), originalFilename: cleanText(input.originalFilename, 300), source: cleanText(source, 80), status, signTokenHash: cleanText(input.signTokenHash, 128), signedAt: Number(input.signedAt || 0) || 0, signedIp: cleanText(input.signedIp, 100), signedUserAgent: cleanText(input.signedUserAgent, 500), documentHash: cleanText(input.documentHash, 128), importedHash: cleanText(input.importedHash, 128), clientSnapshot: input.clientSnapshot && typeof input.clientSnapshot === 'object' ? input.clientSnapshot : {}, createdAt: Number(input.createdAt || now()) || now(), updatedAt: now() }; }
async function addContract(id, input = {}, source = 'crm') { const client = await getClient(id); if (!client) return null; const contract = buildContract(input, source); await db.update({ _id: id }, { $push: { contracts: contract, timeline: timelineEvent('contract', `${contract.title}${contract.number ? ` №${contract.number}` : ''}${contract.amount ? ` — ${contract.amount.toLocaleString('ru-RU')} ₸` : ''}`, source) }, $set: { updatedAt: now(), promotedAt: client.promotedAt || now() } }); queueBackup(); return { client: await getClient(id), contract }; }
async function addContractByIdentity(identity = {}, input = {}, source = 'telegram') { const client = await upsertByIdentity({ phone: identity.phone || input.phone, iin: identity.iin || input.iin, name: identity.name || input.name, address: identity.address || input.address, birthDate: identity.birthDate || input.birthDate, source }, source); return addContract(client._id, input, source); }
async function addContractByPhone(phone, input = {}, source = 'telegram') { return addContractByIdentity({ phone, name: input.name }, input, source); }
async function getContract(clientId, contractId, { includeDeleted = false } = {}) { const client = await getClient(clientId); if (!client) return null; const contract = (client.contracts || []).find(item => item.id === contractId && (includeDeleted || !item.deletedAt)); return contract ? { client, contract } : null; }

async function updateContract(clientId, contractId, patch = {}, source = 'crm') { const client = await getClient(clientId); if (!client) return null; const contracts = Array.isArray(client.contracts) ? client.contracts.slice() : []; const index = contracts.findIndex(item => item.id === contractId); if (index < 0) return null; const current = contracts[index]; const next = { ...current, updatedAt: now() }; const textFields = ['title', 'number', 'city', 'paymentTerms', 'workPeriod', 'presetKey', 'serviceSubject', 'serviceActions', 'resultDefinition', 'fileUrl', 'fileKey', 'originalFilename', 'documentHash', 'signTokenHash']; for (const field of textFields) if (Object.prototype.hasOwnProperty.call(patch, field)) next[field] = cleanText(patch[field], field.includes('service') || field === 'resultDefinition' ? 6000 : 1500); if (Object.prototype.hasOwnProperty.call(patch, 'amount')) next.amount = amountNumber(patch.amount); if (Object.prototype.hasOwnProperty.call(patch, 'date')) next.date = dateOnly(patch.date) || current.date; if (Object.prototype.hasOwnProperty.call(patch, 'status') && CONTRACT_STATUS_KEYS.has(patch.status)) next.status = patch.status; if (Object.prototype.hasOwnProperty.call(patch, 'signedAt')) next.signedAt = Number(patch.signedAt || 0) || 0; if (Object.prototype.hasOwnProperty.call(patch, 'signedIp')) next.signedIp = cleanText(patch.signedIp, 100); if (Object.prototype.hasOwnProperty.call(patch, 'signedUserAgent')) next.signedUserAgent = cleanText(patch.signedUserAgent, 500); if (patch.clientSnapshot && typeof patch.clientSnapshot === 'object') next.clientSnapshot = patch.clientSnapshot; contracts[index] = next; await db.update({ _id: clientId }, { $set: { contracts, updatedAt: now(), promotedAt: client.promotedAt || now() }, $push: { timeline: timelineEvent('contract-updated', `Договор №${next.number || '—'}: ${CONTRACT_STATUS[next.status] || next.status}`, source) } }); queueBackup(); return { client: await getClient(clientId), contract: next }; }
async function deleteContract(clientId, contractId, reason = '', source = 'crm') { const client = await getClient(clientId); if (!client) return null; const contracts = Array.isArray(client.contracts) ? client.contracts.slice() : []; const index = contracts.findIndex(item => item.id === contractId); if (index < 0) return null; const contract = { ...contracts[index], deletedAt: now(), deletedReason: cleanText(reason || 'Договор не состоялся / работа не началась', 500), updatedAt: now() }; contracts[index] = contract; await db.update({ _id: clientId }, { $set: { contracts, updatedAt: now() }, $push: { timeline: timelineEvent('contract-deleted', `Удалён из активных договор №${contract.number || '—'}: ${contract.deletedReason}`, source) } }); queueBackup(); return { client: await getClient(clientId), contract }; }
async function restoreContract(clientId, contractId, source = 'crm') { const client = await getClient(clientId); if (!client) return null; const contracts = Array.isArray(client.contracts) ? client.contracts.slice() : []; const index = contracts.findIndex(item => item.id === contractId); if (index < 0) return null; const contract = { ...contracts[index], deletedAt: 0, deletedReason: '', updatedAt: now() }; contracts[index] = contract; await db.update({ _id: clientId }, { $set: { contracts, updatedAt: now() }, $push: { timeline: timelineEvent('contract-restored', `Восстановлен договор №${contract.number || '—'}`, source) } }); queueBackup(); return { client: await getClient(clientId), contract }; }
async function findContractBySignTokenHash(hash) { const tokenHash = cleanText(hash, 128); if (!tokenHash) return null; const client = await db.findOne({ 'contracts.signTokenHash': tokenHash }); if (!client) return null; const contract = (client.contracts || []).find(item => item.signTokenHash === tokenHash && !item.deletedAt); return contract ? { client, contract } : null; }
async function signContractByTokenHash(hash, input = {}) { const found = await findContractBySignTokenHash(hash); if (!found) return null; if (found.contract.signedAt) return found; return updateContract(found.client._id, found.contract.id, { status: 'signed', signedAt: now(), signedIp: input.ip, signedUserAgent: input.userAgent, documentHash: input.documentHash || found.contract.documentHash }, 'client-sign'); }

function messageText(input = {}) { if (input.text) return cleanText(input.text, 8000); if (input.type) return `[${cleanText(input.type, 80)}]`; return '[сообщение]'; }
async function recordMessageByPhone(input = {}) { const phone = input.phone || input.waId; const client = await upsertByPhone({ phone, name: input.name, source: input.channel || 'whatsapp' }, input.channel || 'whatsapp'); const messageId = cleanText(input.messageId, 200); if (messageId && Array.isArray(client.messages) && client.messages.some(m => m.messageId === messageId)) return client; const msg = { id: crypto.randomUUID(), messageId, channel: cleanText(input.channel || 'whatsapp', 40), direction: input.direction === 'out' ? 'out' : 'in', text: messageText(input), at: Number(input.at) || now() }; await db.update({ _id: client._id }, { $push: { messages: msg, timeline: timelineEvent('message', `${msg.direction === 'in' ? 'Входящее' : 'Исходящее'} ${msg.channel}: ${msg.text.slice(0, 300)}`, msg.channel, msg.at) }, $set: { updatedAt: now(), lastContactAt: msg.at, promotedAt: client.promotedAt || now() } }); queueBackup(); return getClient(client._id); }
async function addNoteByPhone(phone, text, source = 'telegram') { const client = await upsertByPhone({ phone }, source); const note = cleanText(text, 4000); await db.update({ _id: client._id }, { $set: { notes: [client.notes, note].filter(Boolean).join('\n').slice(-10000), updatedAt: now(), promotedAt: client.promotedAt || now() }, $push: { timeline: timelineEvent('note', note, source) } }); queueBackup(); return getClient(client._id); }

async function summary() { const all = await db.find({}); const rows = all.filter(row => !isWebsiteOnly(row)); const byStatus = Object.fromEntries(Object.keys(STATUS).map(key => [key, 0])); let promiseTotal = 0, paidTotal = 0, overduePromises = 0, contractsTotal = 0, contractsWaiting = 0; const today = new Date().toISOString().slice(0, 10); for (const row of rows) { if (Object.prototype.hasOwnProperty.call(byStatus, row.status)) byStatus[row.status] += 1; promiseTotal += Number(row.promiseAmount || 0); paidTotal += Number(row.paidAmount || 0); if (row.promiseDate && row.promiseDate < today && row.paymentStatus !== 'paid') overduePromises += 1; for (const contract of activeContracts(row)) { contractsTotal += 1; if (['draft', 'sent', 'signed', 'waiting_payment'].includes(contract.status)) contractsWaiting += 1; } } return { total: rows.length, hiddenLeadOnly: all.length - rows.length, byStatus, promiseTotal: Math.round(promiseTotal * 100) / 100, paidTotal: Math.round(paidTotal * 100) / 100, overduePromises, contractsTotal, contractsWaiting }; }
async function exportAll() { return db.find({}).sort({ updatedAt: -1 }); }

module.exports = { STATUS, STATUS_KEYS, CONTRACT_STATUS, CONTRACT_STATUS_KEYS, normalizePhone, normalizeIin, isWebsiteOnly, activeContracts, createClient, upsertByIdentity, upsertByPhone, upsertFromLead, syncWebsiteLeads, findByPhone, findByIin, findByIdentity, getClient, listClients, updateClient, setStatus, setStatusByPhone, addPromise, addPromiseByPhone, addPayment, addPaymentByPhone, nextContractNumber, addContract, addContractByIdentity, addContractByPhone, getContract, updateContract, deleteContract, restoreContract, findContractBySignTokenHash, signContractByTokenHash, recordMessageByPhone, addNoteByPhone, summary, exportAll, scheduleBackup };
