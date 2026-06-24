'use strict';
const Datastore = require('nedb-promises');
const path = require('path');
const db = Datastore.create({ filename: path.join(__dirname, '..', 'data', 'bailiffs.db'), autoload: true });
(async () => {
  const n = await db.remove({ slug: 'zaripov-marsel-tagirovich' }, {});
  console.log(n > 0 ? '✓ Зарипов Марсель Тагирович удалён из реестра' : '— Запись не найдена');
  process.exit(0);
})();
