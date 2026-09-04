'use strict';

const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');

// Explicit roots prevent build outputs, databases and dependencies entering checks.
function listSourceFiles(directory, extensions = new Set(['.js'])) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name, 'en'))
    .flatMap(entry => {
      if (entry.name.startsWith('.') || entry.isSymbolicLink()) return [];
      const filename = path.join(directory, entry.name);
      if (entry.isDirectory()) return listSourceFiles(filename, extensions);
      return entry.isFile() && extensions.has(path.extname(entry.name)) ? [filename] : [];
    });
}

function listServerFiles() {
  return [path.join(ROOT, 'server.js'), ...listSourceFiles(path.join(ROOT, 'app'))];
}

function readServerSource() {
  return listServerFiles().map(filename => fs.readFileSync(filename, 'utf8')).join('\n');
}

module.exports = { ROOT, listSourceFiles, listServerFiles, readServerSource };
