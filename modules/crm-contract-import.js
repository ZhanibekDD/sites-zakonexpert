'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const crmDb = require('./crm-db');

const CONTRACT_UPLOAD_DIR = process.env.CRM_CONTRACT_UPLOAD_DIR || path.join(__dirname, '..', 'data', 'crm-contracts');

function cleanText(value, max = 4000) {
  return String(value ?? '').replace(/\u0000/g, '').trim().slice(0, max);
}

function safeFilename(value) {
  return String(value || 'contract').replace(/[^0-9A-Za-zА-Яа-яЁёӘәҒғҚқҢңӨөҰұҮүҺһІі._()\- ]/g, '_').slice(0, 180) || 'contract';
}

function uploadRoot() {
  fs.mkdirSync(CONTRACT_UPLOAD_DIR, { recursive: true, mode: 0o700 });
  return path.resolve(CONTRACT_UPLOAD_DIR);
}

function resolveStoredFile(storedFile) {
  const root = uploadRoot();
  const target = path.resolve(String(storedFile || ''));
  if (!target || (target !== root && !target.startsWith(`${root}${path.sep}`))) return null;
  return target;
}

function storeUpload(buffer, filename) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw new Error('EMPTY_FILE');
  const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
  const ext = path.extname(filename || '').toLowerCase();
  const target = path.join(uploadRoot(), `${sha256}${ext}`);
  if (!fs.existsSync(target)) fs.writeFileSync(target, buffer, { mode: 0o600 });
  return { sha256, storedFile: target, ext };
}

function realIdentity(parsed = {}) {
  const iin = String(parsed.iin || '').replace(/\D/g, '');
  const phone = crmDb.normalizePhone(parsed.phone);
  return { iin: /^\d{12}$/.test(iin) ? iin : '', phone };
}

async function saveParsedImport({ parsed = {}, storedFile, filename, mimeType, sha256 }) {
  const target = resolveStoredFile(storedFile);
  if (!target || !fs.existsSync(target)) throw new Error('IMPORT_FILE_NOT_FOUND');
  const digest = cleanText(sha256, 64).toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(digest)) throw new Error('BAD_IMPORT_HASH');
  const identity = realIdentity(parsed);
  if (!identity.iin && !identity.phone) throw new Error('IDENTIFIER_REQUIRED');

  return crmDb.upsertContractFromIntegration({
    source: 'contract-import',
    externalContractId: `upload:${digest}`,
    number: cleanText(parsed.number, 120),
    title: 'Загруженный договор',
    date: cleanText(parsed.date, 30),
    amount: Number(parsed.amount || 0),
    currency: cleanText(parsed.currency || 'KZT', 12),
    service: cleanText(parsed.service, 3000),
    paymentType: cleanText(parsed.paymentType, 80),
    documentSha256: digest,
    hasPdf: path.extname(filename || '').toLowerCase() === '.pdf',
    hasDocx: path.extname(filename || '').toLowerCase() === '.docx',
    storedFile: target,
    originalName: safeFilename(filename),
    mimeType: cleanText(mimeType, 160),
    client: {
      externalClientId: `upload:${digest}`,
      name: cleanText(parsed.name, 255),
      iin: identity.iin,
      phone: cleanText(parsed.phone, 50),
      address: cleanText(parsed.address, 800),
      documentNumber: cleanText(parsed.documentNumber, 100),
    },
  }, 'contract-import');
}

module.exports = {
  CONTRACT_UPLOAD_DIR,
  safeFilename,
  uploadRoot,
  resolveStoredFile,
  storeUpload,
  saveParsedImport,
};
