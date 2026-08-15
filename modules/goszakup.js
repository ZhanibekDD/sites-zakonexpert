'use strict';

const DEFAULT_BASE_URL = 'https://ows.goszakup.gov.kz';

function cleanBaseUrl(value) {
  const raw = String(value || DEFAULT_BASE_URL).trim().replace(/\/+$/, '');
  const parsed = new URL(raw);
  if (parsed.protocol !== 'https:') throw new Error('Goszakup API base URL must use HTTPS');
  return parsed.origin + parsed.pathname.replace(/\/+$/, '');
}

function validateBin(value) {
  const bin = String(value || '').replace(/\D/g, '');
  return /^\d{12}$/.test(bin) ? bin : null;
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function listPayload(payload) {
  if (Array.isArray(payload)) return { items: payload, total: payload.length };
  const body = payload && typeof payload === 'object' ? payload : {};
  const items = Array.isArray(body.items) ? body.items : [];
  return {
    items,
    total: Number.isFinite(Number(body.total)) ? Number(body.total) : items.length,
  };
}

function normalizeParticipant(payload, bin) {
  const direct = payload && typeof payload === 'object' && !Array.isArray(payload)
    && !Array.isArray(payload.items) && (payload.pid || payload.bin || payload.iin)
    ? payload
    : null;
  const rows = listPayload(payload);
  const item = direct
    || rows.items.find(row => String(row?.bin || row?.iin || '') === bin)
    || rows.items[0]
    || null;
  if (!item) return { registered: false, participantId: null, nameRu: null, nameKk: null, indexedAt: null };
  return {
    registered: true,
    participantId: Number(item.pid) || null,
    nameRu: String(item.name_ru || '').trim() || null,
    nameKk: String(item.name_kz || '').trim() || null,
    indexedAt: String(item.index_date || '').trim() || null,
  };
}

function normalizeContracts(payload) {
  const rows = listPayload(payload);
  const items = rows.items.map(item => ({
    id: Number(item?.id) || null,
    number: String(item?.contract_number_sys || item?.contract_number || '').trim() || null,
    announcementNumber: String(item?.trd_buy_number_anno || '').trim() || null,
    createdAt: String(item?.crdate || '').trim() || null,
    amount: finiteNumber(item?.contract_sum_wnds || item?.contract_sum),
    statusId: Number(item?.ref_contract_status_id) || null,
  })).sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || ''))).slice(0, 10);
  return { count: rows.total, latest: items };
}

function normalizeRnu(payload) {
  const rows = listPayload(payload);
  return {
    found: rows.total > 0,
    count: rows.total,
    entries: rows.items.slice(0, 10).map(item => ({
      courtDecisionDate: String(item?.court_decision_date || '').trim() || null,
      startDate: String(item?.start_date || '').trim() || null,
      endDate: String(item?.end_date || '').trim() || null,
      reasonId: Number(item?.ref_reason_id) || null,
      indexedAt: String(item?.index_date || '').trim() || null,
      systemId: Number(item?.system_id) || null,
    })),
  };
}

function createGoszakupClient({ token, baseUrl = DEFAULT_BASE_URL, http }) {
  const safeToken = String(token || '').trim();
  const root = cleanBaseUrl(baseUrl);
  if (!http || typeof http.get !== 'function') throw new Error('HTTP client is required');

  async function get(path, notFoundValue) {
    try {
      const response = await http.get(root + path, {
        timeout: 20000,
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${safeToken}`,
          'User-Agent': 'ZakonExpert-Counterparty-Check/1.0',
        },
      });
      return response?.data;
    } catch (error) {
      if (Number(error.response?.status || 0) === 404) return notFoundValue;
      throw error;
    }
  }

  return {
    configured: Boolean(safeToken),
    async check(bin) {
      const validBin = validateBin(bin);
      if (!validBin) throw Object.assign(new Error('БИН должен содержать 12 цифр'), { code: 'INVALID_BIN' });
      if (!safeToken) throw Object.assign(new Error('Goszakup API token is not configured'), { code: 'GOSZAKUP_NOT_CONFIGURED' });
      const responses = await Promise.allSettled([
        get(`/v3/subject/biin/${validBin}`, { items: [], total: 0 }),
        get(`/v3/contract/supplier/${validBin}`, { items: [], total: 0 }),
        get(`/v3/contract/customer/${validBin}`, { items: [], total: 0 }),
        get(`/v3/rnu/${validBin}`, { items: [], total: 0 }),
      ]);
      const successful = responses.filter(result => result.status === 'fulfilled').length;
      if (!successful) throw responses[0].reason;
      const [participant, supplierContracts, customerContracts, rnu] = responses.map(result => (
        result.status === 'fulfilled' ? result.value : { items: [], total: 0 }
      ));
      return {
        participant: normalizeParticipant(participant, validBin),
        contracts: {
          asSupplier: normalizeContracts(supplierContracts),
          asCustomer: normalizeContracts(customerContracts),
        },
        unreliableSupplier: normalizeRnu(rnu),
        coverage: {
          participant: responses[0].status === 'fulfilled',
          supplierContracts: responses[1].status === 'fulfilled',
          customerContracts: responses[2].status === 'fulfilled',
          unreliableSupplier: responses[3].status === 'fulfilled',
          complete: successful === responses.length,
        },
        source: {
          name: 'Портал государственных закупок Республики Казахстан',
          url: 'https://www.goszakup.gov.kz/ru/registry/supplierreg',
        },
      };
    },
  };
}

module.exports = {
  DEFAULT_BASE_URL,
  cleanBaseUrl,
  listPayload,
  normalizeContracts,
  normalizeParticipant,
  normalizeRnu,
  createGoszakupClient,
};
