'use strict';

function cleanText(value, maxLength = 1000) {
  return String(value == null ? '' : value)
    .normalize('NFKC')
    .replace(/[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2060\ufeff]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function uniqueByNormalized(items) {
  const seen = new Set();
  return items.filter(item => {
    if (!item?.normalized || seen.has(item.normalized)) return false;
    seen.add(item.normalized);
    return true;
  });
}

function phoneDisplay(digits) {
  if (!/^7\d{10}$/.test(digits)) return `+${digits}`;
  return `+7 (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7, 9)}-${digits.slice(9, 11)}`;
}

function normalizePhoneDigits(raw) {
  let digits = String(raw || '').replace(/\D/g, '');
  if (digits.length === 10) digits = `7${digits}`;
  if (digits.length === 11 && digits.startsWith('8')) digits = `7${digits.slice(1)}`;
  if (digits.length < 7 || digits.length > 15) return null;
  return digits;
}

function phoneValues(raw) {
  const text = cleanText(raw);
  if (!text) return [];
  const matches = text.match(/(?:\+?7|8)(?:[\s().-]*\d){10}/g) || [];
  const candidates = matches.length ? matches : text.split(/[,;|\n]+/);
  return uniqueByNormalized(candidates.map(value => {
    const digits = normalizePhoneDigits(value);
    if (!digits) return null;
    return { value: phoneDisplay(digits), normalized: `+${digits}` };
  }).filter(Boolean));
}

function emailValues(raw) {
  const text = cleanText(raw);
  if (!text) return [];
  const matches = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,63}/gi) || [];
  return uniqueByNormalized(matches.map(value => ({
    value: value.toLocaleLowerCase('en-US'),
    normalized: value.toLocaleLowerCase('en-US'),
  })));
}

function websiteValues(raw) {
  const text = cleanText(raw);
  if (!text) return [];
  return uniqueByNormalized(text.split(/[,;|\n]+/).map(rawValue => {
    let value = cleanText(rawValue, 500).replace(/[).,;]+$/g, '');
    if (!value || /\s/.test(value)) return null;
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) value = `https://${value}`;
    try {
      const url = new URL(value);
      if (!/^https?:$/.test(url.protocol) || !url.hostname.includes('.')) return null;
      url.hash = '';
      const normalized = `${url.protocol}//${url.hostname.toLocaleLowerCase('en-US')}${url.port ? `:${url.port}` : ''}${url.pathname.replace(/\/+$/, '') || ''}${url.search}`;
      return { value: normalized, normalized };
    } catch (_) {
      return null;
    }
  }).filter(Boolean));
}

function telegramValues(raw) {
  const text = cleanText(raw);
  if (!text) return [];
  return uniqueByNormalized(text.split(/[,;|\n]+/).map(rawValue => {
    const value = cleanText(rawValue, 200);
    if (!value) return null;
    const match = value.match(/(?:https?:\/\/)?(?:t\.me|telegram\.me)\/([a-z0-9_]{5,})/i)
      || value.match(/^@?([a-z0-9_]{5,})$/i);
    if (!match) return null;
    const handle = match[1].toLocaleLowerCase('en-US');
    return { value: `https://t.me/${handle}`, normalized: handle };
  }).filter(Boolean));
}

function genericValues(raw) {
  return uniqueByNormalized(cleanText(raw).split(/[,;|\n]+/).map(rawValue => {
    const value = cleanText(rawValue, 500);
    return value ? { value, normalized: value.toLocaleLowerCase('ru-RU') } : null;
  }).filter(Boolean));
}

function contactValues(type, raw) {
  if (type === 'phone' || type === 'mobile_phone' || type === 'fax' || type === 'whatsapp' || type === 'viber') {
    return phoneValues(raw);
  }
  if (type === 'email') return emailValues(raw);
  if ([
    'website', 'vkontakte', 'odnoklassniki', 'youtube', 'rutube', 'yandex_zen',
  ].includes(type)) return websiteValues(raw);
  if (type === 'telegram') return telegramValues(raw);
  return genericValues(raw);
}

function cleanAddress(raw) {
  const original = cleanText(raw, 1500);
  if (!original) return { raw: '', clean: '', extractedContacts: [] };
  const extractedContacts = [];
  let clean = original.replace(
    /(?:^|[,;]\s*)(тел(?:ефон)?|факс)\s*[.:]*\s*((?:\+?7|8)(?:[\s().-]*\d){10})/giu,
    (full, label, value) => {
      const type = /факс/i.test(label) ? 'fax' : 'phone';
      for (const contact of contactValues(type, value)) extractedContacts.push({ type, ...contact });
      return '';
    }
  );
  clean = clean.replace(/\s*,\s*,+/g, ', ').replace(/^[,;\s]+|[,;\s]+$/g, '').trim();
  return { raw: original, clean, extractedContacts };
}

function normalizeCoordinate(value, min, max) {
  const number = Number.parseFloat(String(value || '').replace(',', '.'));
  return Number.isFinite(number) && number >= min && number <= max ? number : null;
}

function normalizeDirectoryRow(row = {}) {
  const name = cleanText(row.name, 500);
  const address = cleanAddress(row.address);
  const contacts = [];
  const fields = [
    'phone', 'mobile_phone', 'email', 'website', 'whatsapp', 'viber', 'telegram', 'fax',
    'vkontakte', 'odnoklassniki', 'youtube', 'rutube', 'yandex_zen',
  ];
  for (const type of fields) {
    for (const contact of contactValues(type, row[type])) contacts.push({ type, ...contact });
  }
  contacts.push(...address.extractedContacts);

  return {
    externalId: cleanText(row.id, 200),
    name,
    region: cleanText(row.region, 200),
    city: cleanText(row.city, 200),
    postalCode: cleanText(row.postal_index, 30),
    addressRaw: address.raw,
    address: address.clean,
    category: cleanText(row.category, 300),
    subcategory: cleanText(row.subcategory, 300),
    workHours: cleanText(row.work_hours, 500),
    paymentMethods: cleanText(row.payment_methods, 500),
    latitude: normalizeCoordinate(row.lat, -90, 90),
    longitude: normalizeCoordinate(row.lon, -180, 180),
    contacts: uniqueByNormalized(contacts.map(contact => ({
      ...contact,
      normalized: `${contact.type}:${contact.normalized}`,
    }))).map(contact => ({
      ...contact,
      normalized: contact.normalized.slice(contact.normalized.indexOf(':') + 1),
    })),
  };
}

module.exports = {
  cleanAddress,
  cleanText,
  contactValues,
  normalizeCoordinate,
  normalizeDirectoryRow,
  normalizePhoneDigits,
  phoneValues,
  websiteValues,
};
