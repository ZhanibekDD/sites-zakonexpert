'use strict';

const { spawnSync } = require('child_process');
const { getEventStats } = require('../modules/clicks-db');

const DAY_MS = 24 * 60 * 60 * 1000;

async function main() {
  const audit = spawnSync(process.execPath, ['scripts/live-audit.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      AUDIT_EXPECTED_RELEASE: process.env.AUDIT_EXPECTED_RELEASE || '2026-08-04-seo-growth-v1',
      AUDIT_COMPANY_RESPONSE_MS: process.env.AUDIT_COMPANY_RESPONSE_MS || '800',
    },
    encoding: 'utf8',
  });
  if (audit.stdout) process.stdout.write(audit.stdout);
  if (audit.stderr) process.stderr.write(audit.stderr);

  const stats = await getEventStats(Date.now() - DAY_MS);
  console.log('\nCompany conversion events (last 24 hours)');
  console.log(JSON.stringify(stats, null, 2));

  if (audit.error) throw audit.error;
  if (audit.status !== 0) process.exitCode = audit.status || 1;
}

if (require.main === module) {
  main().catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = { main };
