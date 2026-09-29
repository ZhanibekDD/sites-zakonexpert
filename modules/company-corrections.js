'use strict';

function freeze(value) {
  return Object.freeze(value);
}

const COMPANY_CORRECTIONS = freeze({
  '040340003399': freeze({
    bin: '040340003399',
    leaderRu: 'НАКИСБЕКОВА ГУЛЬМИРА КАСЫМКАНОВНА',
    addressRu: '050057, ГОРОД АЛМАТЫ, БОСТАНДЫКСКИЙ РАЙОН, УЛ. АУЭЗОВА, Д. 175, Н.П. 7',
    additionalAddresses: freeze([
      freeze({
        value: 'Г. АЛМАТЫ, УЛ. ТОЛЕ БИ, Д. 83, БЦ «АМБАССАДОР», ОФИС 404',
        sourceLabel: 'Контактный адрес, сообщённый представителем организации 29.09.2026',
      }),
    ]),
    correction: freeze({
      title: 'Сведения актуализированы по официальному реестру',
      summary: 'Для ТОО «ҚОРҒАНЫС ЛТД» актуализированы руководитель и юридический адрес по сведениям государственного реестра: руководитель — Накисбекова Гульмира Касымкановна; юридический адрес — г. Алматы, Бостандыкский район, ул. Ауэзова, д. 175, н.п. 7. Дополнительно указан контактный адрес, сообщённый представителем организации: г. Алматы, ул. Толе би, д. 83, БЦ «Амбассадор», офис 404.',
      sourceLabel: 'Электронное правительство Республики Казахстан — реестр юридических лиц',
      sourceDate: '2026-05-03',
      verifiedAt: '2026-09-28',
      statusNote: 'Подтверждённые регистрационные сведения имеют приоритет над устаревшими значениями из предыдущих выгрузок и справочников.',
    }),
  }),
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

  const result = {
    ...company,
    correction: { ...correction.correction },
  };

  if (correction.statusRu !== undefined) result.status_ru = correction.statusRu;
  if (correction.dissolutionDate !== undefined) result.dissolution_date = correction.dissolutionDate;
  if (correction.reorganizationType !== undefined) result.reorganization_type = correction.reorganizationType;
  if (correction.successorNameRu !== undefined) result.successor_name_ru = correction.successorNameRu;
  if (correction.addressRu !== undefined) result.address_ru = correction.addressRu;
  if (Array.isArray(correction.additionalAddresses)) {
    const existing = Array.isArray(result.addresses) ? result.addresses : [];
    const seen = new Set(existing.map(item => String(item?.value || '').trim().toLocaleLowerCase('ru-RU')));
    const additions = correction.additionalAddresses
      .filter(item => item?.value && !seen.has(String(item.value).trim().toLocaleLowerCase('ru-RU')))
      .map(item => ({ ...item }));
    result.addresses = [...existing, ...additions];
  }

  if (correction.leaderRu !== undefined) {
    result.leader = correction.leaderRu;
    result.leader_display = correction.leaderRu;
  } else if (correction.leaderDisplayRu !== undefined) {
    // The historical source may still contain a natural person's name. Once
    // the legal entity has ceased activity, it must not be presented as a
    // current executive on ZakonExpert.
    result.leader = null;
    result.leader_display = correction.leaderDisplayRu;
  }

  return result;
}

module.exports = {
  COMPANY_CORRECTIONS,
  applyCompanyCorrection,
  getCompanyCorrection,
  normalizeBin,
};
