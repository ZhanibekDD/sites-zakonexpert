'use strict';

const releaseConfig = require('../modules/release-config');

const DEFAULT_ORIGIN = 'https://zakonexpertt.kz';
const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_SLOW_MS = 4000;

function normalizeOrigin(value) {
  return String(value || DEFAULT_ORIGIN).replace(/\/+$/, '');
}

async function request(fetchImpl, origin, pathname, timeoutMs) {
  const startedAt = Date.now();
  const response = await fetchImpl(`${origin}${pathname}`, {
    redirect: 'follow',
    headers: {
      accept: pathname === '/health' ? 'application/json' : 'text/html',
      'user-agent': 'ZakonExpert-Release-Monitor/1.0',
    },
    signal: AbortSignal.timeout(timeoutMs),
  });
  const body = await response.text();
  return {
    body,
    contentType: response.headers.get('content-type') || '',
    ms: Date.now() - startedAt,
    status: response.status,
    url: response.url,
  };
}

async function checkLiveRelease(options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  const origin = normalizeOrigin(options.origin || process.env.MONITOR_ORIGIN);
  const timeoutMs = Number(options.timeoutMs || process.env.MONITOR_TIMEOUT_MS || DEFAULT_TIMEOUT_MS);
  const slowMs = Number(options.slowMs || process.env.MONITOR_SLOW_MS || DEFAULT_SLOW_MS);
  const expectedRelease = options.expectedRelease
    || process.env.MONITOR_EXPECTED_RELEASE
    || releaseConfig.id;
  const errors = [];
  const warnings = [];
  const checks = {};

  try {
    const health = await request(fetchImpl, origin, '/health', timeoutMs);
    checks.health = { status: health.status, ms: health.ms };
    if (health.status !== 200) {
      errors.push(`/health returned ${health.status}`);
    } else if (!health.contentType.includes('application/json')) {
      errors.push('/health did not return JSON');
    } else {
      const payload = JSON.parse(health.body);
      checks.release = payload.release || null;
      checks.serviceStatus = payload.status || null;
      if (payload.status !== 'ok') errors.push(`/health status is ${payload.status || 'missing'}`);
      if (payload.release !== expectedRelease) {
        errors.push(`stale release: expected ${expectedRelease}, received ${payload.release || 'missing'}`);
      }
    }
    if (health.ms > slowMs) warnings.push(`/health was slow (${health.ms} ms)`);
  } catch (error) {
    errors.push(`/health failed: ${error.message}`);
  }

  try {
    const homepage = await request(fetchImpl, origin, '/', timeoutMs);
    checks.homepage = { status: homepage.status, ms: homepage.ms };
    if (homepage.status !== 200) errors.push(`/ returned ${homepage.status}`);
    if (!homepage.contentType.includes('text/html')) errors.push('/ did not return HTML');
    for (const asset of releaseConfig.assets) {
      if (!homepage.body.includes(asset)) errors.push(`homepage is missing release asset ${asset}`);
    }
    for (const text of releaseConfig.requiredHomepageText) {
      if (!homepage.body.includes(text)) errors.push(`homepage is missing required text: ${text}`);
    }
    if (homepage.ms > slowMs) warnings.push(`/ was slow (${homepage.ms} ms)`);
  } catch (error) {
    errors.push(`/ failed: ${error.message}`);
  }

  for (const pathname of ['/contact', '/reviews']) {
    try {
      const result = await request(fetchImpl, origin, pathname, timeoutMs);
      checks[pathname.slice(1)] = { status: result.status, ms: result.ms, url: result.url };
      if (result.status !== 200) errors.push(`${pathname} returned ${result.status}`);
      if (result.ms > slowMs) warnings.push(`${pathname} was slow (${result.ms} ms)`);
    } catch (error) {
      errors.push(`${pathname} failed: ${error.message}`);
    }
  }

  return {
    checkedAt: new Date().toISOString(),
    checks,
    errors,
    expectedRelease,
    ok: errors.length === 0,
    origin,
    warnings,
  };
}

async function main() {
  const report = await checkLiveRelease();
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exitCode = 1;
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = { checkLiveRelease, normalizeOrigin };
