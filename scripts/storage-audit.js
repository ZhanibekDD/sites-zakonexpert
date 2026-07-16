'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SKIP_DIRS = new Set(['.git']);

function walk(dir, files = []) {
  if (!fs.existsSync(dir)) return files;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory() && SKIP_DIRS.has(entry.name)) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(fullPath, files);
    else if (entry.isFile()) files.push({ path: fullPath, size: fs.statSync(fullPath).size });
  }
  return files;
}

function bytes(value) {
  if (value < 1024) return `${value} B`;
  const units = ['KB', 'MB', 'GB'];
  let amount = value;
  let unit = -1;
  do {
    amount /= 1024;
    unit += 1;
  } while (amount >= 1024 && unit < units.length - 1);
  return `${amount.toFixed(amount >= 10 ? 1 : 2)} ${units[unit]}`;
}

function total(files) {
  return files.reduce((sum, file) => sum + file.size, 0);
}

const files = walk(ROOT);
console.log(`Project (without .git): ${bytes(total(files))}`);

for (const directory of ['node_modules', 'data', 'public']) {
  console.log(`${directory}: ${bytes(total(walk(path.join(ROOT, directory), [])))}`);
}

const logs = files.filter(file => /(?:^|\/)(?:app|exceptions|rejections)(?:\.?\d+)?\.log$/i.test(file.path));
console.log(`application logs: ${bytes(total(logs))}`);

console.log('\nLargest files:');
files
  .sort((a, b) => b.size - a.size)
  .slice(0, 20)
  .forEach(file => console.log(`${bytes(file.size).padStart(10)}  ${path.relative(ROOT, file.path)}`));
