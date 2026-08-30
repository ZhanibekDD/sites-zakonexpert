'use strict';

// Private CRM bootstrap. The CRM is intentionally independent from Telegram and from the
// contract generator transport. It is mounted before the public routes; the normal site
// server then starts unchanged. Contract data arrives through the protected CRM API.

require('dotenv').config();

const { installCrm } = require('./modules/crm-routes');

// Wrap express() so CRM routes are registered before the public app's final catch-all 404
// without editing the large production server.js.
const expressModuleId = require.resolve('express');
const originalExpress = require(expressModuleId);
function expressWithCrm(...args) {
  const app = originalExpress(...args);
  installCrm(app, originalExpress);
  return app;
}
Object.assign(expressWithCrm, originalExpress);
Object.setPrototypeOf(expressWithCrm, originalExpress);
require.cache[expressModuleId].exports = expressWithCrm;

require('./server');
