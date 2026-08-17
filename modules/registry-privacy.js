'use strict';

const overrides = require('../config/registry-privacy-overrides.json');

function applyRegistryPrivacyOverride(registry, record) {
  if (!record || typeof record !== 'object') return record;

  const registryOverrides = overrides[registry] || {};
  const rule = registryOverrides[String(record.bin || '').trim()];
  if (!rule || !Array.isArray(rule.suppressFields)) return record;

  const sanitized = { ...record };
  for (const field of rule.suppressFields) {
    if (Object.prototype.hasOwnProperty.call(sanitized, field)) sanitized[field] = '';
  }
  return sanitized;
}

module.exports = { applyRegistryPrivacyOverride };
