'use strict';

// Passenger and npm keep the same entrypoint. Load environment before services.
require('dotenv').config();

const { startServer } = require('./app/start');
module.exports = startServer();
