'use strict';

const LEGAL_FORM_PREFIXES = [
  'tovarishchestvo-s-ogranichennoy-otvetstvennostyu-',
  'tovarishchestvo-s-ogranichennoy-otvetstvenostyu-',
  'ovarishchestvo-s-ogranichennoy-otvetstvennostyu-',
  'ovarishchestvo-s-ogranichennoy-otvetstvenostyu-',
  'aktsionernoe-obshchestvo-',
  'akcionernoe-obshchestvo-',
  'mikrofinansovaya-organizatsiya-',
  'mikrofinansovaya-organizaciya-',
  'chastnoe-uchrezhdenie-',
  'too-',
  'ao-',
];

const PERSON_SLUG_SUFFIXES = new Set([
  'abai', 'akmola', 'aktobe', 'almaty', 'astana', 'atyrau', 'jetisu',
  'karaganda', 'kostanay', 'kyzylorda', 'mangystau', 'pavlodar',
  'shymkent', 'turkestan', 'ulytau', 'oblast', 'kazakhstan',
]);

function normalizeSlug(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function legacyCatalogCandidates(value) {
  const initial = normalizeSlug(value);
  const candidates = new Set(initial ? [initial] : []);
  let changed = true;
  while (changed) {
    changed = false;
    for (const candidate of Array.from(candidates)) {
      for (const prefix of LEGAL_FORM_PREFIXES) {
        if (!candidate.startsWith(prefix)) continue;
        const stripped = candidate.slice(prefix.length).replace(/^-+/, '');
        if (stripped && !candidates.has(stripped)) {
          candidates.add(stripped);
          changed = true;
        }
      }
    }
  }
  return Array.from(candidates);
}

function resolveLegacyCatalogItem(items, requestedSlug) {
  const candidates = new Set(legacyCatalogCandidates(requestedSlug));
  const matches = (Array.isArray(items) ? items : []).filter(item =>
    candidates.has(normalizeSlug(item?.slug))
  );
  return matches.length === 1 ? matches[0] : null;
}

function normalizeIdentity(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLocaleUpperCase('ru-RU')
    .replace(/\s+/g, ' ')
    .trim();
}

function legacySlugs(value, currentSlug = '') {
  const current = normalizeSlug(currentSlug);
  return Array.from(new Set((Array.isArray(value) ? value : [])
    .map(normalizeSlug)
    .filter(slug => slug && slug !== current)));
}

function inheritLegacySlugs(records, previousRecords, identityGetters) {
  const oldRows = Array.isArray(previousRecords) ? previousRecords : [];
  const getters = Array.isArray(identityGetters) ? identityGetters : [];
  const indexes = getters.map(getter => {
    const map = new Map();
    for (const row of oldRows) {
      const key = normalizeIdentity(getter(row));
      if (!key) continue;
      const matches = map.get(key) || [];
      matches.push(row);
      map.set(key, matches);
    }
    return map;
  });

  return (Array.isArray(records) ? records : []).map(record => {
    let previous = null;
    for (let index = 0; index < getters.length; index++) {
      const key = normalizeIdentity(getters[index](record));
      const matches = key ? indexes[index].get(key) : null;
      if (matches?.length === 1) {
        previous = matches[0];
        break;
      }
    }
    if (!previous) return { ...record, legacySlugs: legacySlugs(record.legacySlugs, record.slug) };
    return {
      ...record,
      legacySlugs: legacySlugs([
        ...(record.legacySlugs || []),
        previous.slug,
        ...(previous.legacySlugs || []),
      ], record.slug),
    };
  });
}

function personSlugStem(value) {
  const parts = normalizeSlug(value).split('-').filter(Boolean);
  if (/^\d+$/.test(parts.at(-1) || '')) parts.pop();
  if (PERSON_SLUG_SUFFIXES.has(parts.at(-1))) parts.pop();
  return parts.join('-');
}

function resolvePersonSlugAlias(items, requestedSlug) {
  const requested = normalizeSlug(requestedSlug);
  const direct = (Array.isArray(items) ? items : []).filter(item =>
    legacySlugs(item?.legacySlugs, item?.slug).includes(requested)
  );
  if (direct.length === 1) return direct[0];

  const stem = personSlugStem(requested);
  if (!stem) return null;
  const inferred = (Array.isArray(items) ? items : []).filter(item =>
    personSlugStem(item?.slug) === stem
  );
  return inferred.length === 1 ? inferred[0] : null;
}

module.exports = {
  inheritLegacySlugs,
  legacyCatalogCandidates,
  legacySlugs,
  normalizeIdentity,
  normalizeSlug,
  personSlugStem,
  resolveLegacyCatalogItem,
  resolvePersonSlugAlias,
};
