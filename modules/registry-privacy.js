'use strict';

const overrides = require('../config/registry-privacy-overrides.json');

const CONTACT_FIELDS = [
  'phone', 'mobile_phone', 'fax', 'email', 'website',
  'whatsapp', 'viber', 'telegram',
];

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
  const rule = registryRule(registry, recordId);
  if (rule?.suppressAllContacts) return true;
  if (!normalized) return false;
  return Boolean(rule && Array.isArray(rule.suppressContacts)
    && rule.suppressContacts.some(contact => normalizeContact(contact) === normalized));
}

function hasRegistryContactSuppressions(registry, recordId) {
  const rule = registryRule(registry, recordId);
  return Boolean(rule && (rule.suppressAllContacts
    || (Array.isArray(rule.suppressContacts) && rule.suppressContacts.length)));
}

function normalizedSearchTokens(value) {
  return (String(value || '').toLocaleLowerCase('ru-RU').match(/[\p{L}\p{N}]+/gu) || [])
    .filter(token => token.length >= 2 || /^\d+$/.test(token));
}

function isRegistrySearchMatchSuppressed(registry, record, query) {
  if (!record || typeof record !== 'object') return false;
  const rule = registryRule(registry, record.bin);
  const queryTokens = normalizedSearchTokens(query);
  if (!rule || !queryTokens.length) return false;

  const normalizedQueryContact = normalizeContact(query);
  if (normalizedQueryContact && Array.isArray(rule.suppressContacts)
      && rule.suppressContacts.some(contact => normalizeContact(contact) === normalizedQueryContact)) {
    return true;
  }

  if (rule.suppressAllContacts && CONTACT_FIELDS.some(field => {
    const rawValue = String(record[field] || '').toLocaleLowerCase('ru-RU');
    if (!rawValue) return false;
    const normalizedValueContact = normalizeContact(rawValue);
    if (normalizedQueryContact && normalizedValueContact) {
      return normalizedValueContact.includes(normalizedQueryContact);
    }
    const valueTokens = normalizedSearchTokens(rawValue);
    return queryTokens.every(queryToken => (
      valueTokens.some(valueToken => valueToken.startsWith(queryToken))
    ));
  })) return true;

  return (rule.suppressFields || []).some(field => {
    const valueTokens = normalizedSearchTokens(record[field]);
    return valueTokens.length && queryTokens.every(queryToken => (
      valueTokens.some(valueToken => valueToken.startsWith(queryToken))
    ));
  });
}

function applyRegistryPrivacyOverride(registry, record) {
  if (!record || typeof record !== 'object') return record;

  const rule = registryRule(registry, record.bin);
  if (!rule) return record;

  const sanitized = { ...record };
  for (const field of rule.suppressFields || []) {
    if (Object.prototype.hasOwnProperty.call(sanitized, field)) sanitized[field] = '';
  }
  if (rule.suppressAddresses) {
    sanitized.address_ru = '';
    if (Array.isArray(sanitized.addresses)) sanitized.addresses = [];
  }
  if (rule.suppressAllContacts) {
    for (const field of CONTACT_FIELDS) {
      if (Object.prototype.hasOwnProperty.call(sanitized, field)) sanitized[field] = '';
    }
  }
  if (Array.isArray(sanitized.contacts)) {
    sanitized.contacts = sanitized.contacts.filter(contact => !isRegistryContactSuppressed(
      registry,
      record.bin,
      contact?.normalized || contact?.value
    ));
  }
  if (rule.noindex) sanitized.privacy_noindex = true;
  return sanitized;
}

module.exports = {
  applyRegistryPrivacyOverride,
  hasRegistryContactSuppressions,
  isRegistryContactSuppressed,
  isRegistrySearchMatchSuppressed,
};
