'use strict';

const fs = require('fs');
const path = require('path');
const { writeRegistrySource } = require('../modules/registry-source');

const API_URL = process.env.LAWYERS_REGISTRY_API_URL || 'https://eup.adilet.gov.kz/api/Lawyers';
const PUBLIC_URL = 'https://eup.adilet.gov.kz/#/lawyers/advocate';
const OUTPUT_PATH = path.join(__dirname, '..', 'registry', 'lawyers.json.gz');
const STATUS_PATH = path.join(__dirname, '..', 'data', 'lawyers-registry-status.json');
const PAGE_SIZE = 500;

const REGION_RULES = [
  [/г(?:ород)?\.?\s*астан|астанин/i, 'г. Астана'],
  [/г(?:ород)?\.?\s*алмат|алматинск(?:ая|ой)\s+городск/i, 'г. Алматы'],
  [/г(?:ород)?\.?\s*шымкент|шымкент/i, 'г. Шымкент'],
  [/акмол/i, 'Акмолинская область'],
  [/актюб/i, 'Актюбинская область'],
  [/алматинск/i, 'Алматинская область'],
  [/атырау/i, 'Атырауская область'],
  [/восточно[-\s]?казахстан/i, 'Восточно-Казахстанская область'],
  [/жамбыл/i, 'Жамбылская область'],
  [/западно[-\s]?казахстан/i, 'Западно-Казахстанская область'],
  [/караганд/i, 'Карагандинская область'],
  [/костанай/i, 'Костанайская область'],
  [/кызылорд/i, 'Кызылординская область'],
  [/мангистау/i, 'Мангистауская область'],
  [/павлодар/i, 'Павлодарская область'],
  [/северо[-\s]?казахстан/i, 'Северо-Казахстанская область'],
  [/туркестан/i, 'Туркестанская область'],
  [/\bабай/i, 'область Абай'],
  [/жетісу|жетысу/i, 'область Жетісу'],
  [/ұлытау|улытау/i, 'область Ұлытау'],
];

function clean(value) {
  return String(value || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

function normalizeDate(value) {
  const text = clean(value);
  return /^\d{4}-\d{2}-\d{2}/.test(text) ? text.slice(0, 10) : text;
}

function normalizeEmail(value) {
  const email = clean(value).toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[a-zа-я]{2,}$/i.test(email) ? email : '';
}

function normalizePhones(value) {
  const candidates = clean(value).split(/[,;/]+/);
  const phones = [];
  for (const candidate of candidates) {
    let digits = candidate.replace(/\D/g, '');
    if (digits.length === 10) digits = `7${digits}`;
    if (digits.length === 11 && digits.startsWith('8')) digits = `7${digits.slice(1)}`;
    if (digits.length !== 11 || !digits.startsWith('7')) continue;
    const phone = `+${digits}`;
    if (!phones.includes(phone)) phones.push(phone);
  }
  return phones;
}

function inferRegion(record) {
  const source = [record.workRegionOrCity, record.legalOrganization].map(clean).filter(Boolean).join(' ');
  const match = REGION_RULES.find(([pattern]) => pattern.test(source));
  return match ? match[1] : clean(record.workRegionOrCity) || 'Казахстан';
}

function buildName(record) {
  return [record.lastName, record.firstName, record.secondName]
    .map(clean)
    .filter(part => /[a-zа-яәғқңөұүһі]/i.test(part))
    .join(' ');
}

function isUsableRecord(record) {
  const name = buildName(record);
  if (!Number.isInteger(Number(record.id)) || name.length < 3) return false;
  if (/\b(?:test|тест|advokat|lawyer|admin|указано)\b/i.test(name)) return false;
  if (!/[a-zа-яәғқңөұүһі]/i.test(name)) return false;
  return true;
}

function normalizeSpecializations(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(item => clean(
    typeof item === 'string' ? item : item?.name || item?.title || item?.value,
  )).filter(Boolean))];
}

function normalizeRecord(record) {
  const location = [
    record.workDistrictOrCity,
    record.workCityOrRuralDistrict,
    record.workVilage,
    record.workAddress,
  ].map(clean).filter(Boolean);
  return {
    officialId: String(record.id),
    name: buildName(record),
    region: inferRegion(record),
    legalOrganization: clean(record.legalOrganization),
    licenseNo: clean(record.licenseNumber),
    licenseDate: normalizeDate(record.licenseIssueDate),
    since: normalizeDate(record.accessionDate || record.entryDateToLegalOrg),
    address: [...new Set(location)].join(', '),
    phones: normalizePhones(record.phone),
    email: normalizeEmail(record.email),
    specializations: normalizeSpecializations(record.specializations),
    lawyerStatus: clean(record.lawyerStatus),
    sourceUpdatedAt: normalizeDate(record.userChangeStatusDate),
  };
}

async function fetchPage(page) {
  const url = new URL(API_URL);
  url.search = new URLSearchParams({
    page: String(page),
    pageSize: String(PAGE_SIZE),
    sortField: 'LastName',
    direction: 'Ascending',
    lawyerType: '0',
  }).toString();

  let lastError;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const response = await fetch(url, {
        headers: {
          Accept: 'application/json',
          'User-Agent': 'ZakonExpertRegistry/1.0 (+https://zakonexpertt.kz)',
        },
        signal: AbortSignal.timeout(60000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = await response.json();
      if (!body.isSuccess || !Array.isArray(body.items)) throw new Error('unexpected API response');
      return { total: Number(body.total) || 0, items: body.items };
    } catch (error) {
      lastError = error;
      if (attempt < 4) await new Promise(resolve => setTimeout(resolve, attempt * 1500));
    }
  }
  throw lastError;
}

async function performRefresh() {
  const first = await fetchPage(0);
  if (first.total < 3500) throw new Error(`Проверка полноты не пройдена: API сообщает ${first.total}`);

  const raw = [...first.items];
  const pages = Math.ceil(first.total / PAGE_SIZE);
  for (let page = 1; page < pages; page++) {
    const result = await fetchPage(page);
    if (result.total !== first.total) {
      throw new Error(`Реестр изменился во время загрузки: ${first.total} -> ${result.total}`);
    }
    raw.push(...result.items);
    console.log(`[Lawyers] Loaded page ${page + 1}/${pages}: ${raw.length}/${first.total}`);
  }

  const byId = new Map();
  let rejected = 0;
  for (const record of raw) {
    if (!isUsableRecord(record)) {
      rejected++;
      continue;
    }
    const normalized = normalizeRecord(record);
    byId.set(normalized.officialId, normalized);
  }
  const records = [...byId.values()];
  const duplicates = raw.length - rejected - records.length;
  const regions = new Set(records.map(record => record.region));
  const organizations = new Set(records.map(record => record.legalOrganization).filter(Boolean));
  const withPhone = records.filter(record => record.phones.length).length;
  const withEmail = records.filter(record => record.email).length;

  if (records.length < 3500 || records.length < first.total * 0.9 || regions.size < 15 || organizations.size < 15) {
    throw new Error(
      `Проверка полноты не пройдена: valid=${records.length}, total=${first.total}, regions=${regions.size}, organizations=${organizations.size}`,
    );
  }

  writeRegistrySource(OUTPUT_PATH, 'lawyers', records, {
    source: PUBLIC_URL,
    sourceApi: API_URL,
    sourceTotal: first.total,
    rejected,
    duplicates,
  });
  const status = {
    source: PUBLIC_URL,
    checkedAt: new Date().toISOString(),
    sourceTotal: first.total,
    saved: records.length,
    rejected,
    duplicates,
    regions: regions.size,
    organizations: organizations.size,
    withPhone,
    withEmail,
  };
  fs.mkdirSync(path.dirname(STATUS_PATH), { recursive: true });
  fs.writeFileSync(STATUS_PATH, `${JSON.stringify(status, null, 2)}\n`, 'utf8');
  console.log(`[Lawyers] Saved ${records.length}/${first.total}: phone=${withPhone}, email=${withEmail}, rejected=${rejected}`);
  return status;
}

let refreshInProgress = null;
async function refreshLawyersRegistry() {
  if (refreshInProgress) return refreshInProgress;
  refreshInProgress = performRefresh();
  try {
    return await refreshInProgress;
  } finally {
    refreshInProgress = null;
  }
}

if (require.main === module) {
  refreshLawyersRegistry().catch(error => {
    console.error('[Lawyers] Refresh failed:', error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  API_URL,
  PUBLIC_URL,
  REGION_RULES,
  clean,
  normalizeDate,
  normalizeEmail,
  normalizePhones,
  inferRegion,
  buildName,
  isUsableRecord,
  normalizeRecord,
  fetchPage,
  performRefresh,
  refreshLawyersRegistry,
};
