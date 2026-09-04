'use strict';

function freeze(value) {
  return Object.freeze(value);
}

const COMPANY_CORRECTIONS = freeze({
  '050240002031': freeze({
    bin: '050240002031',
    statusRu: 'Деятельность прекращена 29.02.2024 путем присоединения',
    dissolutionDate: '2024-02-29',
    reorganizationType: 'Присоединение',
    successorNameRu: 'ТОО «Jan De Nul Kazakhstan» («Ян Де Нул Казахстан»)',
    leaderDisplayRu: 'Действующий руководитель отсутствует: деятельность прекращена',
    correction: freeze({
      title: 'Сведения актуализированы по подтверждающему документу',
      summary: 'ТОО «АЛИАСКАР-2005» прекратило деятельность 29 февраля 2024 года путем присоединения к ТОО «Jan De Nul Kazakhstan» («Ян Де Нул Казахстан»). Алшанов А. Р. не отображается как действующий руководитель.',
      sourceLabel: 'Приказ № 7965 Управления регистрации филиала НАО «Государственная корпорация «Правительство для граждан» по городу Алматы',
      sourceDate: '2024-02-29',
      verifiedAt: '2026-08-25',
      statusNote: 'Статус и сведения о руководителе скорректированы по представленному регистрационному приказу. Персональные данные из документа не публикуются.',
    }),
  }),
  '251140034546': freeze({
    bin: '251140034546',
    statusRu: 'Деятельность прекращена 20.08.2026',
    dissolutionDate: '2026-08-20',
    reorganizationType: null,
    successorNameRu: null,
    leaderDisplayRu: 'Действующий руководитель отсутствует: деятельность прекращена',
    correction: freeze({
      title: 'Сведения актуализированы по подтверждающему документу',
      summary: 'ТОО «Cave Group» прекратило деятельность 20 августа 2026 года. Персональные данные бывшего руководителя и точный адрес не публикуются.',
      sourceLabel: 'Приказ № 33519 Управления регистрации юридических лиц филиала НАО «Государственная корпорация «Правительство для граждан» по городу Алматы',
      sourceDate: '2026-08-20',
      verifiedAt: '2026-09-04',
      statusNote: 'Статус скорректирован по представленному регистрационному приказу. Персональные данные из документа не публикуются.',
    }),
  }),
});

function normalizeBin(value) {
  return String(value || '').replace(/\D/g, '');
}

function getCompanyCorrection(bin) {
  return COMPANY_CORRECTIONS[normalizeBin(bin)] || null;
}

function applyCompanyCorrection(company) {
  if (!company) return company;
  const correction = getCompanyCorrection(company.bin);
  if (!correction) return company;

  return {
    ...company,
    status_ru: correction.statusRu,
    dissolution_date: correction.dissolutionDate,
    reorganization_type: correction.reorganizationType,
    successor_name_ru: correction.successorNameRu,
    // The historical source may still contain a natural person's name. Once
    // the legal entity has ceased activity, it must not be presented as a
    // current executive on ZakonExpert.
    leader: null,
    leader_display: correction.leaderDisplayRu,
    correction: { ...correction.correction },
  };
}

module.exports = {
  COMPANY_CORRECTIONS,
  applyCompanyCorrection,
  getCompanyCorrection,
  normalizeBin,
};
