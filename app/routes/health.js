'use strict';

const { getOpenDataCacheJobStatus } = require('../../modules/open-data-cache-warmer');

function registerHealthRoutes(app, dependencies) {
  const {
    EGOV_API_KEY,
    OPEN_DATA_RECORD_CACHE_ENABLED,
    OPEN_DATA_RECORD_CACHE_WARMER_ENABLED,
    RELEASE_ID,
    companiesDb,
    kgdCounterparty,
    goszakup,
  } = dependencies;

  // Health-check для мониторинга сервиса
  app.get('/health', (req, res) => {
      const companyStats = companiesDb ? companiesDb.stats() : null;
      const openDataCache = getOpenDataCacheJobStatus();
      res.json({
          status: 'ok',
          service: 'ZakonExpert',
          release: RELEASE_ID,
          egovKey: EGOV_API_KEY ? 'configured' : 'missing',
          kgdApi: kgdCounterparty.configured ? 'configured' : 'missing',
          goszakupApi: goszakup.configured ? 'configured' : 'missing',
          openDataCache: {
              enabled: OPEN_DATA_RECORD_CACHE_ENABLED,
              warmerEnabled: OPEN_DATA_RECORD_CACHE_WARMER_ENABLED,
              status: OPEN_DATA_RECORD_CACHE_WARMER_ENABLED && openDataCache.status === 'idle'
                ? 'scheduled'
                : (OPEN_DATA_RECORD_CACHE_ENABLED && openDataCache.status === 'idle' ? 'external' : openDataCache.status),
              phase: openDataCache.phase,
              processed: openDataCache.processed,
              total: openDataCache.total,
              completed: openDataCache.completed,
              cachedRows: openDataCache.cachedRows,
              megabytes: Math.round((openDataCache.bytes || 0) / 1024 / 1024),
              errors: openDataCache.errors,
              startedAt: openDataCache.startedAt,
              finishedAt: openDataCache.finishedAt
          },
          companies: companyStats ? {
              available: companyStats.available,
              count: companyStats.count,
              qualityReady: companyStats.qualityReady,
              indexableCount: companyStats.indexableCount
          } : null,
          time: new Date().toISOString()
      });
  });

}

module.exports = { registerHealthRoutes };
