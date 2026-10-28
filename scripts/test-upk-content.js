'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const Datastore = require('nedb-promises');
const Module = require('module');
const { parseAdiletArticles, makeSnippet } = require('../modules/adilet-articles');
const { LAW, sha256, parseUpkDocument } = require('../modules/upk-source');
const { validateSnapshot, isLegacyCorruption, repairUpkContent } = require('../modules/upk-content-repair');
const snapshot = require('../config/law-sources/upk-rk-repair-2026-10-28.json');

const quiet = { info() {} };

async function run() {
  const longParagraph = 'Юридически значимый полный абзац. '.repeat(500);
  const sample = `<article><h3>Глава 9. Участники процесса</h3>
    <p><b><a name="z64"></a>Статья <span>64.</span> Подозреваемый</b></p>
    <p>1. Подозреваемым является лицо: <b>важное уточнение</b>.</p>
    <p>${longParagraph}</p><span class="note">Сноска. </span><a>Закон № 1</a><span> действует.</span><br>
    <h3 id="z65">Статья 65. Обвиняемый</h3><p>1. Полный текст второй статьи.</p></article>`;
  const mini = parseAdiletArticles(sample, LAW);
  assert.equal(mini.length, 2);
  assert.equal(mini[0].sourceFragment, 'z64');
  assert.equal(mini[0].chapter, 'Глава 9. Участники процесса');
  assert(mini[0].text.includes(longParagraph.trim()), 'Bodies over 12k must not be truncated');
  assert.equal(mini[0].text.split('важное уточнение').length, 2, 'Nested markup must be read exactly once');
  assert(mini[0].text.endsWith('Сноска. Закон № 1 действует.'), 'Loose official footnotes must survive');
  assert(!mini[0].text.includes('Статья 65.'), 'Next heading must never become the previous body');
  assert.equal(mini[1].text, '1. Полный текст второй статьи.');
  assert.throws(() => parseAdiletArticles('<p><b>Статья 64. Нет текста</b></p>', LAW), /no body/);
  assert.throws(() => parseUpkDocument({ group_number: 'WRONG', is_actual: true }), /current Russian/);

  const html = zlib.gunzipSync(fs.readFileSync(path.join(__dirname, 'fixtures', 'adilet-upk-2026-10-28.html.gz'))).toString('utf8');
  assert.equal(sha256(html), snapshot.source.htmlSha256, 'Full official fixture must match the source fingerprint');
  const full = parseAdiletArticles(html, LAW).map(article => ({ ...article, snippet: makeSnippet(article.text) }));
  assert.deepEqual(full, snapshot.articles, 'Every bundled body must be reproduced from the official HTML');
  validateSnapshot(snapshot);
  assert.equal(full.length, 686);
  assert.equal(full.find(a => a.num === '64').text.length, 7672);
  assert.equal(full.find(a => a.num === '162').text.length, 2948);
  assert(full.some(a => a.text.length > 12000));
  assert(!full.some(a => /Ctrl\+Enter|поиск по странице/.test(a.text)), 'Site footer must not become article 674');

  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'zakonexpert-upk-'));
  try {
    const db = Datastore.create({ filename: path.join(temporary, 'laws.db'), autoload: true });
    await db.load();
    await db.ensureIndex({ fieldName: 'slug', unique: true });
    const byNum = number => snapshot.articles.find(a => a.num === number);
    const manual = { ...byNum('1'), text: 'Полный текст с проверенной ручной правкой.', customReference: 'keep-manual' };
    const short = { ...byNum('392'), customReference: 'valid-short-article' };
    const bad64 = { ...byNum('64'), _id: 'persistent-64', text: 'Статья 65. Обвиняемый', customReference: 'keep-reference' };
    const bad162 = { ...byNum('162'), text: 'Статья 163. Порядок санкционирования ареста на имущество' };
    const footer = { ...byNum('674'), text: 'Если Вы обнаружили на странице ошибку, нажмите Ctrl+Enter\nпоиск по странице' };
    const neighbor = { code: 'uk', slug: 'uk-rk-64', num: '64', text: 'Соседний кодекс должен сохраниться.' };
    const unknown = { code: 'upk', slug: 'upk-rk-9999', num: '9999', text: 'Статья 10000. Неизвестная запись' };
    await db.insert([manual, short, bad64, bad162, footer, neighbor, unknown]);
    const before = await db.find({});
    const badSnapshot = JSON.parse(JSON.stringify(snapshot));
    badSnapshot.articles[0].text = 'damaged bundle';
    await assert.rejects(repairUpkContent(db, badSnapshot, quiet), /integrity/);
    assert.deepEqual(await db.find({}), before, 'Failed validation must make zero writes');
    const result = await repairUpkContent(db, snapshot, quiet);
    assert.deepEqual(result, { repaired: 3, inserted: 681, preserved: 2 });
    const fixed = await db.findOne({ slug: 'upk-rk-64' });
    assert.equal(fixed.text, byNum('64').text);
    assert.equal(fixed._id, 'persistent-64');
    assert.equal(fixed.customReference, 'keep-reference');
    assert(fixed.sourceUrl.endsWith('#z509'));
    assert.equal((await db.findOne({ slug: 'upk-rk-1' })).text, manual.text);
    assert.equal((await db.findOne({ slug: 'upk-rk-392' })).text, short.text);
    assert.equal((await db.findOne({ slug: 'uk-rk-64' })).text, neighbor.text);
    assert.equal((await db.findOne({ slug: 'upk-rk-9999' })).text, unknown.text);
    const first = await db.find({});
    assert.deepEqual(await repairUpkContent(db, snapshot, quiet), { repaired: 0, inserted: 0, preserved: 686 });
    assert.deepEqual(await db.find({}), first, 'A second initialization must not write repaired timestamps again');
    assert(!isLegacyCorruption(await db.findOne({ slug: 'upk-rk-674' })));

    // Compile the real store with only __dirname isolated, so its ordinary
    // data path points at a disposable database. Request immediately, before
    // initialization finishes: the public API must wait for the repair.
    const runtimeDir = path.join(temporary, 'runtime');
    fs.mkdirSync(path.join(runtimeDir, 'data'), { recursive: true });
    fs.writeFileSync(path.join(runtimeDir, 'data', 'laws.db'), JSON.stringify(bad64) + '\n');
    const realStoreFile = path.join(__dirname, '..', 'modules', 'laws-db.js');
    const isolated = new Module(path.join(runtimeDir, 'modules', 'laws-db.js'), module);
    isolated.filename = isolated.id;
    isolated.paths = module.paths;
    isolated.require = Module.createRequire(realStoreFile);
    isolated._compile(fs.readFileSync(realStoreFile, 'utf8'), isolated.filename);
    const pendingRead = isolated.exports.findBySlug('upk-rk-64');
    assert.equal((await pendingRead).text, byNum('64').text, 'A first request must wait for initialization');
    assert.equal(await isolated.exports.count({ code: 'upk' }), 686);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
  process.stdout.write('UPK source/parser/targeted repair checks passed\n');
}

if (require.main === module) run().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { run };
