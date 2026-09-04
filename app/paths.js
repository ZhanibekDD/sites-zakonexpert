'use strict';

const path = require('path');

// Resolve all assets and data relative to the checkout, never the launch directory.
const ROOT_DIR = path.join(__dirname, '..');

module.exports = { ROOT_DIR };
