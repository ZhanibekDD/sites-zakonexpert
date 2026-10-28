'use strict';

const fs = require('fs');
const path = require('path');
const Datastore = require('nedb-promises');
const { enableAutocompaction } = require('./db-maintenance');

// Public reads and refreshes share one in-memory index. Independent instances
// of the same NeDB file can overwrite each other during compaction.
const filename = process.env.NOTARIES_DB_PATH
  || path.join(__dirname, '..', 'data', 'notaries.db');
fs.mkdirSync(path.dirname(filename), { recursive: true });
const db = Datastore.create({ filename, autoload: true });
enableAutocompaction(db);

module.exports = db;
