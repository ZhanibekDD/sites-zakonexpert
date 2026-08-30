'use strict';

// Private CRM bootstrap. The CRM is independent from Telegram. It is mounted before the
// public routes; the normal site server then starts unchanged. Contract creation and import
// use the canonical dogovora-zakon-Expert service through an outbound-pull queue.

require('dotenv').config();

const { installCrm } = require('./modules/crm-routes');
const { installCrmGeneratorCreate } = require('./modules/crm-generator-create');
const { installCrmImportPull } = require('./modules/crm-import-pull');

// Wrap express() so CRM routes are registered before the public app's final catch-all 404
// without editing the large production server.js.
const expressModuleId = require.resolve('express');
const originalExpress = require(expressModuleId);
function expressWithCrm(...args) {
  const app = originalExpress(...args);
  // Order matters: queued import shadows the old synchronous importer and handles parse-job
  // completion first; generator creation handles normal job completion next; the main CRM
  // router then provides the Kanban, auth and remaining APIs.
  installCrmImportPull(app, originalExpress);
  installCrmGeneratorCreate(app, originalExpress);
  installCrm(app, originalExpress);
  return app;
}
Object.assign(expressWithCrm, originalExpress);
Object.setPrototypeOf(expressWithCrm, originalExpress);
require.cache[expressModuleId].exports = expressWithCrm;

require('./server');
