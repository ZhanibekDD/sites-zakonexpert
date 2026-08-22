'use strict';

const { cleanText, contactValues } = require('./company-details-normalize');

const DETAIL_VERSION = 1;

function emptyDetails() {
  return { v: DETAIL_VERSION, n: [], a: [], c: [], g: [], x: [] };
}

function decodeDetails(raw) {
  if (!raw) return emptyDetails();
  try {
    const value = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return emptyDetails();
    return {
      v: DETAIL_VERSION,
      n: Array.isArray(value.n) ? value.n.filter(item => typeof item === 'string') : [],
      a: Array.isArray(value.a) ? value.a.filter(Array.isArray) : [],
      c: Array.isArray(value.c) ? value.c.filter(Array.isArray) : [],
      g: Array.isArray(value.g) ? value.g.filter(Array.isArray) : [],
      x: Array.isArray(value.x) ? value.x.filter(Array.isArray) : [],
    };
  } catch (_) {
    return emptyDetails();
  }
}

function uniquePush(list, value, key) {
  const identity = key(value);
  if (!identity || list.some(item => key(item) === identity)) return false;
  list.push(value);
  return true;
}

function looseKey(value) {
  return cleanText(value, 1600)
    .toLocaleLowerCase('ru-RU')
    .replace(/ё/g, 'е')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function addName(details, value, coreNames = []) {
  const name = cleanText(value, 500);
  const key = looseKey(name);
  if (!key || coreNames.some(core => looseKey(core) === key)) return false;
  return uniquePush(details.n, name, looseKey);
}

function addAddress(details, address, coreAddress = '') {
  const value = cleanText(address.value, 1600);
  const key = looseKey(value);
  if (!key || looseKey(coreAddress) === key) return false;
  return uniquePush(details.a, [
    value,
    cleanText(address.regionSlug, 100) || null,
    cleanText(address.city, 200) || null,
    cleanText(address.postalCode, 30) || null,
    Number.isFinite(address.latitude) ? address.latitude : null,
    Number.isFinite(address.longitude) ? address.longitude : null,
  ], item => looseKey(item[0]));
}

function addContact(details, contact, primaryContacts = []) {
  const identity = `${contact.type}:${contact.normalized}`;
  if (!contact.type || !contact.normalized
      || primaryContacts.some(item => `${item.type}:${item.normalized}` === identity)) return false;
  return uniquePush(
    details.c,
    [contact.type, cleanText(contact.value, 500), contact.normalized],
    item => `${item[0]}:${item[2]}`
  );
}

function addCategory(details, category, coreActivity = '') {
  const name = cleanText(category.category, 300);
  const subcategory = cleanText(category.subcategory, 300);
  const display = [name, subcategory].filter(Boolean).join(' — ');
  if (!name || looseKey(display) === looseKey(coreActivity)) return false;
  return uniquePush(
    details.g,
    [name, subcategory, cleanText(category.slug, 160)],
    item => `${looseKey(item[0])}:${looseKey(item[1])}`
  );
}

function addAttribute(details, attribute, coreValue = '') {
  const type = cleanText(attribute.type, 100);
  const value = cleanText(attribute.value, 500);
  const normalized = cleanText(attribute.normalized || looseKey(value), 500);
  if (!type || !value || (coreValue && looseKey(coreValue) === looseKey(value))) return false;
  return uniquePush(
    details.x,
    [type, value, normalized, attribute.public === false ? 0 : 1],
    item => `${item[0]}:${item[2]}`
  );
}

function isEmpty(details) {
  return !details.n.length && !details.a.length && !details.c.length
    && !details.g.length && !details.x.length;
}

function encodeDetails(details) {
  const compact = { v: DETAIL_VERSION };
  for (const key of ['n', 'a', 'c', 'g', 'x']) {
    if (details[key]?.length) compact[key] = details[key];
  }
  return JSON.stringify(compact);
}

function detailSearchText(details) {
  const values = [];
  values.push(...details.n);
  for (const address of details.a) values.push(address[0], address[2]);
  for (const contact of details.c) values.push(contact[1], contact[2]);
  for (const category of details.g) values.push(category[0], category[1]);
  return cleanText(values.filter(Boolean).join(' '), 12000);
}

function buildContactSearch(company = {}) {
  const values = [];
  for (const type of [
    'phone', 'mobile_phone', 'email', 'website', 'whatsapp', 'viber', 'telegram',
  ]) {
    for (const contact of contactValues(type, company[type])) {
      values.push(contact.normalized);
    }
  }
  return cleanText(values.join(' '), 8000);
}

function hydrateDetails(raw, source = {}) {
  const details = decodeDetails(raw);
  const base = {
    sourceKey: source.key,
    sourceLabel: source.label,
    priority: Number(source.priority) || 0,
  };
  return {
    names: details.n.map(value => ({
      locale: 'und', value, normalized: looseKey(value), kind: 'source', ...base,
    })),
    addresses: details.a.map(value => ({
      value: value[0],
      rawValue: value[0],
      regionSlug: value[1],
      city: value[2],
      postalCode: value[3],
      latitude: value[4],
      longitude: value[5],
      primary: false,
      ...base,
    })),
    contacts: details.c.map(value => ({
      type: value[0],
      value: value[1],
      normalized: value[2],
      primary: false,
      ...base,
    })),
    categories: details.g.map(value => ({
      category: value[0],
      subcategory: value[1],
      slug: value[2],
      ...base,
    })),
    attributes: details.x.filter(value => value[3] !== 0 && value[0] && value[1]).map(value => ({
      type: value[0],
      value: value[1],
      normalized: value[2],
      ...base,
    })),
  };
}

module.exports = {
  addAddress,
  addAttribute,
  addCategory,
  addContact,
  addName,
  buildContactSearch,
  decodeDetails,
  detailSearchText,
  emptyDetails,
  encodeDetails,
  hydrateDetails,
  isEmpty,
  looseKey,
};
