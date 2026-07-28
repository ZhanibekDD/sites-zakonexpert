'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const TEXT_EXTENSIONS = new Set([
  '.css', '.ejs', '.html', '.js', '.json', '.md', '.svg', '.txt', '.xml', '.yml', '.yaml',
]);
const SKIP_DIRECTORIES = new Set(['.git', 'data', 'node_modules', 'registry']);
const failures = [];

function scanDirectory(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name.startsWith('.') && entry.name !== '.well-known') continue;
    if (entry.isDirectory() && SKIP_DIRECTORIES.has(entry.name)) continue;

    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      scanDirectory(absolutePath);
      continue;
    }
    if (!entry.isFile() || !TEXT_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue;

    const content = fs.readFileSync(absolutePath, 'utf8');
    for (let offset = 0; offset < content.length; offset += 1) {
      const code = content.charCodeAt(offset);
      if ((code < 32 && code !== 9 && code !== 10 && code !== 13) || code === 127) {
        failures.push({
          file: path.relative(ROOT, absolutePath),
          offset,
          code: `U+${code.toString(16).toUpperCase().padStart(4, '0')}`,
        });
        break;
      }
    }
  }
}

scanDirectory(ROOT);

if (failures.length) {
  console.error('Forbidden control characters found:');
  failures.forEach(item => console.error(`- ${item.file} at byte/character ${item.offset}: ${item.code}`));
  process.exit(1);
}

console.log('Source integrity OK: no forbidden control characters');
