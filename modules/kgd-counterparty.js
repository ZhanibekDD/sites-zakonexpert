'use strict';

const DEFAULT_BASE_URL = 'https://portal.kgd.gov.kz';
const COUNTERPARTY_PATH = '/services/isnaportal/public/get-sur-data';

const INDICATOR_DEFINITIONS = [
  { key: 'registrationInvalid', label: 'Недействительная регистрация', weight: 28 },
  { key: 'reRegistrationInvalid', label: 'Недействительная перерегистрация', weight: 22 },
  { key: 'operationsWOWork', label: 'Сделки без фактического выполнения работ', weight: 35 },
  { key: 'esfRestrinctions', label: 'Ограничение выписки ЭСФ', weight: 24 },
  { key: 'inactive', label: 'Бездействующий налогоплательщик', weight: 32 },
  { key: 'regAddressAbsent', label: 'Отсутствует по регистрационному адресу', weight: 24 },
  { key: 'bankrupt', label: 'Сведения о банкротстве', weight: 45 },
  { key: 'selfRegulatoryRegistry', label: 'Реестр саморегулирования', weight: 8, informational: true },
  { key: 'courtDecisionRegistry', label: 'Судебное решение о прекращении реабилитации', weight: 35 },
];

function cleanBaseUrl(value) {
  const raw = String(value || DEFAULT_BASE_URL).trim().replace(/\/+$/, '');
  const parsed = new URL(raw);
  if (parsed.protocol !== 'https:') throw new Error('KGD API base URL must use HTTPS');
  return parsed.origin + parsed.pathname.replace(/\/+$/, '');
}

function validateBin(value) {
  const bin = String(value || '').replace(/\D/g, '');
  return /^\d{12}$/.test(bin) ? bin : null;
}

function localize(value, language = 'ru') {
  if (value == null) return '';
  if (typeof value !== 'object') return String(value).trim();
  return String(value[language] || value.ru || value.kk || value.kz || value.en || '').trim();
}

function isFlagged(value) {
  const normalized = localize(value).toLocaleLowerCase('ru-RU').replace(/\s+/g, ' ').trim();
  if (!normalized) return false;
  return ![
    'нет', 'нет данных', 'не имеется', 'отсутствует', 'не зарегистрирован',
    'false', '0', 'мәлімет жоқ', 'жоқ',
  ].includes(normalized);
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function debtScore(amount) {
  if (amount <= 0) return 0;
  if (amount < 100000) return 5;
  if (amount < 1000000) return 12;
  if (amount < 10000000) return 22;
  return 35;
}

function normalizeCounterparty(raw, requestedBin) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('KGD returned an invalid counterparty response');
  }

  const debt = finiteNumber(raw.taxDebt);
  const indicators = INDICATOR_DEFINITIONS.map(definition => {
    const value = localize(raw[definition.key]);
    const flagged = isFlagged(raw[definition.key]);
    return {
      key: definition.key,
      label: definition.label,
      value: value || 'Нет данных',
      flagged,
      informational: Boolean(definition.informational),
      weight: flagged && !definition.informational ? definition.weight : 0,
    };
  });
  const score = Math.min(100, indicators.reduce((sum, item) => sum + item.weight, 0) + debtScore(debt));
  const riskLevel = score >= 45 ? 'high' : (score >= 18 ? 'attention' : 'low');
  const statistics = Array.isArray(raw.statistics)
    ? raw.statistics.map(item => ({
      year: Number(item?.year) || null,
      workersCount: finiteNumber(item?.workersCount),
      taxIn: finiteNumber(item?.taxIn),
      knn: finiteNumber(item?.knn),
      knnAvg: finiteNumber(item?.knnAvg),
      vatAmount: finiteNumber(item?.vatAmount),
    })).filter(item => item.year).sort((a, b) => a.year - b.year)
    : [];

  return {
    company: {
      bin: validateBin(raw.xin) || requestedBin,
      nameRu: localize(raw.name, 'ru') || 'Наименование не опубликовано',
      nameKk: localize(raw.name, 'kk'),
      registrationDate: String(raw.regDate || '').trim() || null,
      residency: localize(raw.residency) || 'Нет данных',
      oked: localize(raw.oked) || 'Нет данных',
      okedName: localize(raw.okedName) || 'Нет данных',
      okedDate: String(raw.okedDate || '').trim() || null,
    },
    tax: {
      vatInfo: localize(raw.vatInfo) || 'Нет данных',
      vatDate: String(raw.vatDate || '').trim() || null,
      taxMode: localize(raw.taxMode) || 'Нет данных',
      taxModeDate: String(raw.taxModeDate || '').trim() || null,
      debt,
      debtBreakdown: [raw.taxDebt1, raw.taxDebt2, raw.taxDebt3, raw.taxDebt4].map(finiteNumber),
    },
    assessment: {
      score,
      riskLevel,
      flaggedCount: indicators.filter(item => item.flagged && !item.informational).length + (debt > 0 ? 1 : 0),
      indicators,
    },
    statistics,
    actuality: String(raw.actuality || '').trim() || null,
    source: {
      name: 'Комитет государственных доходов МФ РК',
      url: 'https://portal.kgd.gov.kz/ru/pages/info-services/find-information-for-ip-ul',
    },
  };
}

function createKgdCounterpartyClient({ token, baseUrl = DEFAULT_BASE_URL, http }) {
  const safeToken = String(token || '').trim();
  if (!http || typeof http.post !== 'function') throw new Error('HTTP client is required');
  const endpoint = cleanBaseUrl(baseUrl) + COUNTERPARTY_PATH;

  return {
    configured: Boolean(safeToken),
    async check(bin) {
      const validBin = validateBin(bin);
      if (!validBin) throw Object.assign(new Error('БИН должен содержать 12 цифр'), { code: 'INVALID_BIN' });
      if (!safeToken) throw Object.assign(new Error('KGD API token is not configured'), { code: 'KGD_NOT_CONFIGURED' });
      const response = await http.post(endpoint, { xin: validBin }, {
        timeout: 20000,
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'X-Portal-Token': safeToken,
          'User-Agent': 'ZakonExpert-Counterparty-Check/1.0',
        },
      });
      const payload = response?.data?.data && typeof response.data.data === 'object'
        ? response.data.data
        : response?.data;
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)
          || (!payload.xin && !payload.name && (payload.error || payload.message))) {
        throw Object.assign(new Error('Counterparty was not found in the KGD response'), {
          code: 'KGD_NOT_FOUND',
        });
      }
      return normalizeCounterparty(payload, validBin);
    },
  };
}

module.exports = {
  DEFAULT_BASE_URL,
  COUNTERPARTY_PATH,
  cleanBaseUrl,
  validateBin,
  isFlagged,
  normalizeCounterparty,
  createKgdCounterpartyClient,
};
