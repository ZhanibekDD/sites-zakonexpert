'use strict';

const express = require('express');
const { createHttpHelpers } = require('./http/helpers');
const { createRateLimits } = require('./http/rate-limits');
const { installMiddleware } = require('./http/middleware');
const { installErrorHandlers } = require('./http/errors');
const { createCatalogData } = require('./catalog-data');
const { createNewsFormat } = require('./news-format');
const { registerNotaryRoutes } = require('./routes/notaries');
const { registerBailiffRoutes } = require('./routes/bailiffs');
const { registerCompanyRoutes } = require('./routes/companies');
const { registerCatalogRoutes } = require('./routes/catalogs');
const { registerMarketingRoutes } = require('./routes/marketing');
const { registerLawRoutes } = require('./routes/laws');
const { registerCheckRoutes } = require('./routes/checks');
const { registerNewsRoutes } = require('./routes/news');
const { registerSitemapRoutes } = require('./routes/sitemaps');
const { registerEngagementRoutes } = require('./routes/engagement');
const { registerHealthRoutes } = require('./routes/health');
const { registerOpenDataRoutes } = require('./routes/open-data');
const { registerSearchRoutes } = require('./routes/search');
const { registerToolRoutes } = require('./routes/tools');
const { registerAdminMethods } = require('./routes/admin-methods');

// Build HTTP handlers only: no listen, cron, imports, polling or retention jobs.
// Runtime dependencies can be replaced with isolated test adapters.
function createApp({ config, services, logger }) {
  const app = express();
  const dependencies = {
    ...config,
    ...services,
    logger,
    ...createHttpHelpers({ logger }),
    ...createRateLimits(),
    ...createCatalogData(),
    ...createNewsFormat(),
  };

  // Canonical redirects, private-data guard and static assets always run first.
  installMiddleware(app, dependencies);
  registerNotaryRoutes(app, dependencies);
  registerBailiffRoutes(app, dependencies);
  registerCompanyRoutes(app, dependencies);
  registerCatalogRoutes(app, dependencies);
  registerMarketingRoutes(app, dependencies);
  registerLawRoutes(app, dependencies);
  registerCheckRoutes(app, dependencies);
  registerNewsRoutes(app, dependencies);
  registerSitemapRoutes(app, dependencies);
  registerEngagementRoutes(app, dependencies);
  registerHealthRoutes(app, dependencies);
  registerOpenDataRoutes(app, dependencies);
  registerSearchRoutes(app, dependencies);
  registerToolRoutes(app, dependencies);
  registerAdminMethods(app, dependencies);
  // Real 404 and sanitized error handling must remain last.
  installErrorHandlers(app, dependencies);
  return app;
}

module.exports = { createApp };
