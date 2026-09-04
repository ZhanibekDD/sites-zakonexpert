'use strict';

const cron = require('node-cron');
const openDataPages = require('../modules/open-data-pages');
const { refreshOpenDataSnapshot } = require('../modules/open-data-refresh');
const { warmOpenDataRecordCache } = require('../modules/open-data-cache-warmer');
const { syncOpenDataInventory } = require('../scripts/sync-open-data-inventory');

function startBackgroundJobs(dependencies) {
  const {
    BACKGROUND_JOBS_ENABLED,
    EGOV_API_KEY,
    OPEN_DATA_RECORD_CACHE_ENABLED,
    OPEN_DATA_RECORD_CACHE_WARMER_ENABLED,
    newsDb,
    newsImporter,
    importNotaries,
    refreshNotariesRegistry,
    importBailiffs,
    commentsDb,
    clicksDb,
    leadsDb,
    chatDb,
    logger,
  } = dependencies;

  // Проверка обязательных env-переменных при старте
  if (!EGOV_API_KEY) {
      logger.error('КРИТИЧНО: Переменная окружения EGOV_API_KEY не задана. Функция проверки ИИН не будет работать. Задайте её в .env файле или в настройках сервера.');
  }

  // ===== NOTARY + BAILIFF DB: auto-import on startup if source is newer =====
  // This is data initialization, not an optional background job. It must run even
  // when cron/Telegram polling are disabled in production.
  setTimeout(async () => {
    if (importNotaries) {
      // Startup must be deterministic and fast. Network refresh belongs to the
      // daily cron/manual admin action; here we only import the validated local
      // snapshot when its version is newer than the DB.
      try {
        const count = await importNotaries();
        if (count > 0) logger.info(`[Notaries] DB ready: ${count} notaries`);
      } catch (e) { logger.warn('[Notaries] Startup import failed: ' + e.message); }
    }
    if (importBailiffs) {
      try {
        const count = await importBailiffs();
        if (count > 0) logger.info(`[Bailiffs] DB ready: ${count} bailiffs`);
      } catch (e) { logger.warn('[Bailiffs] Startup import failed: ' + e.message); }
    }
  }, 5000);

  if (BACKGROUND_JOBS_ENABLED) {

  // Daily refresh from the official ENIS registry, followed by a validated import.
  // Archive-transfer notes are free text in ENIS and can change without notice.
  cron.schedule('15 3 * * *', async () => {
    logger.info('[Cron] Daily notary+bailiff re-import starting...');
    if (importNotaries) {
      try {
        if (refreshNotariesRegistry) await refreshNotariesRegistry();
        const n = await importNotaries();
        logger.info(`[Cron] Notaries: ${n}`);
      }
      catch (e) { logger.error('[Cron] Notary re-import failed: ' + e.message); }
    }
    if (importBailiffs) {
      try { const n = await importBailiffs(); logger.info(`[Cron] Bailiffs: ${n}`); }
      catch (e) { logger.error('[Cron] Bailiff re-import failed: ' + e.message); }
    }
  });
  logger.info('Notary+Bailiff cron scheduled: daily 03:15');

  // The complete catalog is compact metadata (about 7 MB) and is refreshed
  // daily. Record materialisation starts after this metadata refresh.
  if (process.env.OPEN_DATA_AUTO_REFRESH !== 'false') {
    cron.schedule('20 4 * * *', async () => {
      logger.info('[Cron] Complete open-data catalog sync starting...');
      try {
        const inventory = await syncOpenDataInventory();
        logger.info(`[Cron] Open-data catalog synced: ${inventory.processedCount}/${inventory.expectedCount}, ${inventory.digest}`);
      } catch (error) {
        logger.error('[Cron] Open-data catalog sync failed: ' + error.message);
      }
    });
    logger.info('Open-data catalog cron scheduled: daily 04:20');
  }

  // Materialise official records as Brotli-compressed chunks only when an
  // operator explicitly opts the web process into this heavy job. On shared
  // Passenger hosting, traversing and writing thousands of cache files inside
  // the request-serving process can starve the event loop and make Passenger
  // report that the application could not be started. Production should run
  // `npm run cache-open-data-records` as a separate Plesk scheduled task instead.
  if (OPEN_DATA_RECORD_CACHE_WARMER_ENABLED) {
    const runOpenDataCacheWarm = async reason => {
      logger.info(`[Open data cache] ${reason}: materialisation starting...`);
      try {
        const result = await warmOpenDataRecordCache({
          apiKey: EGOV_API_KEY,
          datasets: openDataPages.listDatasets(),
          onProgress: progress => {
            if (progress.processed % 250 === 0) {
              logger.info(`[Open data cache] ${progress.phase}: ${progress.processed}/${progress.total}, ${Math.round(progress.bytes / 1024 / 1024)} MB`);
            }
          },
        });
        logger.info(`[Open data cache] finished: ${result.completed} complete, ${result.failures.length} errors, ${Math.round(result.bytes / 1024 / 1024)} MB${result.stoppedForSpace ? ', disk limit reached' : ''}`);
      } catch (error) {
        logger.error('[Open data cache] materialisation failed: ' + error.message);
      }
    };
    cron.schedule('45 4 * * *', () => runOpenDataCacheWarm('daily'));
    const startupCacheTimer = setTimeout(() => runOpenDataCacheWarm('startup'), 45_000);
    startupCacheTimer.unref?.();
    logger.info('Open-data record cache warmer scheduled in web process: startup + daily 04:45');
  } else if (OPEN_DATA_RECORD_CACHE_ENABLED) {
    logger.info('Open-data record cache enabled; bulk warmer delegated to an external scheduled task');
  }

  // Optional statistical aggregates for the older curated landing pages.
  if (EGOV_API_KEY && process.env.OPEN_DATA_AGGREGATE_REFRESH === 'true') {
    cron.schedule('35 4 * * 1', async () => {
      logger.info('[Cron] Curated open-data aggregate refresh starting...');
      try {
        const snapshot = await refreshOpenDataSnapshot({ apiKey: EGOV_API_KEY });
        logger.info(`[Cron] Curated open data refreshed: ${snapshot.digest}`);
      } catch (error) {
        logger.error('[Cron] Curated open-data refresh failed: ' + error.message);
      }
    });
    logger.info('Curated open-data aggregate cron scheduled: Monday 04:35');
  }

  // ===== SCHEDULED NEWS IMPORT (every 4 hours) =====
  if (newsImporter) {
    // Run import every 4 hours
    cron.schedule('0 */4 * * *', async () => {
      logger.info('[Cron] Starting scheduled news import...');
      try {
        const count = await newsImporter.importAll();
        logger.info(`[Cron] News import done. Imported: ${count}`);
      } catch (e) {
        logger.error('[Cron] News import failed: ' + e.message);
      }
    });
    logger.info('News cron scheduled: every 4 hours');

    // Run an initial import after startup when the feed is empty or stale.
    setTimeout(async () => {
      try {
        const existing = await newsDb.countPublished();
        const latestPublishedAt = await newsDb.getLatestPublishedAt();
        const lastImportTime = newsImporter.getLastImportInfo().lastImportTime;
        const freshnessReference = lastImportTime || latestPublishedAt;
        const stale = !freshnessReference || Date.now() - new Date(freshnessReference).getTime() > 6 * 60 * 60 * 1000;
        if (existing === 0 || stale) {
          logger.info(`[Startup] News feed ${existing === 0 ? 'empty' : 'stale'}, running import...`);
          await newsImporter.importAll();
          logger.info('[Startup] Initial import done.');
        }
      } catch (e) {
        logger.warn('[Startup] Initial import check failed: ' + e.message);
      }
    }, 10000);
  }
  } else {
    logger.info('Background jobs disabled by DISABLE_BACKGROUND_JOBS');
  }

  // Enforce the public retention policy for site-only lead, chat and analytics
  // records. Contract/accounting documents are stored in separate workflows.
  setTimeout(() => {
    const day = 24 * 60 * 60 * 1000;
    clicksDb?.purgeOlderThan(Date.now() - 395 * day).catch(error => logger.warn('[Privacy] Click cleanup failed: ' + error.message));
    leadsDb?.purgeOlderThan(Date.now() - 730 * day).catch(error => logger.warn('[Privacy] Lead cleanup failed: ' + error.message));
    chatDb?.purgeOlderThan(Date.now() - 365 * day).catch(error => logger.warn('[Privacy] Chat cleanup failed: ' + error.message));
    commentsDb?.purgeModeratorIps(Date.now() - 90 * day).catch(error => logger.warn('[Privacy] Comment IP cleanup failed: ' + error.message));
  }, 15000);

}

module.exports = { startBackgroundJobs };
