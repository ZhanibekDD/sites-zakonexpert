'use strict';

const { loadConfig } = require('./config');
const { createLogger } = require('./logger');
const { createServices } = require('./services');

function createRuntime() {
  const config = loadConfig();
  const { logger } = createLogger();
  const services = createServices({ ...config, logger });
  return { config, logger, services };
}

module.exports = { createRuntime };
