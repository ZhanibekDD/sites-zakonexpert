'use strict';

const overrides = require('../config/registry-privacy-overrides.json');

function normalizeContact(value) {
  let digits = String(value || '').replace(/\D/g, '');
  if (digits.length === 10) digits = `7${digits}`;
  if (digits.length === 11 && digits.startsWith('8')) digits = `7${digits.slice(1)}`;
  return digits.length >= 7 && digits.length <= 15 ? digits : '';
}

function registryRule(registry, recordId) {
  const registryOverrides = overrides[registry] || {};
  return registryOverrides[String(recordId || '').trim()] || null;
}

function isRegistryContactSuppressed(registry, recordId, value) {
  const normalized = normalizeContact(value);
  if (!normalized) return false;
  const rule = registryRule(registry, recordId);
  return Boolean(rule && Array.isArray(rule.suppressContacts)
    && rule.suppressContacts.some(contact => normalizeContact(contact) === normalized));
}

function hasRegistryContactSuppressions(registry, recordId) {
  const rule = registryRule(registry, recordId);
  return Boolean(rule && Array.isArray(rule.suppressContacts) && rule.suppressContacts.length);
}

function applyRegistryPrivacyOverride(registry, record) {
  if (!record || typeof record !== 'object') return record;

  const rule = registryRule(registry, record.bin);
  if (!rule) return record;

  const sanitized = { ...record };
  for (const field of rule.suppressFields || []) {
    if (Object.prototype.hasOwnProperty.call(sanitized, field)) sanitized[field] = '';
  }
  if (Array.isArray(sanitized.contacts)) {
    sanitized.contacts = sanitized.contacts.filter(contact => !isRegistryContactSuppressed(
      registry,
      record.bin,
      contact?.normalized || contact?.value
    ));
  }
  return sanitized;
}

module.exports = {
  applyRegistryPrivacyOverride,
  hasRegistryContactSuppressions,
  isRegistryContactSuppressed,
};
