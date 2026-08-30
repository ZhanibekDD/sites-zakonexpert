'use strict';

// Private CRM bootstrap. The CRM is independent from Telegram. It is mounted before the
// public routes; the normal site server then starts unchanged. Contract creation and import
// use the canonical dogovora-zakon-Expert service through an outbound-pull queue.

require('dotenv').config();

const { installCrm } = require('./modules/crm-routes');
const { installCrmGeneratorCreate } = require('./modules/crm-generator-create');
const { installCrmImportPull } = require('./modules/crm-import-pull');
const { installCrmUiPolish } = require('./modules/crm-ui-polish');

// Wrap express() so CRM routes are registered before the public app's final catch-all 404
// without editing the large production server.js.
const expressModuleId = require.resolve('express');
const originalExpress = require(expressModuleId);
function expressWithCrm(...args) {
  const app = originalExpress(...args);
  // Order matters: queued import handles parse jobs first; generator creation handles normal
  // jobs and injects its UI; UI polish corrects the connection indicator for pull mode; the
  // main CRM router then provides Kanban/auth and the remaining APIs.
  installCrmImportPull(app, originalExpress);
  installCrmGeneratorCreate(app, originalExpress);
  installCrmUiPolish(app);
  installCrm(app, originalExpress);
  return app;
}
Object.assign(expressWithCrm, originalExpress);
Object.setPrototypeOf(expressWithCrm, originalExpress);
require.cache[expressModuleId].exports = expressWithCrm;

require('./server');
