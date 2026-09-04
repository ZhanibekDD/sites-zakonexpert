'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  applyCompanyCorrection,
  getCompanyCorrection,
} = require('../modules/company-corrections');

const source = {
  id: 7338696,
  bin: '050240002031',
  name_ru: 'Товарищество с ограниченной ответственностью «АЛИАСКАР-2005»',
  status_ru: 'Действующее',
  leader: 'АЛШАНОВ АЙДАР РАХМАНОВИЧ',
};
const corrected = applyCompanyCorrection(source);

assert.notStrictEqual(corrected, source, 'correction must not mutate the database object');
assert.strictEqual(corrected.status_ru, 'Деятельность прекращена 29.02.2024 путем присоединения');
assert.strictEqual(corrected.dissolution_date, '2024-02-29');
assert.strictEqual(corrected.leader, null, 'former executive must not remain current');
assert.match(corrected.leader_display, /деятельность прекращена/i);
assert.match(corrected.successor_name_ru, /Jan De Nul Kazakhstan/);
assert.match(corrected.correction.sourceLabel, /Приказ № 7965/);
assert(!/\b\d{12}\b/.test(JSON.stringify(corrected.correction)), 'public correction note must not contain a personal IIN');

const unrelated = { bin: '260740044168', leader: 'КИЯШЕВ ЖАНИБЕК ДАУЛЕТОВИЧ' };
assert.strictEqual(applyCompanyCorrection(unrelated), unrelated, 'unrelated companies must remain untouched');
assert.strictEqual(getCompanyCorrection('05 024 000 2031').bin, '050240002031');

const caveGroup = applyCompanyCorrection({
  id: 350784397,
  bin: '251140034546',
  name_ru: 'Товарищество с ограниченной ответственностью «Cave Group»',
  status_ru: 'Зарегистрирован',
  leader: 'FORMER EXECUTIVE',
});
assert.strictEqual(caveGroup.status_ru, 'Деятельность прекращена 20.08.2026');
assert.strictEqual(caveGroup.dissolution_date, '2026-08-20');
assert.strictEqual(caveGroup.leader, null, 'ceased company must not expose a former executive as current');
assert.match(caveGroup.correction.sourceLabel, /Приказ № 33519/);
assert(!/\b\d{12}\b/.test(JSON.stringify(caveGroup.correction)), 'public correction note must not contain a personal IIN');

const itemTemplate = fs.readFileSync(path.join(__dirname, '..', 'views', 'companies', 'item.ejs'), 'utf8');
assert.match(itemTemplate, /company\.leader_display \|\| company\.leader/);
assert.match(itemTemplate, /company\.dissolution_date/);
assert.match(itemTemplate, /company\.correction/);
assert.match(itemTemplate, /прекращ\|реорганиз/);
assert.match(itemTemplate, /company\.privacy_noindex/);

console.log('Company corrections OK: ALИАСКАР-2005 status and leader presentation are corrected');
