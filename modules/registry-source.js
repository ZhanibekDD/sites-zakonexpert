'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');

const FORMAT = 'zakonexpert.registry.v1';

function validateDocument(document, expectedEntity) {
  if (!document || document.format !== FORMAT) {
    throw new Error(`Unsupported registry format (expected ${FORMAT})`);
  }
  if (document.entity !== expectedEntity) {
    throw new Error(`Unexpected registry entity: ${document.entity || 'missing'} (expected ${expectedEntity})`);
  }
  if (!Array.isArray(document.records)) {
    throw new Error('Registry records must be an array');
  }
  return document;
}

function readRegistrySource(filename, expectedEntity) {
  const compressed = fs.readFileSync(filename);
  const document = JSON.parse(zlib.gunzipSync(compressed).toString('utf8'));
  const stat = fs.statSync(filename);
  return {
    ...validateDocument(document, expectedEntity),
    sourceMtime: stat.mtimeMs,
    // File mtimes are not stable across Git/Plesk deployments. A content
    // fingerprint makes import decisions deterministic.
    sourceFingerprint: crypto.createHash('sha256').update(compressed).digest('hex'),
  };
}

function writeRegistrySource(filename, entity, records, metadata = {}) {
  if (!Array.isArray(records)) throw new TypeError('Registry records must be an array');

  const document = {
    format: FORMAT,
    entity,
    generatedAt: new Date().toISOString(),
    ...metadata,
    records,
  };
  const compressed = zlib.gzipSync(Buffer.from(JSON.stringify(document)), { level: 9 });
  const directory = path.dirname(filename);
  const temporary = `${filename}.${process.pid}.tmp`;

  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(temporary, compressed);
  fs.renameSync(temporary, filename);
  return document;
}

module.exports = { FORMAT, readRegistrySource, writeRegistrySource };
