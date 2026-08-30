'use strict';

// CRM bootstrap. Plesk should use this file as the Node.js startup file.
// It keeps the large production server.js untouched while mounting the private
// CRM before the public routes and extending the already-running Telegram bot.

require('dotenv').config();

const axios = require('axios');
const crmDb = require('./modules/crm-db');
const { installCrm } = require('./modules/crm-routes');
const telegram = require('./modules/telegram');

function esc(text) {
  return String(text || '—').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function money(value) {
  return Number(value || 0).toLocaleString('ru-RU');
}

function crmButtons(clientId) {
  return {
    inline_keyboard: [
      [
        { text: '☎️ Связались', callback_data: `crm:${clientId}:contacted` },
        { text: '✅ Согласился', callback_data: `crm:${clientId}:agreed` },
      ],
      [
        { text: '🧰 В работу', callback_data: `crm:${clientId}:in_work` },
        { text: '💳 Ждём оплату', callback_data: `crm:${clientId}:waiting_payment` },
      ],
      [
        { text: '💰 Оплачено', callback_data: `crm:${clientId}:paid` },
        { text: '❌ Отказ', callback_data: `crm:${clientId}:declined` },
      ],
    ],
  };
}

async function sendCrmCard(client, title = 'CRM') {
  if (!client) return;
  const lines = [
    `📒 <b>${esc(title)}</b>`,
    `👤 ${esc(client.name || 'Без имени')}`,
    `📞 <code>${esc(client.phone)}</code>`,
    client.issue ? `📌 ${esc(client.issue)}` : null,
    `Статус: <b>${esc(crmDb.STATUS[client.status] || client.status)}</b>`,
  ].filter(Boolean);
  await telegram.send(lines.join('\n'), { reply_markup: crmButtons(client._id) });
}

// Extend existing website lead/application notifications with CRM persistence.
const originalNotifyLead = telegram.notifyLead.bind(telegram);
telegram.notifyLead = function notifyLeadWithCrm(data, ip, ua) {
  const result = originalNotifyLead(data, ip, ua);
  crmDb.upsertByPhone({
    ...data,
    source: data.source || 'website',
  }, 'website').then(client => sendCrmCard(client, 'Новая заявка добавлена в CRM')).catch(() => {});
  return result;
};

const originalNotifyApplication = telegram.notifyApplication.bind(telegram);
telegram.notifyApplication = function notifyApplicationWithCrm(data, ip, ua) {
  const result = originalNotifyApplication(data, ip, ua);
  crmDb.upsertByPhone({
    name: data.name,
    phone: data.phone,
    issue: data.bank || 'Заявка',
    question: data.description || '',
    source: 'website-application',
  }, 'website').then(client => sendCrmCard(client, 'Заявка добавлена в CRM')).catch(() => {});
  return result;
};

function splitArgs(text) {
  return String(text || '').split('|').map(part => part.trim());
}

function commandBody(text, command) {
  return String(text || '').replace(new RegExp(`^/${command}(?:@\\w+)?\\s*`, 'i'), '').trim();
}

function statusKey(value) {
  const raw = String(value || '').trim().toLowerCase().replace(/\s+/g, '_');
  const aliases = {
    new: 'new', новый: 'new',
    contacted: 'contacted', связались: 'contacted',
    agreed: 'agreed', согласился: 'agreed', согласилась: 'agreed',
    declined: 'declined', отказ: 'declined', отказался: 'declined', отказалась: 'declined',
    in_work: 'in_work', работа: 'in_work', 'в_работе': 'in_work',
    waiting_payment: 'waiting_payment', ждем_оплату: 'waiting_payment', ждём_оплату: 'waiting_payment',
    paid: 'paid', оплачено: 'paid', оплатил: 'paid', оплатила: 'paid',
    done: 'done', готово: 'done', завершено: 'done',
    lost: 'lost', потерян: 'lost',
  };
  return aliases[raw] || (crmDb.STATUS_KEYS.has(raw) ? raw : '');
}

async function telegramSend(text, opts = {}) {
  return telegram.send(text, opts);
}

async function answerCallback(id, text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token || !id) return;
  try {
    await axios.post(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
      callback_query_id: id,
      text: String(text || '').slice(0, 180),
      show_alert: false,
    }, { timeout: 5000 });
  } catch (_) {}
}

async function handleCrmTelegramUpdate(update) {
  const ownChatId = String(process.env.TELEGRAM_CHAT_ID || '');
  const msg = update?.message;
  const cbq = update?.callback_query;

  if (msg && String(msg.chat?.id || '') === ownChatId) {
    const text = String(msg.text || '').trim();

    if (/^\/crm(?:@\w+)?$/i.test(text)) {
      const s = await crmDb.summary();
      const lines = [
        '📒 <b>ZakonExpert CRM</b>',
        '',
        `Всего клиентов: <b>${s.total}</b>`,
        `🆕 Новые: <b>${s.byStatus.new || 0}</b>`,
        `✅ Согласились: <b>${s.byStatus.agreed || 0}</b>`,
        `🧰 В работе: <b>${s.byStatus.in_work || 0}</b>`,
        `💳 Ждём оплату: <b>${s.byStatus.waiting_payment || 0}</b>`,
        `💰 Оплачено: <b>${s.byStatus.paid || 0}</b>`,
        `⚠️ Просроченных обещаний: <b>${s.overduePromises}</b>`,
        '',
        `Обещано: <b>${money(s.promiseTotal)} ₸</b>`,
        `Оплачено: <b>${money(s.paidTotal)} ₸</b>`,
        '',
        'CRM: https://zakonexpert.kz/crm',
      ];
      await telegramSend(lines.join('\n'));
      return;
    }

    if (/^\/client(?:@\w+)?\s/i.test(text)) {
      const [phone, name = ''] = splitArgs(commandBody(text, 'client'));
      try {
        const client = await crmDb.upsertByPhone({ phone, name, source: 'telegram' }, 'telegram');
        await sendCrmCard(client, 'Клиент сохранён');
      } catch (_) {
        await telegramSend('❗ Формат: <code>/client +77001234567 | Имя</code>');
      }
      return;
    }

    if (/^\/status(?:@\w+)?\s/i.test(text)) {
      const [phone, rawStatus] = splitArgs(commandBody(text, 'status'));
      const status = statusKey(rawStatus);
      if (!phone || !status) {
        await telegramSend('❗ Формат: <code>/status +77001234567 | in_work</code>');
        return;
      }
      const client = await crmDb.setStatusByPhone(phone, status, 'telegram');
      await sendCrmCard(client, 'Статус обновлён');
      return;
    }

    if (/^\/promise(?:@\w+)?\s/i.test(text)) {
      const [phone, amount, date, note = ''] = splitArgs(commandBody(text, 'promise'));
      if (!phone) {
        await telegramSend('❗ Формат: <code>/promise +77001234567 | 50000 | 2026-09-05 | комментарий</code>');
        return;
      }
      const client = await crmDb.addPromiseByPhone(phone, { amount, date, note }, 'telegram');
      await telegramSend(`📅 Обещание сохранено для <b>${esc(client.name || client.phone)}</b>: ${money(client.promiseAmount)} ₸${client.promiseDate ? ` до ${esc(client.promiseDate)}` : ''}`);
      return;
    }

    if (/^\/paid(?:@\w+)?\s/i.test(text)) {
      const [phone, amount] = splitArgs(commandBody(text, 'paid'));
      if (!phone || !amount) {
        await telegramSend('❗ Формат: <code>/paid +77001234567 | 50000</code>');
        return;
      }
      const client = await crmDb.addPaymentByPhone(phone, { amount }, 'telegram');
      await telegramSend(`💰 Оплата записана: <b>${esc(client.name || client.phone)}</b> — всего ${money(client.paidAmount)} ₸`);
      return;
    }

    if (/^\/contract(?:@\w+)?\s/i.test(text)) {
      const [phone, title = 'Договор', number = '', amount = ''] = splitArgs(commandBody(text, 'contract'));
      if (!phone) {
        await telegramSend('❗ Формат: <code>/contract +77001234567 | Договор на услуги | ZE-123 | 100000</code>');
        return;
      }
      const result = await crmDb.addContractByPhone(phone, { title, number, amount }, 'telegram');
      await telegramSend(`📄 Договор сохранён: <b>${esc(result.contract.title)}</b>${result.contract.number ? ` №${esc(result.contract.number)}` : ''} → ${esc(result.client.name || result.client.phone)}`);
      return;
    }

    if (/^\/note(?:@\w+)?\s/i.test(text)) {
      const [phone, ...rest] = splitArgs(commandBody(text, 'note'));
      const note = rest.join(' | ');
      if (!phone || !note) {
        await telegramSend('❗ Формат: <code>/note +77001234567 | Клиент просил перезвонить завтра</code>');
        return;
      }
      const client = await crmDb.addNoteByPhone(phone, note, 'telegram');
      await telegramSend(`📝 Заметка сохранена: <b>${esc(client.name || client.phone)}</b>`);
      return;
    }

    if (/^\/help(?:@\w+)?$/i.test(text) || /^\/start(?:@\w+)?$/i.test(text)) {
      // Existing bot sends its own help too; append CRM commands in a separate compact message.
      await telegramSend([
        '📒 <b>CRM-команды:</b>',
        '/crm — сводка CRM',
        '/client телефон | имя',
        '/status телефон | in_work',
        '/promise телефон | сумма | YYYY-MM-DD | комментарий',
        '/paid телефон | сумма',
        '/contract телефон | название | номер | сумма',
        '/note телефон | заметка',
      ].join('\n'));
    }
  }

  if (cbq && String(cbq.message?.chat?.id || '') === ownChatId) {
    const data = String(cbq.data || '');
    const match = data.match(/^crm:([^:]+):(new|contacted|agreed|declined|in_work|waiting_payment|paid|done|lost)$/);
    if (!match) return;
    const [, clientId, status] = match;
    const client = await crmDb.setStatus(clientId, status, 'telegram-button');
    await answerCallback(cbq.id, client ? `Статус: ${crmDb.STATUS[status]}` : 'Клиент не найден');
    if (client) await sendCrmCard(client, 'CRM обновлена');
  }
}

// Observe the same Telegram getUpdates response that the existing bot already
// polls. This avoids running a second competing poller or webhook.
const originalAxiosGet = axios.get.bind(axios);
axios.get = async function getWithCrmBridge(url, config) {
  const response = await originalAxiosGet(url, config);
  if (String(url).includes('/getUpdates')) {
    for (const update of response?.data?.result || []) {
      handleCrmTelegramUpdate(update).catch(() => {});
    }
  }
  return response;
};

// Wrap express() so CRM routes are registered before the public app's final
// catch-all 404 without editing the large production server.js.
const expressModuleId = require.resolve('express');
const originalExpress = require(expressModuleId);
function expressWithCrm(...args) {
  const app = originalExpress(...args);
  installCrm(app, originalExpress);
  return app;
}
Object.assign(expressWithCrm, originalExpress);
Object.setPrototypeOf(expressWithCrm, originalExpress);
require.cache[expressModuleId].exports = expressWithCrm;

// Continue with the normal production server.
require('./server');
