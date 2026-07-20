'use strict';

const QUALITY_VERSION = '1';
const DEFAULT_MIN_SCORE = 7;

function hasText(value, minLength = 1) {
  return String(value == null ? '' : value).trim().length >= minLength;
}

function qualityScore(company = {}) {
  let score = 0;
  if (/^\d{12}$/.test(String(company.bin || '').trim())) score += 2;
  if (hasText(company.name_ru || company.nameRu || company.name_kk || company.nameKk, 3)) score += 1;
  if (hasText(company.name_kk || company.nameKk, 3)) score += 1;
  if (hasText(company.registration_date || company.registrationDate, 4)) score += 1;
  if (hasText(company.address_ru || company.addressRu, 8)) score += 1;
  if (hasText(company.activity_ru || company.activityRu, 3)) score += 1;
  if (hasText(company.leader, 3)) score += 1;
  if (hasText(company.status_ru || company.statusRu, 3)) score += 1;
  if (hasText(company.region_slug || company.regionSlug, 2)) score += 1;
  return score;
}

function minScore() {
  const configured = Number.parseInt(process.env.COMPANY_INDEX_MIN_SCORE, 10);
  return Number.isInteger(configured) && configured >= 4 && configured <= 10
    ? configured
    : DEFAULT_MIN_SCORE;
}

function evaluateCompany(company) {
  const score = qualityScore(company);
  const hasValidBin = /^\d{12}$/.test(String(company?.bin || '').trim());
  const hasName = hasText(company?.name_ru || company?.nameRu || company?.name_kk || company?.nameKk, 3);
  return {
    score,
    minScore: minScore(),
    indexable: hasValidBin && hasName && score >= minScore(),
  };
}

// Mirrors qualityScore() for a persisted SQLite backfill. Keeping the result in
// the table lets 800k+ records be filtered and paginated without a full scan on
// every crawler request.
const QUALITY_SCORE_SQL = `
  (CASE WHEN length(trim(COALESCE(bin, ''))) = 12 AND trim(bin) NOT GLOB '*[^0-9]*' THEN 2 ELSE 0 END)
  + (CASE WHEN length(trim(COALESCE(name_ru, name_kk, ''))) >= 3 THEN 1 ELSE 0 END)
  + (CASE WHEN length(trim(COALESCE(name_kk, ''))) >= 3 THEN 1 ELSE 0 END)
  + (CASE WHEN length(trim(COALESCE(registration_date, ''))) >= 4 THEN 1 ELSE 0 END)
  + (CASE WHEN length(trim(COALESCE(address_ru, ''))) >= 8 THEN 1 ELSE 0 END)
  + (CASE WHEN length(trim(COALESCE(activity_ru, ''))) >= 3 THEN 1 ELSE 0 END)
  + (CASE WHEN length(trim(COALESCE(leader, ''))) >= 3 THEN 1 ELSE 0 END)
  + (CASE WHEN length(trim(COALESCE(status_ru, ''))) >= 3 THEN 1 ELSE 0 END)
  + (CASE WHEN length(trim(COALESCE(region_slug, ''))) >= 2 THEN 1 ELSE 0 END)
`;

module.exports = {
  DEFAULT_MIN_SCORE,
  QUALITY_SCORE_SQL,
  QUALITY_VERSION,
  evaluateCompany,
  minScore,
  qualityScore,
};
