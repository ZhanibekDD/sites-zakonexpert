'use strict';

const overrides = require('../config/registry-privacy-overrides.json');

function normalizeContact(value) {
  let digits = String(value || '').replace(/\D/g, '');
  if (digits.length === 10) digits = `7${digits}`;
  if (digits.length === 11 && digits.startsWith('8')) digits = `7${digits.slice(1)}`;
  return digits.length >= 7 && digits.length <= 15 ? digits : '';
}

function normalizeFieldValue(value) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim().toUpperCase();
}

function registryRule(registry, recordId) {
  const registryOverrides = overrides[registry] || {};
  return registryOverrides[String(recordId || '').trim()] || null;
}

function suppressedContacts(registry, recordId) {
  const rule = registryRule(registry, recordId);
  if (!rule || !Array.isArray(rule.suppressContacts)) return new Set();
  return new Set(rule.suppressContacts.map(normalizeContact).filter(Boolean));
}

function isRegistryContactSuppressed(registry, recordId, value) {
  const normalized = normalizeContact(value);
  if (!normalized) return false;
  return suppressedContacts(registry, recordId).has(normalized);
}

function hasRegistryContactSuppressions(registry, recordId) {
  return suppressedContacts(registry, recordId).size > 0;
}

function stripSuppressedContactsFromText(registry, recordId, value) {
  if (value === null || value === undefined) return value;
  const blocked = suppressedContacts(registry, recordId);
  if (!blocked.size) return value;

  let text = String(value).replace(/\+?\d[\d\s().-]{5,}\d/g, match => {
    const normalized = normalizeContact(match);
    return normalized && blocked.has(normalized) ? '' : match;
  });

  // Official/open-data address fields sometimes contain a phone suffix such
  // as ", тел. +7(...)". Once the suppressed number is removed, do not leave
  // a misleading empty contact label or broken punctuation behind.
  text = text
    .replace(/(?:,\s*)?(?:тел(?:ефон)?\.?|моб(?:ильный)?\.?)\s*:?\s*(?=$|[,;])/giu, '')
    .replace(/\s+([,;])/g, '$1')
    .replace(/([,;])(?:\s*[,;])+/g, '$1')
    .replace(/[,;]\s*$/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();

  return text;
}

function applyRegistryPrivacyOverride(registry, record) {
  if (!record || typeof record !== 'object') return record;

  const rule = registryRule(registry, record.bin);
  if (!rule) return record;

  const sanitized = { ...record };
  for (const field of rule.suppressFields || []) {
    if (Object.prototype.hasOwnProperty.call(sanitized, field)) sanitized[field] = '';
  }
  for (const [field, values] of Object.entries(rule.suppressFieldValues || {})) {
    if (!Object.prototype.hasOwnProperty.call(sanitized, field) || !Array.isArray(values)) continue;
    const current = normalizeFieldValue(sanitized[field]);
    if (current && values.some(value => normalizeFieldValue(value) === current)) sanitized[field] = '';
  }
  if (Array.isArray(sanitized.contacts)) {
    sanitized.contacts = sanitized.contacts.filter(contact => !isRegistryContactSuppressed(
      registry,
      record.bin,
      contact?.normalized || contact?.value
    ));
  }
  for (const [field, value] of Object.entries(sanitized)) {
    if (typeof value === 'string') {
      sanitized[field] = stripSuppressedContactsFromText(registry, record.bin, value);
    }
  }
  return sanitized;
}

module.exports = {
  applyRegistryPrivacyOverride,
  hasRegistryContactSuppressions,
  isRegistryContactSuppressed,
  stripSuppressedContactsFromText,
};
