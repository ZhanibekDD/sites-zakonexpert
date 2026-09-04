'use strict';

const release = require('../modules/release-config');

function loadConfig() {
  const PORT = process.env.PORT || 3000;
  const BACKGROUND_JOBS_ENABLED = !/^(1|true|yes)$/i.test(process.env.DISABLE_BACKGROUND_JOBS || '');
  const KGD_API_TOKEN = String(process.env.KGD_API_TOKEN || '').trim();
  const KGD_API_BASE_URL = process.env.KGD_API_BASE_URL || 'https://portal.kgd.gov.kz';
  const GOSZAKUP_API_TOKEN = String(process.env.GOSZAKUP_API_TOKEN || '').trim();
  const GOSZAKUP_API_BASE_URL = process.env.GOSZAKUP_API_BASE_URL || 'https://ows.goszakup.gov.kz';
  const EGOV_API_URL = 'https://data.egov.kz/egov-opendata-ws/ODWebServiceImpl';
  const EGOV_API_KEY = process.env.EGOV_API_KEY;
  const OPEN_DATA_RECORD_CACHE_ENABLED = Boolean(EGOV_API_KEY && process.env.OPEN_DATA_RECORD_CACHE !== 'false');
  const OPEN_DATA_RECORD_CACHE_WARMER_ENABLED = Boolean(
    OPEN_DATA_RECORD_CACHE_ENABLED
    && /^(1|true|yes)$/i.test(process.env.OPEN_DATA_RECORD_CACHE_WARMER || '')
  );
  const RELEASE_ID = release.id;
  return Object.freeze({
    PORT, BACKGROUND_JOBS_ENABLED,
    KGD_API_TOKEN, KGD_API_BASE_URL, GOSZAKUP_API_TOKEN, GOSZAKUP_API_BASE_URL,
    EGOV_API_URL, EGOV_API_KEY, OPEN_DATA_RECORD_CACHE_ENABLED,
    OPEN_DATA_RECORD_CACHE_WARMER_ENABLED, RELEASE_ID,
  });
}

module.exports = { loadConfig };
