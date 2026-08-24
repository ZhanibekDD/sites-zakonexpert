'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUTPUT = path.join(ROOT, 'public', 'img', 'contracts');
const WIDTH = 900;
const HEIGHT = 1272;
const NAVY = '#0b2c50';
const GOLD = '#bd8121';
const MUTED = '#61758d';
const LINE = '#ced9e5';
const PANEL = '#f3f6fa';
const CREAM = '#fff9ec';

function esc(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function wrap(text, maxChars) {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (next.length > maxChars && line) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function text(x, y, value, options = {}) {
  const size = options.size || 13;
  const fill = options.fill || '#1e293b';
  const weight = options.weight || 400;
  const family = options.family || 'Arial, Helvetica, sans-serif';
  const anchor = options.anchor || 'start';
  const italic = options.italic ? ' font-style="italic"' : '';
  const letter = options.letterSpacing ? ` letter-spacing="${options.letterSpacing}"` : '';
  return `<text x="${x}" y="${y}" fill="${fill}" font-family="${family}" font-size="${size}" font-weight="${weight}" text-anchor="${anchor}"${italic}${letter}>${esc(value)}</text>`;
}

function multiline(x, y, value, maxChars, options = {}) {
  const size = options.size || 12;
  const lineHeight = options.lineHeight || Math.round(size * 1.42);
  const lines = Array.isArray(value) ? value : wrap(value, maxChars);
  return lines.map((lineValue, index) => text(x, y + index * lineHeight, lineValue, { ...options, size })).join('\n');
}

function rect(x, y, width, height, options = {}) {
  const fill = options.fill || 'none';
  const stroke = options.stroke || 'none';
  const radius = options.radius || 0;
  const strokeWidth = options.strokeWidth || 1;
  return `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${radius}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}"/>`;
}

function line(x1, y1, x2, y2, options = {}) {
  return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${options.stroke || LINE}" stroke-width="${options.strokeWidth || 1}"/>`;
}

function shieldLogo() {
  return `
  <g transform="translate(58,46)">
    <path d="M0 7 L28 0 L56 7 L56 40 C45 57 33 67 28 69 C23 67 11 57 0 40 Z" fill="none" stroke="#d9aa38" stroke-width="3"/>
    <path d="M8 17 L28 11 L48 17 M8 29 C20 21 34 21 48 29 M9 41 C23 33 36 34 47 41 M16 51 C25 46 33 46 41 50" fill="none" stroke="#d9aa38" stroke-width="2.4" stroke-linecap="round"/>
  </g>
  ${text(126, 75, 'ZAKON', { size: 25, fill: '#cbd2da', weight: 500, letterSpacing: 2 })}
  ${text(126, 103, 'EXPERT', { size: 25, fill: '#cbd2da', weight: 500, letterSpacing: 2 })}`;
}

function pageHeader(pageNo, titleText = 'ДОГОВОР № 89') {
  return `${shieldLogo()}
  ${text(842, 56, titleText, { size: 14, fill: NAVY, weight: 800, anchor: 'end' })}
  ${text(842, 75, '24.08.2026', { size: 10, fill: MUTED, anchor: 'end' })}
  ${line(56, 128, 844, 128, { stroke: GOLD, strokeWidth: 1.6 })}`;
}

function pageFooter(pageNo) {
  return `${text(56, 1237, 'ТОО «ZakonExpert» · БИН 260740044168', { size: 9.5, fill: MUTED })}
  ${text(450, 1237, '+7 700 309 7566 · zakonexpertt.kz', { size: 9.5, fill: MUTED, anchor: 'middle' })}
  ${text(844, 1237, `СТР. ${pageNo} / 3`, { size: 10.5, fill: NAVY, anchor: 'end' })}`;
}

function redaction(x, y, width, label = 'ДАННЫЕ КЛИЕНТА СКРЫТЫ') {
  return `${rect(x, y, width, 24, { fill: '#ece9e3', radius: 4 })}${text(x + width / 2, y + 16, label, { size: 9.5, fill: '#7e7b76', anchor: 'middle', italic: true })}`;
}

function sectionBand(number, titleValue, subtitle, y) {
  return `${rect(56, y, 788, 42, { fill: CREAM })}
  ${rect(56, y, 126, 42, { fill: '#eef3f8' })}
  ${text(119, y + 17, `ЧАСТЬ ${number}`, { size: 10, fill: NAVY, weight: 800, anchor: 'middle' })}
  ${text(205, y + 18, titleValue, { size: 15, fill: NAVY, weight: 800 })}
  ${text(205, y + 34, subtitle, { size: 9.5, fill: MUTED })}`;
}

function heading(number, titleValue, y) {
  return `${rect(56, y - 18, 49, 28, { fill: '#eef3f8' })}
  ${text(80, y + 1, number, { size: 10.5, fill: NAVY, weight: 800, anchor: 'middle' })}
  ${text(118, y + 1, titleValue, { size: 14, fill: NAVY, weight: 800 })}
  ${line(118, y + 7, 844, y + 7, { stroke: GOLD, strokeWidth: 1.5 })}`;
}

function paragraph(number, value, y, maxChars = 112) {
  const prefix = `${number}.`;
  const lines = wrap(value, maxChars);
  const first = `${prefix} ${lines.shift() || ''}`;
  return `${text(56, y, first, { size: 10.5, fill: '#202a36', weight: 400 })}
  ${lines.map((item, index) => text(56, y + 15 * (index + 1), item, { size: 10.5, fill: '#202a36' })).join('\n')}`;
}

function svgDocument(body, titleValue) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" role="img" aria-labelledby="title desc">
  <title id="title">${esc(titleValue)}</title>
  <desc id="desc">Обезличенная визуальная копия страницы договора ZakonExpert. Персональные данные клиента скрыты.</desc>
  <rect width="900" height="1272" fill="#ffffff"/>
  ${body}
</svg>\n`;
}

function pageOne() {
  let s = pageHeader(1);
  s += text(450, 151, 'ИНДИВИДУАЛЬНЫЙ ДОГОВОР', { size: 11, fill: GOLD, weight: 800, anchor: 'middle', letterSpacing: 1 });
  s += text(450, 181, 'ДОГОВОР ОКАЗАНИЯ УСЛУГ', { size: 26, fill: NAVY, weight: 850, anchor: 'middle' });
  s += text(450, 201, 'Консультационное и документальное сопровождение', { size: 11, fill: MUTED, anchor: 'middle' });

  s += rect(56, 216, 788, 96, { fill: '#f8fafc', stroke: LINE });
  s += line(318, 216, 318, 264); s += line(581, 216, 581, 264); s += line(450, 264, 450, 312);
  s += text(187, 235, 'НОМЕР ДОГОВОРА', { size: 8.5, fill: GOLD, weight: 800, anchor: 'middle' });
  s += text(187, 253, '№ 89', { size: 13, fill: NAVY, weight: 800, anchor: 'middle' });
  s += text(450, 235, 'МЕСТО ЗАКЛЮЧЕНИЯ', { size: 8.5, fill: GOLD, weight: 800, anchor: 'middle' });
  s += text(450, 253, 'г. Талдыкорган', { size: 13, fill: NAVY, weight: 800, anchor: 'middle' });
  s += text(712, 235, 'ДАТА', { size: 8.5, fill: GOLD, weight: 800, anchor: 'middle' });
  s += text(712, 253, '24.08.2026 г.', { size: 13, fill: NAVY, weight: 800, anchor: 'middle' });
  s += text(68, 282, 'ИСПОЛНИТЕЛЬ', { size: 8.5, fill: GOLD, weight: 800 });
  s += text(68, 301, 'ТОО «ZakonExpert»', { size: 13, fill: NAVY, weight: 850 });
  s += text(68, 315, 'БИН 260740044168 · Кияшев Жанибек Даулетович', { size: 8.5, fill: MUTED });
  s += text(462, 282, 'КЛИЕНТ', { size: 8.5, fill: GOLD, weight: 800 });
  s += redaction(462, 288, 363);

  s += multiline(56, 334, 'ТОО «ZakonExpert», именуемое «Исполнитель», и Клиент, персональные данные которого скрыты в публичной копии, совместно заключили индивидуальный договор на согласованных условиях.', 124, { size: 10.2, lineHeight: 15, fill: '#252d36' });
  s += sectionBand('I', 'ИНДИВИДУАЛЬНЫЕ УСЛОВИЯ', 'Объём работы, результат, срок и стоимость', 376);
  s += text(56, 436, 'КЛЮЧЕВЫЕ УСЛОВИЯ', { size: 12, fill: NAVY, weight: 850 });
  s += text(210, 436, '· что получает Клиент', { size: 9.5, fill: MUTED });
  s += line(56, 444, 844, 444, { stroke: GOLD, strokeWidth: 1.4 });

  const rows = [
    ['01', 'УСЛУГА', 'Консультационное, информационное и документальное сопровождение по индивидуально согласованной задаче.'],
    ['02', 'РЕЗУЛЬТАТ', 'Проверяемый результат действий фиксируется сторонами в договоре.'],
    ['03', 'СРОК', '15 рабочих дней для действий Исполнителя; время рассмотрения органами учитывается отдельно.'],
    ['04', 'СТОИМОСТЬ', '200 000 тенге (двести тысяч тенге).'],
    ['05', 'ОПЛАТА', 'Порядок и этапы оплаты указываются в индивидуальных условиях конкретного договора.'],
  ];
  let rowY = 450;
  rows.forEach((row, index) => {
    const height = index === 0 || index === 4 ? 54 : 38;
    s += rect(56, rowY, 788, height, { fill: index % 2 ? '#ffffff' : '#fbfcfe', stroke: LINE });
    s += line(104, rowY, 104, rowY + height); s += line(258, rowY, 258, rowY + height);
    s += text(80, rowY + 23, row[0], { size: 9.5, fill: NAVY, weight: 850, anchor: 'middle' });
    s += text(116, rowY + 23, row[1], { size: 9.5, fill: GOLD, weight: 850 });
    s += multiline(270, rowY + 18, row[2], 78, { size: 9.5, lineHeight: 14, fill: '#273341', weight: row[1] === 'СТОИМОСТЬ' ? 800 : 400 });
    rowY += height;
  });

  s += heading('01', 'ПРЕДМЕТ И РЕЗУЛЬТАТ', 684);
  s += paragraph('1.1', 'Исполнитель оказывает консультационные, информационные и документальные услуги по предмету, прямо указанному в индивидуальных условиях договора.', 712);
  s += paragraph('1.2', 'В состав услуг входят анализ материалов, подготовка согласованных документов и консультирование Клиента по порядку действий.', 750);
  s += paragraph('1.3', 'Выполненные действия подтверждаются документами, талонами, ответами органов, перепиской либо иными объективными материалами.', 788);

  s += heading('02', 'ПОРЯДОК И СРОКИ', 841);
  s += paragraph('2.1', 'Работа начинается после получения необходимых документов и выполнения условий начала работы, указанных в договоре.', 869);
  s += paragraph('2.2', 'Срок действий Исполнителя составляет 15 рабочих дней. Время рассмотрения обращений судом, ЧСИ, нотариусом, банком или государственным органом в него не включается.', 907, 108);
  s += paragraph('2.3', 'Клиент своевременно передаёт новые уведомления и материалы; задержка необходимых данных влияет на срок работы.', 960);

  s += heading('03', 'СТОИМОСТЬ И ОПЛАТА', 1013);
  s += paragraph('3.1', 'Стоимость услуг в данном обезличенном примере составляет 200 000 тенге. Изменение цены требует письменного согласования.', 1041);
  s += paragraph('3.2', 'Оплата подтверждается банковским чеком, квитанцией либо иным платёжным документом.', 1079);
  s += paragraph('3.3', 'Реквизиты и согласованный способ оплаты указываются в индивидуальном экземпляре договора.', 1117);
  s += pageFooter(1);
  return svgDocument(s, 'Страница 1 договора ZakonExpert — индивидуальные условия');
}

function pageTwo() {
  let s = pageHeader(2);
  s += sectionBand('II', 'ПРАВИЛА РАБОТЫ И ГАРАНТИИ', 'Права, обязанности, приёмка и электронное взаимодействие', 145);
  s += heading('04', 'ОБЯЗАННОСТИ ИСПОЛНИТЕЛЯ', 228);
  s += paragraph('4.1', 'Исполнитель добросовестно анализирует материалы, готовит согласованные документы, соблюдает применимые сроки собственных действий и информирует Клиента о существенных этапах.', 256, 108);
  s += paragraph('4.2', 'По запросу Клиента предоставляются копии подготовленных и направленных документов, полученных ответов и подтверждений подачи.', 309);
  s += paragraph('4.3', 'Исполнитель выбирает законные способы сопровождения в пределах предмета договора и вправе запросить дополнительные сведения.', 347);
  s += paragraph('4.4', 'Решение суда, ЧСИ, нотариуса, банка, взыскателя или государственного органа принимается соответствующим лицом самостоятельно.', 385);

  s += heading('05', 'ОБЯЗАННОСТИ КЛИЕНТА И ПРИЁМКА', 438);
  s += paragraph('5.1', 'Клиент предоставляет полные и достоверные сведения, сообщает о платежах, соглашениях, судебных актах и иных обстоятельствах, влияющих на дело.', 466, 108);
  s += paragraph('5.2', 'Исполнитель направляет результат и подтверждающие материалы. Клиент вправе направить конкретные мотивированные замечания в срок, указанный договором.', 519, 108);
  s += paragraph('5.3', 'Подтверждённые недостатки подготовленных Исполнителем документов устраняются без дополнительной оплаты в разумный срок.', 572);

  s += heading('06', 'ПРЕКРАЩЕНИЕ, РАСХОДЫ И ОТВЕТСТВЕННОСТЬ', 625);
  s += paragraph('6.1', 'При прекращении договора стороны производят расчёт исходя из фактически выполненных согласованных действий и подтверждённых расходов.', 653);
  s += paragraph('6.2', 'Государственная пошлина, нотариальные, почтовые и иные согласованные расходы оплачиваются отдельно после предварительного уведомления, если иное не включено в цену.', 706, 108);
  s += paragraph('6.3', 'Работа может быть приостановлена, если без документов или действий Клиента продолжение объективно невозможно.', 759);
  s += paragraph('6.4', 'Исполнитель вправе прекратить договор при требовании незаконных действий, заведомо недостоверных сведениях или существенном повторном нарушении обязанностей.', 797, 108);

  s += heading('07', 'ПЕРСОНАЛЬНЫЕ ДАННЫЕ И ЭЛЕКТРОННОЕ ВЗАИМОДЕЙСТВИЕ', 850);
  s += paragraph('7.1', 'Персональные данные обрабатываются в объёме, необходимом для исполнения договора, подготовки документов, связи и хранения подтверждений выполненной работы.', 878, 108);
  s += paragraph('7.2', 'Исполнитель принимает разумные меры защиты данных и не передаёт их третьим лицам, кроме необходимых для поручения или предусмотренных законом случаев.', 931, 108);
  s += paragraph('7.3', 'Переписка, скан-копии и сообщения, позволяющие определить отправителя, содержание и дату, могут подтверждать согласование и уведомление.', 984, 108);

  s += heading('08', 'ЗАКЛЮЧИТЕЛЬНЫЕ ПОЛОЖЕНИЯ', 1037);
  s += paragraph('8.1', 'Договор вступает в силу после подписания согласованным способом и действует до исполнения обязательств сторон.', 1065);
  s += paragraph('8.2', 'Изменения действительны при письменном согласовании, включая электронную переписку, позволяющую определить стороны и содержание изменения.', 1103, 108);
  s += paragraph('8.3', 'Каждая сторона вправе сохранить и получить свою копию договора.', 1156);
  s += pageFooter(2);
  return svgDocument(s, 'Страница 2 договора ZakonExpert — правила работы и гарантии');
}

function pageThree() {
  let s = pageHeader(3);
  s += rect(56, 145, 788, 48, { fill: '#f5f7fa', stroke: LINE });
  s += line(310, 145, 310, 193); s += line(604, 145, 604, 193);
  s += text(183, 165, 'ЧАСТЬ III', { size: 10, fill: NAVY, weight: 800, anchor: 'middle' });
  s += text(183, 184, '09', { size: 17, fill: NAVY, weight: 850, anchor: 'middle' });
  s += text(328, 169, 'РЕКВИЗИТЫ, ОПЛАТА И ПОДПИСИ', { size: 15, fill: NAVY, weight: 850 });
  s += text(328, 185, 'Идентификация сторон и способы оплаты', { size: 9.5, fill: MUTED });
  s += text(827, 168, 'ДОГОВОР № 89', { size: 12, fill: NAVY, weight: 850, anchor: 'end' });
  s += text(827, 184, '24.08.2026 · ZAKONEXPERT', { size: 8.5, fill: MUTED, anchor: 'end' });

  s += rect(56, 193, 788, 224, { fill: '#f8fafc', stroke: LINE });
  s += line(450, 193, 450, 417);
  s += text(68, 217, 'ИСПОЛНИТЕЛЬ', { size: 9, fill: GOLD, weight: 850 });
  s += text(68, 240, 'ТОО «ZakonExpert»', { size: 14, fill: NAVY, weight: 850 });
  s += multiline(68, 261, [
    'Товарищество с ограниченной ответственностью «ZakonExpert»',
    'БИН: 260740044168',
    'Руководитель: Кияшев Жанибек Даулетович',
    'Юридический адрес: Республика Казахстан, г. Талдыкорган,',
    'ул. Акын Сара, 152',
    'Тел./WhatsApp: +7 700 309 7566',
    'Сайт: zakonexpertt.kz',
  ], 60, { size: 10.5, lineHeight: 19, fill: '#283440' });
  s += text(462, 217, 'КЛИЕНТ', { size: 9, fill: GOLD, weight: 850 });
  s += redaction(462, 232, 360, 'ФИО СКРЫТО');
  s += redaction(462, 265, 360, 'ИИН СКРЫТ');
  s += redaction(462, 298, 360, 'ТЕЛЕФОН СКРЫТ');
  s += redaction(462, 331, 360, 'АДРЕС СКРЫТ');

  s += text(56, 446, 'ПОРЯДОК ОПЛАТЫ', { size: 14, fill: NAVY, weight: 850 });
  s += text(218, 446, '· сверяйте перед оплатой', { size: 9.5, fill: MUTED });
  s += line(56, 454, 844, 454, { stroke: GOLD, strokeWidth: 1.5 });
  const paymentRows = [
    ['ПО СЧЁТУ', 'Оплата по счёту или платёжной ссылке ZakonExpert для конкретного договора.'],
    ['ЧЕРЕЗ KASPI', 'По согласованию сторон возможен перевод по реквизитам, указанным в индивидуальном экземпляре.'],
    ['ПОДТВЕРЖДЕНИЕ', 'После оплаты сохраняется чек или иной документ, подтверждающий сумму и дату перевода.'],
    ['КОНТАКТ', 'Для получения счёта и по вопросам оплаты: +7 700 309 7566 · zakonexpertt.kz.'],
  ];
  let paymentY = 462;
  paymentRows.forEach((row, index) => {
    s += rect(56, paymentY, 788, 49, { fill: index % 2 ? '#ffffff' : '#fbfcfe', stroke: LINE });
    s += line(420, paymentY, 420, paymentY + 49);
    s += text(68, paymentY + 29, row[0], { size: 9.5, fill: GOLD, weight: 850 });
    s += multiline(433, paymentY + 19, row[1], 70, { size: 9.2, lineHeight: 14, fill: '#334155' });
    paymentY += 49;
  });

  s += text(56, 688, 'ПОДПИСИ СТОРОН', { size: 14, fill: NAVY, weight: 850 });
  s += text(218, 688, '· экземпляр становится завершённым после подписания', { size: 9.5, fill: MUTED });
  s += line(56, 696, 844, 696, { stroke: GOLD, strokeWidth: 1.5 });
  s += rect(56, 704, 788, 350, { fill: '#ffffff', stroke: LINE });
  s += line(450, 704, 450, 1054);
  s += rect(56, 704, 394, 36, { fill: '#f3f6fa', stroke: LINE });
  s += rect(450, 704, 394, 36, { fill: '#f3f6fa', stroke: LINE });
  s += text(253, 727, 'ИСПОЛНИТЕЛЬ', { size: 11, fill: NAVY, weight: 850, anchor: 'middle' });
  s += text(647, 727, 'КЛИЕНТ', { size: 11, fill: NAVY, weight: 850, anchor: 'middle' });
  s += text(72, 770, 'Руководитель · Кияшев Ж.Д.', { size: 12, fill: NAVY, weight: 800 });
  s += `<path d="M100 915 C155 835 203 971 270 855 C300 813 321 860 345 845" fill="none" stroke="#1c3f7a" stroke-width="2.2" stroke-linecap="round"/>`;
  s += `<g transform="translate(250,824)"><circle cx="55" cy="55" r="53" fill="none" stroke="#14366b" stroke-width="2.4"/><circle cx="55" cy="55" r="43" fill="none" stroke="#14366b" stroke-width="1.2"/><text x="55" y="47" text-anchor="middle" fill="#14366b" font-family="Georgia,serif" font-size="12" font-weight="700">ZAKONEXPERT</text><text x="55" y="66" text-anchor="middle" fill="#14366b" font-family="Arial,sans-serif" font-size="10">БИН 260740044168</text><text x="55" y="82" text-anchor="middle" fill="#14366b" font-family="Arial,sans-serif" font-size="8">РЕСПУБЛИКА КАЗАХСТАН</text></g>`;
  s += text(126, 974, '/ Кияшев Ж.Д. /', { size: 10.5, fill: '#334155' });
  s += text(470, 770, 'Подпись Клиента', { size: 12, fill: NAVY, weight: 800 });
  s += line(470, 843, 655, 843, { stroke: '#52677d', strokeWidth: 1 });
  s += redaction(470, 862, 260, 'ИМЯ И ПОДПИСЬ СКРЫТЫ');
  s += text(470, 914, 'Дата подписания:', { size: 11, fill: MUTED });
  s += multiline(72, 1085, 'Подписывая договор, Клиент подтверждает, что ознакомился с ключевыми условиями, объёмом услуг, стоимостью, порядком оплаты и правилами прекращения договора.', 128, { size: 9.5, lineHeight: 14, fill: MUTED, italic: true });
  s += pageFooter(3);
  return svgDocument(s, 'Страница 3 договора ZakonExpert — реквизиты, оплата и подписи');
}

function main() {
  fs.mkdirSync(OUTPUT, { recursive: true });
  const files = [
    ['client-contract-page-1.svg', pageOne()],
    ['client-contract-page-2.svg', pageTwo()],
    ['client-contract-page-3.svg', pageThree()],
  ];
  for (const [name, content] of files) {
    const target = path.join(OUTPUT, name);
    fs.writeFileSync(target, content, 'utf8');
    console.log(`generated ${path.relative(ROOT, target)} (${Buffer.byteLength(content)} bytes)`);
  }
}

if (require.main === module) main();

module.exports = { pageOne, pageTwo, pageThree };
