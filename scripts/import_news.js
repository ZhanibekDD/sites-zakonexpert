#!/usr/bin/env node
/**
 * ZakonExpert — News Import Script
 * Run manually: node scripts/import_news.js
 * Or schedule via cron
 */
require('dotenv').config();
const { importAll } = require('../modules/news_importer');

(async () => {
  try {
    const count = await importAll();
    console.log(`Import completed. Articles imported: ${count}`);
    process.exit(0);
  } catch (err) {
    console.error('Import failed:', err.message);
    process.exit(1);
  }
})();
