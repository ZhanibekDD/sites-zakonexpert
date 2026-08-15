'use strict';

const EMPTY_VALUE = 'Нет данных';

function sourceState(key, label, url, status, detail, actuality = null) {
  return { key, label, url, status, detail, actuality };
}

function localCompanyProfile(company, requestedBin) {
  if (!company) return null;
  return {
    bin: String(company.bin || requestedBin),
    nameRu: String(company.name_ru || company.name_kk || '').trim() || 'Наименование не опубликовано',
    nameKk: String(company.name_kk || '').trim(),
    registrationDate: company.registration_date || null,
    residency: EMPTY_VALUE,
    oked: EMPTY_VALUE,
    okedName: String(company.activity_ru || '').trim() || EMPTY_VALUE,
    okedDate: null,
    status: String(company.status_ru || '').trim() || EMPTY_VALUE,
    leader: String(company.leader || '').trim() || EMPTY_VALUE,
    address: String(company.address_ru || '').trim() || EMPTY_VALUE,
    cardUrl: company.slug ? `/company/${company.slug}` : null,
  };
}

function emptyTax() {
  return {
    vatInfo: EMPTY_VALUE,
    vatDate: null,
    taxMode: EMPTY_VALUE,
    taxModeDate: null,
    debt: null,
    debtBreakdown: [],
  };
}

function emptyAssessment() {
  return { score: null, riskLevel: 'unknown', flaggedCount: null, indicators: [] };
}

function mergeCompany(local, kgd, requestedBin) {
  const official = kgd?.company || {};
  const fallback = local || {};
  const officialOkedName = official.okedName && official.okedName !== EMPTY_VALUE
    ? official.okedName
    : null;
  return {
    bin: official.bin || fallback.bin || requestedBin,
    nameRu: official.nameRu || fallback.nameRu || 'Наименование не опубликовано',
    nameKk: official.nameKk || fallback.nameKk || '',
    registrationDate: official.registrationDate || fallback.registrationDate || null,
    residency: official.residency || fallback.residency || EMPTY_VALUE,
    oked: official.oked || fallback.oked || EMPTY_VALUE,
    okedName: officialOkedName || fallback.okedName || EMPTY_VALUE,
    okedDate: official.okedDate || fallback.okedDate || null,
    status: fallback.status || EMPTY_VALUE,
    leader: fallback.leader || EMPTY_VALUE,
    address: fallback.address || EMPTY_VALUE,
    cardUrl: fallback.cardUrl || null,
  };
}

function addProcurementRisk(assessment, procurement) {
  if (!procurement) return assessment;
  const rnu = procurement.unreliableSupplier;
  const indicator = {
    key: 'goszakupRnu',
    label: 'Реестр недобросовестных участников госзакупок',
    value: rnu.found ? `Найдено записей: ${rnu.count}` : 'Не обнаружено',
    flagged: rnu.found,
    informational: false,
    weight: rnu.found ? 35 : 0,
  };
  if (assessment.riskLevel === 'unknown') {
    return {
      score: rnu.found ? 35 : null,
      riskLevel: rnu.found ? 'attention' : 'unknown',
      flaggedCount: rnu.found ? 1 : null,
      indicators: [indicator],
    };
  }
  const score = Math.min(100, Number(assessment.score || 0) + indicator.weight);
  return {
    ...assessment,
    score,
    riskLevel: score >= 45 ? 'high' : (score >= 18 ? 'attention' : 'low'),
    flaggedCount: Number(assessment.flaggedCount || 0) + (rnu.found ? 1 : 0),
    indicators: [...(assessment.indicators || []), indicator],
  };
}

function statusFromError(error) {
  const status = Number(error?.response?.status || 0);
  if ([401, 403].includes(status)) return 'access_denied';
  if (status === 404 || /NOT_FOUND$/.test(String(error?.code || ''))) return 'not_found';
  return 'unavailable';
}

function createCompanyCheckService({ companiesDb, kgdClient, goszakupClient, now = () => new Date() }) {
  async function run(client, bin) {
    if (!client?.configured) return { status: 'not_configured', value: null, error: null };
    try {
      return { status: 'ok', value: await client.check(bin), error: null };
    } catch (error) {
      return { status: statusFromError(error), value: null, error };
    }
  }

  return {
    configured: {
      kgd: Boolean(kgdClient?.configured),
      goszakup: Boolean(goszakupClient?.configured),
    },
    async check(bin) {
      const localStats = companiesDb?.available?.() ? companiesDb.stats() : null;
      const localRaw = localStats?.available ? companiesDb.findByBin(bin) : null;
      const local = localCompanyProfile(localRaw, bin);
      const [kgdResult, goszakupResult] = await Promise.all([
        run(kgdClient, bin),
        run(goszakupClient, bin),
      ]);
      const kgd = kgdResult.value;
      const procurement = goszakupResult.value;
      const hasProcurementData = Boolean(
        procurement?.participant?.registered
        || procurement?.contracts?.asSupplier?.count
        || procurement?.contracts?.asCustomer?.count
        || procurement?.unreliableSupplier?.found
      );
      if (!local && !kgd && !hasProcurementData) {
        const error = new Error('No official source returned data');
        error.code = 'NO_OFFICIAL_DATA';
        error.sources = {
          egov: localStats?.available ? 'not_found' : 'unavailable',
          kgd: kgdResult.status,
          goszakup: goszakupResult.status,
        };
        throw error;
      }

      const checkedAt = now().toISOString();
      const assessment = addProcurementRisk(kgd?.assessment || emptyAssessment(), procurement);
      const sources = [
        sourceState(
          'egov',
          'ГБД ЮЛ — Министерство юстиции РК',
          'https://data.egov.kz/datasets/view?index=gbd_ul',
          local ? 'ok' : (localStats?.available ? 'not_found' : 'unavailable'),
          local ? 'Профиль организации получен' : 'Профиль не получен',
          localStats?.updatedAt || null
        ),
        sourceState(
          'kgd',
          'Комитет государственных доходов МФ РК',
          'https://portal.kgd.gov.kz/ru/pages/api-services',
          kgdResult.status,
          kgd ? 'Налоги и индикаторы получены' : 'Налоги и индикаторы не получены',
          kgd?.actuality || null
        ),
        sourceState(
          'goszakup',
          'Портал государственных закупок РК',
          'https://www.goszakup.gov.kz/ru/developer/ows_v3',
          procurement && !procurement.coverage?.complete ? 'partial' : goszakupResult.status,
          procurement
            ? (procurement.coverage?.complete ? 'Реестры закупок проверены' : 'Часть реестров закупок временно не ответила')
            : 'Реестры закупок не проверены',
          procurement?.participant?.indexedAt || null
        ),
        sourceState(
          'elicense',
          'Государственный реестр eLicense.kz',
          'https://elicense.kz/LicensingContent/SimpleSearchLicense',
          'official_search',
          'Доступен официальный ручной поиск; публичный API для автоматического запроса не подтверждён'
        ),
        sourceState(
          'dfo',
          'Депозитарий финансовой отчётности',
          'https://opi.dfo.kz/ru/opi/list?presentation=table',
          'official_search',
          'Доступен официальный ручной поиск; публичный API для автоматического запроса не подтверждён'
        ),
      ];

      return {
        company: mergeCompany(local, kgd, bin),
        tax: kgd?.tax || emptyTax(),
        assessment,
        statistics: kgd?.statistics || [],
        procurement,
        actuality: kgd?.actuality || localStats?.updatedAt || checkedAt,
        checkedAt,
        coverage: {
          profile: Boolean(local || kgd),
          tax: Boolean(kgd),
          procurement: Boolean(procurement),
          complete: Boolean(local && kgd && procurement && procurement.coverage?.complete),
        },
        sources,
      };
    },
  };
}

module.exports = {
  addProcurementRisk,
  createCompanyCheckService,
  emptyAssessment,
  localCompanyProfile,
  mergeCompany,
};
