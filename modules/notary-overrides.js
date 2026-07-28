'use strict';

// Corrections confirmed directly by registry members. Keep these separate from
// the ENIS snapshot so a refresh cannot silently restore outdated contacts.
const OVERRIDES = Object.freeze({
  '22020237': Object.freeze({
    name: 'АМАН ЖАНЕРКЕ',
    email: 'amanzhanerke87@gmail.com',
  }),
});

function normalize(value) {
  return String(value || '').trim().toUpperCase().replace(/\s+/g, ' ');
}

function applyNotaryOverride(notary) {
  const override = OVERRIDES[String(notary.license || '').trim()];
  if (!override || normalize(notary.name) !== override.name) return { ...notary };
  return { ...notary, ...override };
}

module.exports = { OVERRIDES, applyNotaryOverride };
