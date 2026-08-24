'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DEFAULT_HISTORY_PATH = path.join(__dirname, '..', 'data', 'notary-registry-changes.json');
const MAX_HISTORY_ITEMS = 800;
const SOURCE_URL = 'https://enis.kz/NotarySearch';

const FIELD_LABELS = {
  license: 'лицензия',
  licenseDate: 'дата лицензии',
  address: 'адрес',
  phone: 'телефон',
  email: 'email',
  schedule: 'режим работы или сведения об архиве',
};

function clean(value) {
  return String(value || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

function normalize(value) {
  return clean(value).toUpperCase().replace(/[Ё]/g, 'Е');
}

function rowToRecord(row) {
  const values = Array.isArray(row)
    ? {
      region: row[0], num: row[1], name: row[2], license: row[3], licenseDate: row[4],
      address: row[5], phone: row[6], email: row[7], schedule: row[8],
    }
    : (row || {});
  const license = clean(values.license);
  return {
    region: clean(values.region),
    num: clean(values.num),
    name: normalize(values.name),
    license,
    licenseDate: clean(values.licenseDate),
    address: clean(values.address),
    phone: clean(values.phone),
    email: clean(values.email).toLowerCase(),
    schedule: clean(values.schedule),
    active: !/прекращена/i.test(license),
  };
}

function notaryKey(record) {
  const item = rowToRecord(record);
  return `${normalize(item.region)}|${normalize(item.name)}`;
}

function indexRows(rows) {
  const records = (Array.isArray(rows) ? rows : []).map(rowToRecord)
    .filter(item => item.region && item.name);
  const counts = new Map();
  records.forEach(item => counts.set(notaryKey(item), (counts.get(notaryKey(item)) || 0) + 1));
  const result = new Map();
  records.forEach(item => {
    const baseKey = notaryKey(item);
    const key = counts.get(baseKey) > 1 ? `${baseKey}|${item.num}` : baseKey;
    result.set(key, item);
  });
  return result;
}

function comparable(field, value) {
  if (field === 'phone') return clean(value).replace(/\D/g, '');
  if (field === 'email') return clean(value).toLowerCase();
  return normalize(value);
}

function makeChange(type, record, checkedAt, extra = {}) {
  const fingerprint = [type, notaryKey(record), checkedAt, JSON.stringify(extra)].join('|');
  return {
    id: crypto.createHash('sha256').update(fingerprint).digest('hex').slice(0, 20),
    type,
    at: checkedAt,
    name: record.name,
    region: record.region,
    active: record.active,
    ...extra,
  };
}

function buildNotaryChanges(previousRows, currentRows, checkedAt = new Date().toISOString()) {
  const previous = indexRows(previousRows);
  const current = indexRows(currentRows);
  const changes = [];
  const emptySummary = { added: 0, status: 0, updated: 0, removed: 0 };

  // A fresh installation has no trustworthy "before" snapshot. Treat the
  // first complete pull as a baseline instead of publishing thousands of
  // ordinary registry rows as newly added professionals.
  if (previous.size === 0) {
    return {
      changes,
      summary: emptySummary,
      suspicious: false,
      baseline: true,
      previousTotal: 0,
      currentTotal: current.size,
    };
  }

  current.forEach((record, key) => {
    const before = previous.get(key);
    if (!before) {
      changes.push(makeChange('added', record, checkedAt));
      return;
    }

    const statusChanged = before.active !== record.active;
    if (statusChanged) {
      changes.push(makeChange('status', record, checkedAt, {
        status: record.active ? 'active' : 'stopped',
      }));
    }

    const changedFields = Object.keys(FIELD_LABELS).filter(field => {
      if (field === 'license' && statusChanged) return false;
      return comparable(field, before[field]) !== comparable(field, record[field]);
    });
    if (changedFields.length) {
      changes.push(makeChange('updated', record, checkedAt, {
        changedFields,
        changedLabels: changedFields.map(field => FIELD_LABELS[field]),
      }));
    }
  });

  previous.forEach((record, key) => {
    if (!current.has(key)) changes.push(makeChange('removed', record, checkedAt));
  });

  const summary = changes.reduce((result, item) => {
    result[item.type] = (result[item.type] || 0) + 1;
    return result;
  }, emptySummary);
  const structuralChanges = summary.added + summary.removed;
  const structuralLimit = Math.max(200, Math.ceil(previous.size * 0.1));
  const suspicious = previous.size > 0 && (
    structuralChanges > structuralLimit || changes.length > Math.max(1500, Math.ceil(previous.size * 0.5))
  );

  return {
    changes: suspicious ? [] : changes,
    summary,
    suspicious,
    baseline: false,
    previousTotal: previous.size,
    currentTotal: current.size,
  };
}

function emptyHistory() {
  return {
    source: SOURCE_URL,
    checkedAt: null,
    latestChangeAt: null,
    rejectedDiff: null,
    changes: [],
  };
}

function readNotaryChanges(filename = DEFAULT_HISTORY_PATH) {
  try {
    const parsed = JSON.parse(fs.readFileSync(filename, 'utf8'));
    if (!parsed || !Array.isArray(parsed.changes)) return emptyHistory();
    return { ...emptyHistory(), ...parsed, changes: parsed.changes.slice(0, MAX_HISTORY_ITEMS) };
  } catch (_) {
    return emptyHistory();
  }
}

function writeAtomicJson(filename, value) {
  const directory = path.dirname(filename);
  const temporary = `${filename}.${process.pid}.tmp`;
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n', 'utf8');
  fs.renameSync(temporary, filename);
}

function recordNotaryChanges(diff, checkedAt = new Date().toISOString(), filename = DEFAULT_HISTORY_PATH) {
  const existing = readNotaryChanges(filename);
  const accepted = diff && !diff.suspicious && Array.isArray(diff.changes) ? diff.changes : [];
  const ids = new Set();
  const combined = [...accepted, ...existing.changes].filter(item => {
    if (!item || !item.id || ids.has(item.id)) return false;
    ids.add(item.id);
    return true;
  }).slice(0, MAX_HISTORY_ITEMS);
  const history = {
    source: SOURCE_URL,
    checkedAt,
    latestChangeAt: accepted.length ? checkedAt : existing.latestChangeAt,
    rejectedDiff: diff && diff.suspicious ? {
      at: checkedAt,
      summary: diff.summary,
      previousTotal: diff.previousTotal,
      currentTotal: diff.currentTotal,
    } : null,
    changes: combined,
  };
  writeAtomicJson(filename, history);
  return history;
}

module.exports = {
  DEFAULT_HISTORY_PATH,
  FIELD_LABELS,
  MAX_HISTORY_ITEMS,
  buildNotaryChanges,
  notaryKey,
  readNotaryChanges,
  recordNotaryChanges,
  rowToRecord,
};
