'use strict';
// Обновить данные ЧСИ Зарипов Марсель Тагирович (лицензия №6200)
const Datastore = require('nedb-promises');
const path = require('path');

const db = Datastore.create({
  filename: path.join(__dirname, '..', 'data', 'bailiffs.db'),
  autoload: true,
});

(async () => {
  const n = await db.update(
    { slug: 'zaripov-marsel-tagirovich' },
    { $set: {
      address: 'ул. Жамбыла 114/85, офис 316',
      phones:  ['+77017798999'],
      email:   'zhso.zaripov@gmail.com',
    }},
    {}
  );
  if (n > 0) {
    console.log('✓ Зарипов Марсель Тагирович — данные обновлены');
    console.log('  Адрес: ул. Жамбыла 114/85, офис 316');
    console.log('  Телефон: +77017798999');
    console.log('  Email: zhso.zaripov@gmail.com');
  } else {
    console.log('— Запись не найдена');
  }
  process.exit(0);
})();
