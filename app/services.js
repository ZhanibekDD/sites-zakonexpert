'use strict';

const axios = require('axios');
const { createKgdCounterpartyClient } = require('../modules/kgd-counterparty');
const { createGoszakupClient } = require('../modules/goszakup');
const { createCompanyCheckService } = require('../modules/company-check-sources');

const telegram = require('../modules/telegram');

function createServices(dependencies) {
  const { KGD_API_TOKEN, KGD_API_BASE_URL, GOSZAKUP_API_TOKEN, GOSZAKUP_API_BASE_URL, logger } = dependencies;

  // Initialize DB and news importer
  let newsDb = null;
  let newsImporter = null;
  try {
    newsDb = require('../modules/db');
    newsImporter = require('../modules/news_importer');
    logger.info('News module loaded ✓');
  } catch (e) {
    logger.warn('News module not loaded: ' + e.message);
  }

  // Initialize notaries DB
  let notariesDb = null;
  let importNotaries = null;
  let refreshNotariesRegistry = null;
  try {
    notariesDb  = require('../modules/notaries-db');
    ({ importNotaries } = require('../scripts/import-notaries'));
    ({ refreshNotariesRegistry } = require('../scripts/refresh-notaries-csv'));
    logger.info('Notaries module loaded ✓');
  } catch (e) {
    logger.warn('Notaries module not loaded: ' + e.message);
  }

  // Initialize bailiffs DB
  let bailiffsDb = null;
  let importBailiffs = null;
  try {
    bailiffsDb  = require('../modules/bailiffs-db');
    ({ importBailiffs } = require('../scripts/import-bailiffs'));
    logger.info('Bailiffs module loaded ✓');
  } catch (e) {
    logger.warn('Bailiffs module not loaded: ' + e.message);
  }

  // Initialize comments DB
  let commentsDb = null;
  try {
    commentsDb = require('../modules/comments-db');
    logger.info('Comments module loaded ✓');
  } catch (e) {
    logger.warn('Comments module not loaded: ' + e.message);
  }

  // Initialize the large Kazakhstan companies registry (SQLite, loaded on demand)
  let companiesDb = null;
  let regionLabel = () => null;
  try {
    companiesDb = require('../modules/companies-db');
    regionLabel = require('../modules/company-region').regionLabel;
    logger.info('Companies module loaded ✓');
  } catch (e) {
    logger.warn('Companies module not loaded: ' + e.message);
  }

  // Initialize laws DB
  let lawsDb = null;
  try {
    lawsDb = require('../modules/laws-db');
    logger.info('Laws module loaded ✓');
  } catch (e) {
    logger.warn('Laws module not loaded: ' + e.message);
  }

  const kgdCounterparty = createKgdCounterpartyClient({
    token: KGD_API_TOKEN,
    baseUrl: KGD_API_BASE_URL,
    http: axios,
  });

  const goszakup = createGoszakupClient({
    token: GOSZAKUP_API_TOKEN,
    baseUrl: GOSZAKUP_API_BASE_URL,
    http: axios,
  });
  const companyCheckService = createCompanyCheckService({
    companiesDb,
    kgdClient: kgdCounterparty,
    goszakupClient: goszakup,
  });

  let clicksDb = null;
  try { clicksDb = require('../modules/clicks-db'); } catch (e) { logger.warn('clicks-db not loaded: ' + e.message); }

  let leadsDb = null;
  try { leadsDb = require('../modules/leads-db'); } catch (e) { logger.warn('leads-db not loaded: ' + e.message); }

  // ===== LIVE CHAT (widget → Telegram, owner replies via Telegram Reply) =====
  let chatDb = null;
  try { chatDb = require('../modules/chat-db'); } catch (e) { logger.warn('chat-db not loaded: ' + e.message); }

  return { telegram, newsDb, newsImporter, notariesDb, importNotaries, refreshNotariesRegistry, bailiffsDb, importBailiffs, commentsDb, companiesDb, regionLabel, lawsDb, clicksDb, leadsDb, chatDb, kgdCounterparty, goszakup, companyCheckService };
}

module.exports = { createServices };
