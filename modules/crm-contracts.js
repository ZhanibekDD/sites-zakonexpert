'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const FILE_DIR = process.env.CRM_CONTRACT_FILE_DIR || path.join(__dirname, '..', 'data', 'crm-contract-files');
const MAX_UPLOAD_BYTES = Math.max(1024 * 1024, Math.min(25 * 1024 * 1024, Number(process.env.CRM_CONTRACT_MAX_UPLOAD_BYTES || 15 * 1024 * 1024)));

const SERVICE_PRESETS = Object.freeze({
  arrest: {
    label: 'Снятие ареста / ограничений ЧСИ',
    subject: 'Исполнитель обязуется оказать Клиенту консультационные, информационные и документальные услуги по снятию арестов, запретов и иных ограничений, связанных с исполнительным производством.',
    actions: 'анализ материалов; подготовка заявлений, жалоб, ходатайств и обращений; взаимодействие с ЧСИ, взыскателем, банками и государственными органами; сопровождение переписки до завершения согласованного объёма работ',
    result: 'подготовлены и направлены необходимые документы, получены ответы/постановления либо иные объективные подтверждения совершённых действий по снятию согласованных ограничений',
  },
  notary: {
    label: 'Отмена исполнительной надписи',
    subject: 'Исполнитель обязуется оказать Клиенту консультационные, информационные и документальные услуги по оспариванию и отмене исполнительной надписи нотариуса и связанных с ней мер взыскания.',
    actions: 'анализ исполнительной надписи и материалов; подготовка возражения нотариусу; обращения в нотариальную палату, органы юстиции, ЧСИ и взыскателю; подготовка жалоб и процессуальных документов при необходимости',
    result: 'подготовлен и реализован согласованный комплекс действий по отмене исполнительной надписи и последующему снятию основанных на ней мер взыскания',
  },
  schedule: {
    label: 'График платежей / реструктуризация',
    subject: 'Исполнитель обязуется оказать Клиенту консультационные, информационные и документальные услуги по подготовке и сопровождению обращения об изменении условий погашения задолженности и установлении посильного графика платежей.',
    actions: 'анализ задолженности и документов; подготовка заявления и финансового обоснования; направление/сопровождение обращения в банк, МФО или коллекторское агентство; подготовка повторных обращений и жалоб при необходимости',
    result: 'подготовлен и направлен полный пакет обращений по согласованным кредиторам и обеспечено сопровождение до получения официальных ответов либо согласования новых условий',
  },
  court: {
    label: 'Суд / отмена решения / медиация',
    subject: 'Исполнитель обязуется оказать Клиенту консультационное, документальное и процессуальное сопровождение по вопросу пересмотра судебного акта, урегулирования спора либо заключения медиативного соглашения.',
    actions: 'анализ материалов дела; подготовка заявлений, жалоб, ходатайств и проекта медиативного соглашения; формирование пакета приложений; сопровождение подачи и переписки в пределах согласованного объёма',
    result: 'подготовлен и реализован согласованный процессуальный маршрут с передачей Клиенту документов и подтверждений подачи/направления',
  },
  bankruptcy: {
    label: 'Банкротство / восстановление платежеспособности',
    subject: 'Исполнитель обязуется оказать Клиенту консультационные, информационные и документальные услуги по подготовке к процедуре банкротства либо восстановлению платежеспособности в пределах согласованного объёма.',
    actions: 'анализ кредитной и исполнительной нагрузки; формирование перечня кредиторов и документов; подготовка заявлений и приложений; сопровождение подачи и устранения замечаний в пределах договора',
    result: 'сформирован и передан Клиенту согласованный комплект документов и обеспечено сопровождение до предусмотренного договором этапа процедуры',
  },
  custom: { label: 'Индивидуальная услуга', subject: '', actions: '', result: '' },
});

function cleanText(value, max = 6000) {
  return String(value ?? '').replace(/\u0000/g, '').trim().slice(0, max);
}

function safeFileBase(value) {
  return cleanText(value, 160).replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, '_').replace(/^\.+|\.+$/g, '') || 'contract';
}

function ensureDir() {
  fs.mkdirSync(FILE_DIR, { recursive: true, mode: 0o700 });
}

function contractFilePath(fileKey, ext) {
  ensureDir();
  const key = String(fileKey || '').replace(/[^a-zA-Z0-9_-]/g, '');
  if (!key) throw new Error('BAD_FILE_KEY');
  if (!['pdf', 'docx', 'upload.pdf'].includes(ext)) throw new Error('BAD_FILE_TYPE');
  return path.join(FILE_DIR, `${key}.${ext}`);
}

function parseMoney(value) {
  const n = Number(String(value ?? '').replace(/[^0-9,.-]/g, '').replace(',', '.'));
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n * 100) / 100;
}

function formatMoney(value) {
  return `${Number(value || 0).toLocaleString('ru-RU')} ₸`;
}

const ONES = ['', 'один', 'два', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять'];
const ONES_F = ['', 'одна', 'две', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять'];
const TEENS = ['десять', 'одиннадцать', 'двенадцать', 'тринадцать', 'четырнадцать', 'пятнадцать', 'шестнадцать', 'семнадцать', 'восемнадцать', 'девятнадцать'];
const TENS = ['', '', 'двадцать', 'тридцать', 'сорок', 'пятьдесят', 'шестьдесят', 'семьдесят', 'восемьдесят', 'девяносто'];
const HUNDREDS = ['', 'сто', 'двести', 'триста', 'четыреста', 'пятьсот', 'шестьсот', 'семьсот', 'восемьсот', 'девятьсот'];

function tripletWords(num, female = false) {
  const n = Math.max(0, Math.floor(num));
  const words = [];
  const h = Math.floor(n / 100);
  const rem = n % 100;
  if (h) words.push(HUNDREDS[h]);
  if (rem >= 10 && rem <= 19) { words.push(TEENS[rem - 10]); return words; }
  const t = Math.floor(rem / 10);
  const o = rem % 10;
  if (t) words.push(TENS[t]);
  if (o) words.push((female ? ONES_F : ONES)[o]);
  return words;
}

function pluralForm(n, one, few, many) {
  const mod100 = n % 100;
  const mod10 = n % 10;
  if (mod100 >= 11 && mod100 <= 14) return many;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}

function amountWords(value) {
  let n = Math.round(parseMoney(value));
  if (!n) return 'ноль тенге';
  const parts = [];
  const millions = Math.floor(n / 1000000);
  n %= 1000000;
  const thousands = Math.floor(n / 1000);
  const units = n % 1000;
  if (millions) parts.push(...tripletWords(millions), pluralForm(millions, 'миллион', 'миллиона', 'миллионов'));
  if (thousands) parts.push(...tripletWords(thousands, true), pluralForm(thousands, 'тысяча', 'тысячи', 'тысяч'));
  if (units) parts.push(...tripletWords(units));
  parts.push('тенге');
  return parts.join(' ');
}

function almatyDateParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('ru-RU', { timeZone: 'Asia/Almaty', day: '2-digit', month: '2-digit', year: 'numeric' }).formatToParts(date);
  const map = Object.fromEntries(parts.map(p => [p.type, p.value]));
  return { iso: `${map.year}-${map.month}-${map.day}`, display: `${map.day}.${map.month}.${map.year}` };
}

function preset(key) { return SERVICE_PRESETS[key] || SERVICE_PRESETS.custom; }

function normalizeDraft(input = {}, client = {}) {
  const servicePreset = preset(input.presetKey);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(input.date || '')) ? String(input.date) : almatyDateParts().iso;
  return {
    id: cleanText(input.id || crypto.randomUUID(), 100), number: cleanText(input.number, 80), title: cleanText(input.title || 'Договор оказания услуг', 240), date,
    city: cleanText(input.city || 'г. Талдыкорган', 120), amount: parseMoney(input.amount), paymentTerms: cleanText(input.paymentTerms || '100% оплата до начала оказания услуг', 1000),
    workPeriod: cleanText(input.workPeriod || '30 календарных дней', 300), presetKey: cleanText(input.presetKey || 'custom', 40),
    serviceSubject: cleanText(input.serviceSubject || servicePreset.subject, 5000), serviceActions: cleanText(input.serviceActions || servicePreset.actions, 5000), resultDefinition: cleanText(input.resultDefinition || servicePreset.result, 5000),
    clientName: cleanText(input.clientName || client.name, 200), clientIin: cleanText(input.clientIin || client.iin, 20).replace(/\D/g, '').slice(0, 12), clientPhone: cleanText(input.clientPhone || client.phone, 60), clientAddress: cleanText(input.clientAddress || client.address || 'не указан', 500),
    status: cleanText(input.status || 'draft', 40), source: cleanText(input.source || 'crm-generator', 80), signedAt: Number(input.signedAt || 0) || 0,
    signedIp: cleanText(input.signedIp, 100), signedUserAgent: cleanText(input.signedUserAgent, 500), documentHash: cleanText(input.documentHash, 128), createdAt: Number(input.createdAt || Date.now()) || Date.now(), updatedAt: Date.now(),
  };
}

function paymentStatusLabel(status) {
  const labels = { draft: 'Черновик', sent: 'Отправлен', signed: 'Подписан', waiting_payment: 'Ждём оплату', paid: 'Оплачен', in_work: 'В работе', done: 'Завершён', cancelled: 'Не состоялся' };
  return labels[status] || status || 'Черновик';
}

function executor() {
  return {
    brand: 'ТОО «ZakonExpert»', bin: cleanText(process.env.CRM_EXECUTOR_BIN || '260740044168', 30), director: cleanText(process.env.CRM_EXECUTOR_DIRECTOR || 'Кияшев Жанибек Даулетович', 160),
    address: cleanText(process.env.CRM_EXECUTOR_ADDRESS || 'Республика Казахстан, г. Талдыкорган, ул. Акын Сара, 152', 300), phone: cleanText(process.env.CRM_EXECUTOR_PHONE || '+7 700 309 7566', 60), website: cleanText(process.env.CRM_EXECUTOR_WEBSITE || 'zakonexpert.kz', 120),
    bankBeneficiary: cleanText(process.env.CRM_BANK_BENEFICIARY || 'ТОО «ZakonExpert»', 160), bankName: cleanText(process.env.CRM_BANK_NAME || '', 160), bankIdentifier: cleanText(process.env.CRM_BANK_IDENTIFIER || '260740044168', 30), bankBic: cleanText(process.env.CRM_BANK_BIC || '', 40), bankIban: cleanText(process.env.CRM_BANK_IBAN || '', 80), paymentPurpose: cleanText(process.env.CRM_BANK_PAYMENT_PURPOSE || 'Оплата по договору оказания услуг', 200), kaspiNumber: cleanText(process.env.CRM_KASPI_NUMBER || '', 60), kaspiReceiver: cleanText(process.env.CRM_KASPI_RECEIVER || '', 160),
  };
}

function contractText(contract) {
  const ex = executor();
  const signed = contract.signedAt ? `\n\nПРОСТАЯ ЭЛЕКТРОННАЯ ПОДПИСЬ КЛИЕНТА\nПодтверждено: ${new Date(contract.signedAt).toLocaleString('ru-RU', { timeZone: 'Asia/Almaty' })}\nIP: ${contract.signedIp || 'зафиксирован системой'}\nХеш документа: ${contract.documentHash || 'сформирован системой'}` : '';
  return [`ДОГОВОР ОКАЗАНИЯ УСЛУГ № ${contract.number}`, `${contract.city} · ${contract.date}`, '', `Исполнитель: ${ex.brand}, БИН ${ex.bin}, руководитель ${ex.director}.`, `Клиент: ${contract.clientName || 'не указан'}, ИИН ${contract.clientIin || 'не указан'}, телефон ${contract.clientPhone || 'не указан'}.`, '', '1. ПРЕДМЕТ И РЕЗУЛЬТАТ', `1.1. ${contract.serviceSubject}`, `1.2. В состав услуг входят: ${contract.serviceActions}.`, `1.3. Проверяемый результат: ${contract.resultDefinition}.`, '', '2. СРОКИ', `2.1. Срок действий Исполнителя: ${contract.workPeriod}.`, '2.2. Работа начинается после получения необходимых документов и сведений, а при предоплате — после поступления согласованной предоплаты.', '', '3. СТОИМОСТЬ И ОПЛАТА', `3.1. Стоимость услуг: ${formatMoney(contract.amount)} (${amountWords(contract.amount)}).`, `3.2. Порядок оплаты: ${contract.paymentTerms}.`, '', '4. ВЗАИМОДЕЙСТВИЕ И ДОКУМЕНТЫ', '4.1. Стороны вправе согласовывать текущие вопросы через WhatsApp, Telegram, электронную почту и CRM ZakonExpert.', '4.2. Клиент предоставляет достоверные сведения и документы, необходимые для исполнения договора.', '4.3. Персональные данные обрабатываются исключительно в объёме, необходимом для исполнения договора, договорного и бухгалтерского учёта.', '', '5. ЗАКЛЮЧИТЕЛЬНЫЕ ПОЛОЖЕНИЯ', '5.1. Договор вступает в силу с момента подписания либо подтверждения Клиентом через персональную страницу ZakonExpert.', '5.2. Электронные копии, переписка, подтверждения отправки и простая электронная подпись имеют доказательственное значение в пределах законодательства Республики Казахстан.', '', 'РЕКВИЗИТЫ', `${ex.brand} · БИН ${ex.bin} · ${ex.phone} · ${ex.website}`, `${ex.address}`, `Клиент: ${contract.clientName || 'не указан'} · ИИН ${contract.clientIin || 'не указан'} · ${contract.clientPhone || 'не указан'} · ${contract.clientAddress || 'адрес не указан'}`, signed].join('\n');
}

async function makePdf(contract) {
  let pdfMake;
  try {
    pdfMake = require('pdfmake/build/pdfmake');
    const vfsFonts = require('pdfmake/build/vfs_fonts');
    pdfMake.vfs = vfsFonts.pdfMake?.vfs || vfsFonts;
  } catch (error) { const e = new Error('CRM_PDF_DEPENDENCY_MISSING'); e.cause = error; throw e; }
  const ex = executor();
  const keyRows = [['УСЛУГА', contract.serviceSubject], ['РЕЗУЛЬТАТ', contract.resultDefinition], ['СРОК', contract.workPeriod], ['СТОИМОСТЬ', `${formatMoney(contract.amount)} (${amountWords(contract.amount)})`], ['ОПЛАТА', contract.paymentTerms]];
  const body = [
    { text: 'ZAKONEXPERT', style: 'brand' }, { text: 'ЮРИДИЧЕСКОЕ СОПРОВОЖДЕНИЕ', style: 'eyebrow' }, { text: `ДОГОВОР ОКАЗАНИЯ УСЛУГ № ${contract.number}`, style: 'title' }, { text: `${contract.city} · ${contract.date}`, style: 'meta' }, { text: `${ex.brand} · БИН ${ex.bin} · ${ex.phone} · ${ex.website}`, style: 'meta', margin: [0, 0, 0, 14] },
    { columns: [{ width: '*', stack: [{ text: 'ИСПОЛНИТЕЛЬ', style: 'label' }, { text: ex.brand, bold: true }, { text: `БИН ${ex.bin}` }, { text: ex.director }] }, { width: '*', stack: [{ text: 'КЛИЕНТ', style: 'label' }, { text: contract.clientName || 'не указан', bold: true }, { text: `ИИН ${contract.clientIin || 'не указан'}` }, { text: contract.clientPhone || 'телефон не указан' }] }], columnGap: 18, margin: [0, 0, 0, 14] },
    { text: 'КЛЮЧЕВЫЕ УСЛОВИЯ', style: 'h2' }, { table: { widths: [85, '*'], body: keyRows.map(([a, b]) => [{ text: a, bold: true, color: '#0B365E' }, { text: b || '—' }]) }, layout: 'lightHorizontalLines', margin: [0, 0, 0, 16] },
    { text: '01 · ПРЕДМЕТ И РЕЗУЛЬТАТ', style: 'h2' }, { text: `1.1. ${contract.serviceSubject}`, style: 'p' }, { text: `1.2. В состав услуг входят: ${contract.serviceActions}.`, style: 'p' }, { text: `1.3. Проверяемый результат оказания услуг: ${contract.resultDefinition}. Исполнитель подтверждает выполненные действия документами, талонами, ответами органов, перепиской либо иными объективными материалами.`, style: 'p' },
    { text: '02 · ПОРЯДОК И СРОКИ', style: 'h2' }, { text: '2.1. Исполнитель начинает работу после получения необходимых документов и сведений Клиента, а при предоплате — после её поступления.', style: 'p' }, { text: `2.2. Срок действий Исполнителя: ${contract.workPeriod}.`, style: 'p' },
    { text: '03 · СТОИМОСТЬ И ОПЛАТА', style: 'h2' }, { text: `3.1. Стоимость услуг составляет ${formatMoney(contract.amount)} (${amountWords(contract.amount)}).`, style: 'p' }, { text: `3.2. Порядок оплаты: ${contract.paymentTerms}.`, style: 'p' },
    { text: '04 · ВЗАИМОДЕЙСТВИЕ И ДАННЫЕ', style: 'h2' }, { text: '4.1. Стороны вправе согласовывать текущие вопросы через WhatsApp, Telegram, электронную почту и CRM ZakonExpert.', style: 'p' }, { text: '4.2. Клиент предоставляет достоверные сведения и документы, необходимые для исполнения договора.', style: 'p' }, { text: '4.3. Клиент даёт согласие на обработку персональных данных в объёме, необходимом для исполнения договора, договорного и бухгалтерского учёта.', style: 'p' },
    { text: '05 · ЗАКЛЮЧИТЕЛЬНЫЕ ПОЛОЖЕНИЯ', style: 'h2' }, { text: '5.1. Договор вступает в силу с момента подписания Сторонами либо подтверждения Клиентом через персональную страницу ZakonExpert.', style: 'p' }, { text: '5.2. Электронные копии, переписка, подтверждения отправки и простая электронная подпись имеют доказательственное значение в пределах законодательства Республики Казахстан.', style: 'p' },
    { text: 'РЕКВИЗИТЫ И ПОДПИСИ', style: 'h2', pageBreak: 'before' }, { columns: [{ width: '*', stack: [{ text: 'ИСПОЛНИТЕЛЬ', style: 'label' }, { text: ex.brand, bold: true }, { text: `БИН: ${ex.bin}` }, { text: `Руководитель: ${ex.director}` }, { text: ex.address }, { text: `Тел./WhatsApp: ${ex.phone}` }, { text: `Сайт: ${ex.website}` }] }, { width: '*', stack: [{ text: 'КЛИЕНТ', style: 'label' }, { text: contract.clientName || 'не указан', bold: true }, { text: `ИИН: ${contract.clientIin || 'не указан'}` }, { text: `Тел./WhatsApp: ${contract.clientPhone || 'не указан'}` }, { text: `Адрес: ${contract.clientAddress || 'не указан'}` }] }], columnGap: 18, margin: [0, 0, 0, 18] },
    { text: 'ПЛАТЁЖНЫЕ РЕКВИЗИТЫ', style: 'h2' }, { text: [ex.bankName ? `Банк: ${ex.bankName}\n` : '', ex.bankIban ? `IBAN KZT: ${ex.bankIban}\n` : '', ex.bankBic ? `БИК/SWIFT: ${ex.bankBic}\n` : '', ex.kaspiNumber ? `Kaspi: ${ex.kaspiNumber}${ex.kaspiReceiver ? ` · ${ex.kaspiReceiver}` : ''}\n` : '', `Назначение: ${ex.paymentPurpose}`].join(''), style: 'p' }, { text: `Статус договора: ${paymentStatusLabel(contract.status)}`, style: 'meta', margin: [0, 12, 0, 8] },
  ];
  if (contract.signedAt) body.push({ text: 'ПРОСТАЯ ЭЛЕКТРОННАЯ ПОДПИСЬ КЛИЕНТА', style: 'h2' }, { text: `Клиент подтвердил договор: ${new Date(contract.signedAt).toLocaleString('ru-RU', { timeZone: 'Asia/Almaty' })}`, style: 'p' }, { text: `IP: ${contract.signedIp || 'зафиксирован системой'}`, style: 'meta' }, { text: `Хеш документа: ${contract.documentHash || 'сформирован системой'}`, style: 'meta' });
  else body.push({ text: 'Подпись Клиента: __________________________', margin: [0, 26, 0, 6] }, { text: `ФИО: ${contract.clientName || '________________'}` }, { text: 'Дата подписания: __________________________' });
  const definition = { pageSize: 'A4', pageMargins: [46, 42, 46, 46], defaultStyle: { font: 'Roboto', fontSize: 9.5, color: '#1C2B3A', lineHeight: 1.2 }, styles: { brand: { fontSize: 15, bold: true, color: '#0B365E', letterSpacing: 1.2 }, eyebrow: { fontSize: 7.5, bold: true, color: '#C59324', margin: [0, 1, 0, 10] }, title: { fontSize: 18, bold: true, color: '#0B365E', margin: [0, 0, 0, 4] }, meta: { fontSize: 8, color: '#667085' }, label: { fontSize: 7.5, bold: true, color: '#C59324', margin: [0, 0, 0, 4] }, h2: { fontSize: 10, bold: true, color: '#0B365E', margin: [0, 12, 0, 6] }, p: { fontSize: 9.5, margin: [0, 0, 0, 6], alignment: 'justify' } }, footer(currentPage, pageCount) { return { text: `ZakonExpert · Договор № ${contract.number} · ${currentPage}/${pageCount}`, alignment: 'center', color: '#98A2B3', fontSize: 7, margin: [0, 12, 0, 0] }; }, content: body };
  return new Promise((resolve, reject) => { try { pdfMake.createPdf(definition).getBuffer(buffer => resolve(Buffer.from(buffer))); } catch (error) { reject(error); } });
}

async function makeDocx(contract) {
  let docx;
  try { docx = require('docx'); } catch (error) { const e = new Error('CRM_DOCX_DEPENDENCY_MISSING'); e.cause = error; throw e; }
  const { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, Table, TableRow, TableCell, WidthType } = docx;
  const ex = executor();
  const heading = text => new Paragraph({ text, heading: HeadingLevel.HEADING_2, spacing: { before: 220, after: 100 } });
  const p = text => new Paragraph({ children: [new TextRun({ text, size: 20 })], spacing: { after: 100 }, alignment: AlignmentType.JUSTIFIED });
  const keyRows = [['УСЛУГА', contract.serviceSubject], ['РЕЗУЛЬТАТ', contract.resultDefinition], ['СРОК', contract.workPeriod], ['СТОИМОСТЬ', `${formatMoney(contract.amount)} (${amountWords(contract.amount)})`], ['ОПЛАТА', contract.paymentTerms]];
  const keyTable = new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: keyRows.map(([left, right]) => new TableRow({ children: [new TableCell({ width: { size: 23, type: WidthType.PERCENTAGE }, children: [new Paragraph({ children: [new TextRun({ text: left, bold: true, color: '0B365E', size: 18 })] })] }), new TableCell({ width: { size: 77, type: WidthType.PERCENTAGE }, children: [new Paragraph({ children: [new TextRun({ text: right || '—', size: 18 })] })] })] })) });
  const children = [new Paragraph({ children: [new TextRun({ text: 'ZAKONEXPERT', bold: true, color: '0B365E', size: 30 })] }), new Paragraph({ children: [new TextRun({ text: 'ЮРИДИЧЕСКОЕ СОПРОВОЖДЕНИЕ', bold: true, color: 'C59324', size: 15 })], spacing: { after: 200 } }), new Paragraph({ text: `ДОГОВОР ОКАЗАНИЯ УСЛУГ № ${contract.number}`, heading: HeadingLevel.TITLE }), new Paragraph({ text: `${contract.city} · ${contract.date}`, spacing: { after: 180 } }), p(`Исполнитель: ${ex.brand}, БИН ${ex.bin}, руководитель ${ex.director}.`), p(`Клиент: ${contract.clientName || 'не указан'}, ИИН ${contract.clientIin || 'не указан'}, телефон ${contract.clientPhone || 'не указан'}.`), heading('КЛЮЧЕВЫЕ УСЛОВИЯ'), keyTable, heading('01 · ПРЕДМЕТ И РЕЗУЛЬТАТ'), p(`1.1. ${contract.serviceSubject}`), p(`1.2. В состав услуг входят: ${contract.serviceActions}.`), p(`1.3. Проверяемый результат оказания услуг: ${contract.resultDefinition}. Исполнитель подтверждает выполненные действия документами, талонами, ответами органов, перепиской либо иными объективными материалами.`), heading('02 · ПОРЯДОК И СРОКИ'), p('2.1. Исполнитель начинает работу после получения необходимых документов и сведений Клиента, а при предоплате — после её поступления.'), p(`2.2. Срок действий Исполнителя: ${contract.workPeriod}.`), heading('03 · СТОИМОСТЬ И ОПЛАТА'), p(`3.1. Стоимость услуг составляет ${formatMoney(contract.amount)} (${amountWords(contract.amount)}).`), p(`3.2. Порядок оплаты: ${contract.paymentTerms}.`), heading('04 · ВЗАИМОДЕЙСТВИЕ И ДАННЫЕ'), p('4.1. Стороны вправе согласовывать текущие вопросы через WhatsApp, Telegram, электронную почту и CRM ZakonExpert.'), p('4.2. Клиент предоставляет достоверные сведения и документы, необходимые для исполнения договора.'), p('4.3. Клиент даёт согласие на обработку персональных данных в объёме, необходимом для исполнения договора, договорного и бухгалтерского учёта.'), heading('05 · ЗАКЛЮЧИТЕЛЬНЫЕ ПОЛОЖЕНИЯ'), p('5.1. Договор вступает в силу с момента подписания Сторонами либо подтверждения Клиентом через персональную страницу ZakonExpert.'), p('5.2. Электронные копии, переписка, подтверждения отправки и простая электронная подпись имеют доказательственное значение в пределах законодательства Республики Казахстан.'), heading('РЕКВИЗИТЫ И ПОДПИСИ'), p(`${ex.brand}\nБИН: ${ex.bin}\nРуководитель: ${ex.director}\n${ex.address}\nТел./WhatsApp: ${ex.phone}\nСайт: ${ex.website}`), p(`Клиент: ${contract.clientName || 'не указан'}\nИИН: ${contract.clientIin || 'не указан'}\nТел./WhatsApp: ${contract.clientPhone || 'не указан'}\nАдрес: ${contract.clientAddress || 'не указан'}`)];
  if (contract.signedAt) { children.push(heading('ПРОСТАЯ ЭЛЕКТРОННАЯ ПОДПИСЬ КЛИЕНТА')); children.push(p(`Клиент подтвердил договор: ${new Date(contract.signedAt).toLocaleString('ru-RU', { timeZone: 'Asia/Almaty' })}\nIP: ${contract.signedIp || 'зафиксирован системой'}\nХеш документа: ${contract.documentHash || 'сформирован системой'}`)); }
  else children.push(p(`Подпись Клиента: __________________________\n${contract.clientName || ''}\nДата подписания: __________________________`));
  const doc = new Document({ sections: [{ properties: {}, children }] });
  return Buffer.from(await Packer.toBuffer(doc));
}

async function generateFiles(contract) {
  const normalized = normalizeDraft(contract, {});
  if (!normalized.number) throw new Error('CONTRACT_NUMBER_REQUIRED');
  if (!normalized.clientName && !normalized.clientIin && !normalized.clientPhone) throw new Error('CLIENT_REQUIRED');
  if (!normalized.serviceSubject) throw new Error('SERVICE_REQUIRED');
  const fileKey = cleanText(contract.fileKey || crypto.randomUUID(), 100).replace(/[^a-zA-Z0-9_-]/g, '') || crypto.randomUUID();
  const pdf = await makePdf(normalized);
  const docx = await makeDocx(normalized);
  const hash = crypto.createHash('sha256').update(pdf).digest('hex');
  fs.writeFileSync(contractFilePath(fileKey, 'pdf'), pdf, { mode: 0o600 });
  fs.writeFileSync(contractFilePath(fileKey, 'docx'), docx, { mode: 0o600 });
  return { fileKey, pdfBytes: pdf.length, docxBytes: docx.length, documentHash: hash };
}

function documentHashFromContract(contract) { return crypto.createHash('sha256').update(contractText(contract), 'utf8').digest('hex'); }

async function parsePdf(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 5 || buffer.length > MAX_UPLOAD_BYTES) throw new Error('BAD_PDF_SIZE');
  if (buffer.subarray(0, 5).toString('ascii') !== '%PDF-') throw new Error('BAD_PDF');
  let pdfParse;
  try { pdfParse = require('pdf-parse'); } catch (error) { const e = new Error('CRM_PDF_PARSE_DEPENDENCY_MISSING'); e.cause = error; throw e; }
  const parsed = await pdfParse(buffer);
  return cleanText(parsed.text, 200000);
}

function firstMatch(text, patterns, cleanup = v => v) { for (const pattern of patterns) { const match = text.match(pattern); if (match && match[1]) return cleanup(match[1]); } return ''; }

function parseLegacyContractText(text) {
  const compact = String(text || '').replace(/\r/g, '').replace(/[ \t]+/g, ' ');
  const number = firstMatch(compact, [/ДОГОВОР(?:\s+ОКАЗАНИЯ\s+УСЛУГ)?\s*№\s*([A-ZА-ЯЁ0-9][A-ZА-ЯЁ0-9._\/-]{0,50})/i, /НОМЕР ДОГОВОРА\s*№?\s*([A-ZА-ЯЁ0-9][A-ZА-ЯЁ0-9._\/-]{0,50})/i], v => cleanText(v, 80));
  const iin = firstMatch(compact, [/КЛИЕНТ[\s\S]{0,500}?ИИН\s*[:№]?\s*(\d{12})/i, /ИИН\s*[:№]?\s*(\d{12})/i], v => v.replace(/\D/g, '').slice(0, 12));
  const phone = firstMatch(compact, [/КЛИЕНТ[\s\S]{0,600}?(?:Телефон\/WhatsApp|Тел\.\/WhatsApp|Телефон|WhatsApp)\s*:?\s*(\+?7[\d ()-]{9,20})/i, /(?:Телефон\/WhatsApp|Тел\.\/WhatsApp)\s*:?\s*(\+?7[\d ()-]{9,20})/i], v => cleanText(v.replace(/\s+/g, ' '), 60));
  const name = firstMatch(compact, [/КЛИЕНТ\s*\n?\s*(?:ФИО\s*:\s*)?([А-ЯЁӘІҢҒҮҰҚӨҺA-Z][А-ЯЁӘІҢҒҮҰҚӨҺA-Zа-яёәіңғүұқөһa-z'’\- ]{5,120}?)(?=\s+ИИН\b|\n)/, /(?:ФИО|Клиент)\s*:\s*([А-ЯЁӘІҢҒҮҰҚӨҺA-Z][А-ЯЁӘІҢҒҮҰҚӨҺA-Zа-яёәіңғүұқөһa-z'’\- ]{5,120}?)(?=\s+ИИН\b|\n)/i], v => cleanText(v.replace(/\s+/g, ' '), 180));
  const amountRaw = firstMatch(compact, [/(?:СТОИМОСТЬ|стоимость услуг составляет|стоимость услуг:)\s*[:·-]?\s*([\d\s]+)\s*(?:₸|тенге)/i, /составляет\s+([\d\s]+)\s*\([^)]*\)\s*тенге/i], v => v);
  const amount = parseMoney(amountRaw);
  const workPeriod = firstMatch(compact, [/(?:СРОК РАБОТЫ|СРОК ДЕЙСТВИЙ ИСПОЛНИТЕЛЯ|СРОК)\s*[:·-]?\s*([^\n]{3,100})/i], v => cleanText(v, 160));
  const date = firstMatch(compact, [/(?:ДАТА\s*)?([0-3]?\d[.\/-][01]?\d[.\/-]20\d{2})/i, /«(\d{1,2})»\s+[а-яёәіңғүұқөһ]+\s+(20\d{2})/i], v => cleanText(v, 40));
  const address = firstMatch(compact, [/КЛИЕНТ[\s\S]{0,700}?Адрес\s*:\s*([^\n]{3,250})/i], v => cleanText(v, 300));
  const serviceSubject = firstMatch(compact, [/(?:01\s+УСЛУГА|1\.1\.)\s*([^\n]{20,1000})/i], v => cleanText(v, 1400));
  return { number, iin, phone, name, amount, workPeriod, date, address, serviceSubject };
}

async function importPdf(buffer, filename) {
  const text = await parsePdf(buffer);
  const fields = parseLegacyContractText(text);
  const fileKey = crypto.randomUUID();
  fs.writeFileSync(contractFilePath(fileKey, 'upload.pdf'), buffer, { mode: 0o600 });
  return { fileKey, originalFilename: safeFileBase(filename || 'contract.pdf') + '.pdf', fields, extractedTextLength: text.length, importedHash: crypto.createHash('sha256').update(buffer).digest('hex') };
}

function readFile(fileKey, kind) {
  const ext = kind === 'docx' ? 'docx' : kind === 'upload' ? 'upload.pdf' : 'pdf';
  const file = contractFilePath(fileKey, ext);
  if (!fs.existsSync(file)) return null;
  return file;
}

function signToken() { const raw = crypto.randomBytes(32).toString('base64url'); return { raw, hash: crypto.createHash('sha256').update(raw).digest('hex') }; }
function hashSignToken(raw) { return crypto.createHash('sha256').update(String(raw || '')).digest('hex'); }

module.exports = { SERVICE_PRESETS, MAX_UPLOAD_BYTES, amountWords, almatyDateParts, normalizeDraft, generateFiles, importPdf, parseLegacyContractText, readFile, signToken, hashSignToken, documentHashFromContract, paymentStatusLabel, contractText };
