'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');
const history = require('../config/notary-history.json');
const { resolveNotaryProfile } = require('../modules/notary-history');
const { readRegistrySource, writeRegistrySource } = require('../modules/registry-source');

async function main() {
  assert.equal(history.records.length, 5);
  for (const entry of history.records) {
    const archived = resolveNotaryProfile(entry.slug, null);
    assert.equal(archived.active, null, 'absence must not invent an active or terminated status');
    for (const field of ['phone', 'email', 'address', 'schedule']) assert.equal(archived[field], undefined);
    assert.equal(resolveNotaryProfile(entry.slug, null, { isSuppressed: id => id === entry.license }), null,
      'a privacy removal must suppress the historical fallback too');
    const current = { ...entry, active: true, sourceFingerprint: 'fresh-official-record' };
    assert.equal(resolveNotaryProfile(entry.slug, current), current, 'current data must win over history');
    const terminated = { ...current, active: false };
    assert.equal(resolveNotaryProfile(entry.slug, terminated), terminated, 'a confirmed termination must survive');
    const noindex = { ...current, privacy_noindex: true };
    assert.equal(resolveNotaryProfile(entry.slug, noindex), noindex, 'noindex alone must not cause a 404');
  }
  assert.equal(resolveNotaryProfile('unreviewed-missing-notary', null), null,
    'unknown URLs must remain real 404s');

  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'ze-notary-history-'));
  process.env.NOTARIES_DB_PATH = path.join(temporary, 'notaries.db');
  const db = require('../modules/notaries-store');
  const publicDb = require('../modules/notaries-db');
  const { importNotaries } = require('./import-notaries');
  let server;
  try {
    assert.equal(await publicDb.count(), 0, 'public instance must load before import for this regression test');
    const source = readRegistrySource(path.join(__dirname, '..', 'registry', 'notaries.json.gz'), 'notaries');
    const [imported, parallelImported] = await Promise.all([importNotaries(), importNotaries()]);
    assert.equal(imported, source.records.length);
    assert.equal(parallelImported, imported);
    assert.equal(await publicDb.count(), imported, 'already-loaded public reads must immediately see the import');
    const importedRows = await db.find({}, { slug: 1 });
    assert.equal(new Set(importedRows.map(record => record.slug)).size, imported,
      'parallel imports must not insert duplicate notaries');
    assert.equal(await publicDb.getLastUpdated(), source.generatedAt, 'verified date must describe the source');
    for (const entry of history.records) assert.equal(await publicDb.findBySlug(entry.slug), null,
      'historical fallbacks must not be inserted into the active directory or sitemap');
    const publishedSlugs = await publicDb.getAllSlugs();
    assert.ok(history.records.every(entry => !publishedSlugs.some(item => item.slug === entry.slug)));

    const proof = await db.findOne({});
    await db.update({ _id: proof._id }, { $set: { refreshRegressionProof: 'keep-newer-record' } });
    const olderSource = path.join(temporary, 'older.json.gz');
    writeRegistrySource(olderSource, 'notaries', source.records, { generatedAt: '2026-07-19T22:48:13.116Z' });
    const differentPaths = await Promise.all([
      importNotaries({ sourcePath: olderSource }),
      importNotaries(),
    ]);
    assert.deepEqual(differentPaths, [imported, imported]);
    assert.equal((await db.findOne({ _id: proof._id })).refreshRegressionProof, 'keep-newer-record',
      'a stale deployment snapshot must not replace a newer datastore');
    const invalidSource = path.join(temporary, 'invalid-date.json.gz');
    writeRegistrySource(invalidSource, 'notaries', source.records, { generatedAt: 'invalid' });
    const afterError = await Promise.allSettled([
      importNotaries({ sourcePath: invalidSource }),
      importNotaries(),
    ]);
    assert.equal(afterError[0].status, 'rejected');
    assert.match(afterError[0].reason.message, /generatedAt/);
    assert.equal(afterError[1].status, 'fulfilled', 'a failed import must not poison the queue');
    assert.equal(afterError[1].value, imported);
    assert.equal(await publicDb.count(), imported);

    const app = express();
    app.set('view engine', 'ejs');
    app.set('views', path.join(__dirname, '..', 'views'));
    const { registerNotaryRoutes } = require('../app/routes/notaries');
    registerNotaryRoutes(app, {
      notariesDb: publicDb,
      commentsDb: null,
      externalApiLimiter: (req, res, next) => next(),
      asyncHandler: handler => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next),
      sendNotFound: res => res.status(404).send('Not found'),
    });
    app.use((error, req, res, next) => { res.status(500).send(error.message); });
    server = await new Promise(resolve => {
      const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
    });
    const origin = 'http://127.0.0.1:' + server.address().port;
    for (const entry of history.records) {
      const response = await fetch(origin + '/notary/' + entry.slug);
      const html = await response.text();
      assert.equal(response.status, 200, entry.slug);
      assert.match(response.headers.get('x-robots-tag'), /noindex/);
      assert.ok(html.includes('https://zakonexpert.kz/notary/' + entry.slug));
      assert.match(html, /Актуальный статус нотариуса не подтверждён/);
      assert.match(html, /Историческая запись/);
      assert.doesNotMatch(html, /Действующий нотариус|Деятельность прекращена|ДЕЙСТВУЕТ/);
      const json = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
      assert.ok(json);
      const structured = JSON.parse(json[1]);
      const schemaText = JSON.stringify(structured);
      assert.doesNotMatch(schemaText, /LegalService|telephone|PostalAddress|successor/);
      assert.match(schemaText, /Person/);
      assert.ok(schemaText.includes(entry.name.toLowerCase().split(' ')[0].replace(/^./, c => c.toUpperCase())));
    }
    assert.equal((await fetch(origin + '/notary/unreviewed-missing-notary')).status, 404);

    const current = { ...history.records[0], active: true, sourceFingerprint: 'fresh-official-record',
      sourceGeneratedAt: source.generatedAt };
    await db.insert(current);
    let response = await fetch(origin + '/notary/' + current.slug);
    assert.equal(response.status, 200);
    assert.match(await response.text(), /Действующий нотариус/);
    await db.update({ slug: current.slug }, { $set: { privacy_noindex: true } });
    response = await fetch(origin + '/notary/' + current.slug);
    assert.equal(response.status, 200);
    assert.match(await response.text(), /name="robots" content="noindex,follow"/);
    await db.update({ slug: current.slug }, { $set: { privacy_removed: true } });
    assert.equal((await fetch(origin + '/notary/' + current.slug)).status, 404,
      'a removed current record must not reappear through the fallback');
    console.log('Notary history, HTTP, shared-store, concurrent-import and freshness tests PASS');
  } finally {
    if (server) {
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
    }
    clearInterval(db._autocompactionIntervalId);
    const resolved = path.resolve(temporary);
    assert.ok(resolved.startsWith(path.resolve(os.tmpdir()) + path.sep)
      && path.basename(resolved).startsWith('ze-notary-history-'));
    fs.rmSync(resolved, { recursive: true, force: true });
  }
}

if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { main };
