'use strict';

// Private CRM bootstrap. The CRM is intentionally independent from Telegram. It is mounted
// before the public routes; the normal site server then starts unchanged. Contract records
// arrive through the protected CRM API, while contract creation is proxied to the dedicated
// dogovora-zakon-Expert service.

require('dotenv').config();

const { installCrm } = require('./modules/crm-routes');
const { installCrmGeneratorCreate } = require('./modules/crm-generator-create');

// Wrap express() so CRM routes are registered before the public app's final catch-all 404
// without editing the large production server.js.
const expressModuleId = require.resolve('express');
const originalExpress = require(expressModuleId);
function expressWithCrm(...args) {
  const app = originalExpress(...args);
  // Install the generator helper first so it can inject the optional generator UI into the
  // authenticated CRM render before the main CRM route sends the page.
  installCrmGeneratorCreate(app, originalExpress);
  installCrm(app, originalExpress);
  return app;
}
Object.assign(expressWithCrm, originalExpress);
Object.setPrototypeOf(expressWithCrm, originalExpress);
require.cache[expressModuleId].exports = expressWithCrm;

require('./server');
