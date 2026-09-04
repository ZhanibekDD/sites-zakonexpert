'use strict';

const path = require('path');
const { spawnSync } = require('child_process');
const { ROOT, listSourceFiles, listServerFiles } = require('./lib/source-files');

const files = [...new Set([
  ...listServerFiles(),
  ...['modules', 'public/js', 'scripts'].flatMap(directory => listSourceFiles(path.join(ROOT, directory))),
])];
let failed = 0;
for (const filename of files) {
  const result = spawnSync(process.execPath, ['--check', filename], { encoding: 'utf8' });
  if (result.status !== 0 || result.error) {
    failed += 1;
    console.error(path.relative(ROOT, filename));
    console.error(result.error?.message || result.stderr || `Syntax check exited ${result.status}`);
  }
}
console.log(`JavaScript syntax: ${files.length} files, ${failed} errors`);
if (failed) process.exitCode = 1;
