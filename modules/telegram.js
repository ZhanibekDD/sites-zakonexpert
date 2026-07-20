'use strict';

const axios = require('axios');

// ── Dedup cache ─────────────────────────────────────────────────────────────
const visitCache = new Map();
const VISIT_COOLDOWN = 30 * 60 * 1000; // 30 min
const VISIT_CACHE_MAX = 5000;

// ── Bot detection ─────────────────────────────────────────────────────────────
const BOT_UA_RE = /bot|crawl|spider|scraper|google-inspectiontool|google-structured-data|adsbot|mediapartners|yandex\.com\/bots|bingpreview|msnbot|slurp|duckduckbot|baiduspider|ia_archiver|archive\.org|facebookexternalhit|twitterbot|linkedinbot|slackbot|telegrambot|applebot|pinterestbot|semrushbot|ahrefsbot|majesticbot|mj12bot|dotbot|rogerbot|petalbot|dataforseo|seznambot|naver|sogou|uptimerobot|pingdom|newrelic|site24x7|statuscake|nagios|zabbix|datadog|curl\/|wget\/|python[-\/]|libwww-perl|okhttp\/|go-http-client\/|java\/[0-9]|nmap|masscan|zgrab|nuclei|nikto|sqlmap/i;

function isBot(ua) {
  if (!ua || ua.trim().length < 10) return true;
  return BOT_UA_RE.test(ua);
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function esc(text) {
  return String(text || '—').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function now() {
  return new Date().toLocaleString('ru-RU', {
    timeZone: 'Asia/Almaty',
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function device(ua) {
  if (!ua) return 'Неизвестно';
  const mob = /mobile|android|iphone|ipad/i.test(ua);
  let br = 'Другой';
  if (/YaBrowser/i.test(ua)) br = 'Яндекс';
  else if (/Chrome/i.test(ua) && !/Edge|OPR/i.test(ua)) br = 'Chrome';
  else if (/Safari/i.test(ua) && !/Chrome/i.test(ua)) br = 'Safari';
  else if (/Firefox/i.test(ua)) br = 'Firefox';
  else if (/Edge/i.test(ua)) br = 'Edge';
  return `${mob ? '📱 Mobile' : '🖥 Desktop'} · ${br}`;
}

function refSource(referer) {
  if (!referer) return '';
  try {
    const host = new URL(referer).hostname.toLowerCase();
    if (/google/i.test(host))              return '🔍 Google';
    if (/yandex/i.test(host))              return '🔍 Яндекс';
    if (/2gis|dgis/i.test(host))          return '🗺 2GIS';
    if (/facebook|fb\.com/i.test(host))   return '📘 Facebook';
    if (/instagram/i.test(host))          return '📸 Instagram';
    if (/t\.me|telegram/i.test(host))     return '✈️ Telegram';
    if (/whatsapp/i.test(host))           return '💬 WhatsApp';
    if (host.includes('zakonexpertt.kz')) return '';
    return `🔗 ${host}`;
  } catch (_) { return ''; }
}

// ── Page labels ───────────────────────────────────────────────────────────────
const PAGE_LABELS = {
  '/':                                     '🏠 Главная',
  '/index.html':                           '🏠 Главная',
  '/services.html':                        '📋 Услуги',
  '/contact.html':                         '📞 Контакты',
  '/advocate':                             '⚖️ Адвокат Маулен',
  '/mediator':                             '🕊 Медиатор Нурғиса',
  '/arest-kaspi':                          '🏦 Арест Kaspi',
  '/arest-kaspi.html':                     '🏦 Арест Kaspi',
  '/arest-halyk-bank':                     '🏦 Арест Halyk',
  '/arest-freedom-bank':                   '🏦 Арест Freedom',
  '/ispolnitelnaya-nadpis.html':           '📄 Исп. надпись',
  '/otmena-ispolnitelnoi-nadpisi':         '📄 Исп. надпись',
  '/snyatie-zapreta-na-avto.html':         '🚗 Запрет авто',
  '/snyatie-zapreta-na-avto':              '🚗 Запрет авто',
  '/zapret-registracionnyh-deystviy':      '🚗 Запрет рег. действий',
  '/grafik-platezhey.html':                '📅 График платежей',
  '/grafik-oplaty-zadolzhennosti':         '📅 График платежей',
  '/chsi-arest-schetov.html':              '⚖️ ЧСИ аресты',
  '/chsi-arest-schetov':                   '⚖️ ЧСИ аресты',
  '/ubrat-procenty-i-rashody-chsi':        '💰 Расходы ЧСИ',
  '/zakony.html':                          '📚 Законы',
  '/statyi':                               '📚 Статьи законов',
  '/news':                                 '📰 Новости',
  '/besspornost-dolga.html':               '📋 Бесспорность долга',
  '/spornost-dolga':                       '📋 Спорность долга',
  '/otmena-resheniya-suda.html':           '🏛 Отмена решения суда',
  '/snyatie-aresta-so-scheta':             '💳 Снятие ареста',
  '/alimenty-i-aresty':                    '👶 Алименты и арест',
  '/shtrafy-i-aresty':                     '🚔 Штрафы и арест',
  '/snyatie-ogranicheniya-na-imushchestvo':'🏠 Арест имущества',
  '/snyatie-ogranichenii-u-notariusa':     '📝 Ограничения нотариуса',
  '/notaries':                             '📒 Каталог нотариусов',
  '/notary-search':                        '🔍 Поиск нотариуса',
  '/bailiffs':                             '📒 Каталог ЧСИ',
  '/bailiff-search':                       '🔍 Поиск ЧСИ',
  '/lawyers':                              '📒 Каталог адвокатов',
  '/lawyer-search':                        '🔍 Поиск адвоката',
  '/banks':                                '🏦 Банки Казахстана',
  '/mfo':                                  '💳 МФО Казахстана',
  '/courts':                               '🏛 Суды Казахстана',
  '/chambers':                             '📋 Палаты нотариусов и ЧСИ',
  '/companies':                            '🏢 Компании Казахстана',
  '/chsi-refinansirovanie':                '💼 ЧСИ Рефинансирование',
  '/dokumenty':                            '📁 Документы',
  '/rezultaty':                            '🏆 Результаты',
};
function pageLabel(url) { return PAGE_LABELS[url] || url; }

// ── Send message ──────────────────────────────────────────────────────────────
async function send(text, opts = {}) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return null;
  try {
    const res = await axios.post(
      `https://api.telegram.org/bot${token}/sendMessage`,
      { chat_id: chatId, text, parse_mode: 'HTML', ...opts },
      { timeout: 6000 }
    );
    return res.data?.result || null;
  } catch (_) { return null; }
}

async function sendToChat(chatId, text, opts = {}) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token || !chatId) return;
  try {
    await axios.post(
      `https://api.telegram.org/bot${token}/sendMessage`,
      { chat_id: chatId, text, parse_mode: 'HTML', ...opts },
      { timeout: 6000 }
    );
  } catch (_) {}
}

async function answerCallback(callbackQueryId, text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return;
  try {
    await axios.post(
      `https://api.telegram.org/bot${token}/answerCallbackQuery`,
      { callback_query_id: callbackQueryId, text },
      { timeout: 4000 }
    );
  } catch (_) {}
}

// ── Visitor notification ──────────────────────────────────────────────────────
function notifyVisit(page, ip, ua, referer) {
  if (isBot(ua)) return; // фильтруем Google/Yandex/Bing и прочих ботов

  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return;

  const realIp = String(ip || '').split(',')[0].trim();
  const key = `${realIp}:${page}`;
  const lastSeen = visitCache.get(key);
  if (lastSeen && Date.now() - lastSeen < VISIT_COOLDOWN) return;
  visitCache.set(key, Date.now());
  if (visitCache.size > VISIT_CACHE_MAX) {
    const cutoff = Date.now() - VISIT_COOLDOWN;
    for (const [cachedKey, timestamp] of visitCache) {
      if (timestamp < cutoff || visitCache.size > VISIT_CACHE_MAX) visitCache.delete(cachedKey);
      if (visitCache.size <= VISIT_CACHE_MAX) break;
    }
  }

  const src = refSource(referer);
  const lines = [
    `👁 <b>Посетитель на сайте</b>`,
    ``,
    `📄 <b>${esc(pageLabel(page))}</b>`,
    src ? `📡 ${src}` : null,
    `⏰ ${now()}`,
    `🌐 IP: <code>${esc(realIp)}</code>`,
    `📱 ${esc(device(ua))}`,
  ].filter(Boolean);
  send(lines.join('\n')).catch(() => {});
}

// ── Phone / WhatsApp click notification ──────────────────────────────────────
const TARGET_LABELS = {
  advocate: '⚖️ Адвокат Маулен +7 (777) 745-75-77',
  mediator: '🕊 Медиатор Нурғиса +7 (747) 964-13-06',
  main:     '📞 ZakonExpert +7 (700) 311-06-38',
};
const TYPE_ICONS = { phone: '📞 Звонок', whatsapp: '💬 WhatsApp' };

function notifyClick(type, target, page, ip, ua) {
  const label  = TARGET_LABELS[target] || target;
  const icon   = TYPE_ICONS[type]   || type;
  const lines = [
    `🔔 <b>${icon} — нажали контакт!</b>`,
    ``,
    `👤 ${label}`,
    `📄 Страница: ${esc(pageLabel(page) || page)}`,
    `⏰ ${now()}`,
    `🌐 IP: <code>${esc(String(ip || '').split(',')[0].trim())}</code>`,
    `📱 ${esc(device(ua))}`,
  ];
  send(lines.join('\n')).catch(() => {});
}

// ── IIN check notification ────────────────────────────────────────────────────
function notifyIinCheck(ip, ua, isDebtor, count, iin) {
  const maskedIin = iin ? String(iin).replace(/\D/g, '').substring(0, 4) + '********' : '—';
  const lines = [
    isDebtor ? `🚨 <b>Найдены аресты!</b>` : `🔍 <b>Проверка по ИИН</b>`,
    ``,
    `🪪 ИИН: <code>${maskedIin}</code>`,
    isDebtor ? `📊 Производств: <b>${count}</b> — потенциальный клиент!` : `📊 Производств не найдено`,
    `⏰ ${now()}`,
    `🌐 IP: <code>${esc(String(ip || '').split(',')[0].trim())}</code>`,
    `📱 ${esc(device(ua))}`,
  ];
  send(lines.join('\n')).catch(() => {});
}

// ── Application / Lead notification ──────────────────────────────────────────
function notifyApplication(data, ip, ua) {
  const lines = [
    `📩 <b>НОВАЯ ЗАЯВКА С САЙТА!</b>`,
    ``,
    `👤 Имя: <b>${esc(data.name)}</b>`,
    `📞 Телефон: <b>${esc(data.phone)}</b>`,
    `🏦 Банк / тип: ${esc(data.bank)}`,
    data.description ? `📝 ${esc(data.description)}` : null,
    ``,
    `⏰ ${now()}`,
    `🌐 IP: <code>${esc(String(ip || '').split(',')[0].trim())}</code>`,
    `📱 ${esc(device(ua))}`,
  ].filter(Boolean);
  send(lines.join('\n')).catch(() => {});
}

function notifyLead(data, ip, ua) {
  const issue_label = {
    arrest:   '💳 Арест счёта / карты',
    auto:     '🚗 Запрет на авто',
    debt:     '📄 Долг / надпись / ЧСИ',
    advocate: '⚖️ Нужен адвокат',
    mediator: '🕊 Нужен медиатор',
    grafik:   '📅 График платежей',
    other:    '❓ Другое',
  };
  const lines = [
    `🚀 <b>НОВАЯ ЗАЯВКА (чат-бот / форма)</b>`,
    ``,
    `👤 Имя: <b>${esc(data.name || '—')}</b>`,
    `📞 Телефон: <b>${esc(data.phone)}</b>`,
    `📌 Тема: ${esc(issue_label[data.issue] || data.issue || '—')}`,
    data.question ? `💬 Вопрос: ${esc(data.question)}` : null,
    data.page ? `📄 Страница: ${esc(pageLabel(data.page) || data.page)}` : null,
    ``,
    `⏰ ${now()}`,
    `🌐 IP: <code>${esc(String(ip || '').split(',')[0].trim())}</code>`,
    `📱 ${esc(device(ua))}`,
  ].filter(Boolean);
  send(lines.join('\n')).catch(() => {});
}

// ── Live chat widget message ──────────────────────────────────────────────────
async function notifyChatMessage(chatNumber, text, page, ip, ua) {
  const lines = [
    `💬 <b>Чат №${chatNumber} — сообщение с сайта</b>`,
    ``,
    esc(text),
    ``,
    page ? `📄 Страница: ${esc(pageLabel(page) || page)}` : null,
    `⏰ ${now()}`,
    `🌐 IP: <code>${esc(String(ip || '').split(',')[0].trim())}</code>`,
    `📱 ${esc(device(ua))}`,
  ].filter(Boolean);
  // force_reply puts Telegram's input box straight into "replying to this
  // message" mode — no manual swipe-to-reply needed, and it keeps multiple
  // concurrent visitor chats from getting mixed up.
  return send(lines.join('\n'), {
    reply_markup: { force_reply: true, selective: true, input_field_placeholder: `Ответ в чат №${chatNumber}` },
  });
}

// ── Bot polling & commands ────────────────────────────────────────────────────
let _pollOffset = 0;
let _pollActive = false;
let _pollTimer  = null;

async function getUpdates() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return [];
  try {
    const res = await axios.get(
      `https://api.telegram.org/bot${token}/getUpdates`,
      { params: { offset: _pollOffset, timeout: 20, limit: 50 }, timeout: 25000 }
    );
    const updates = res.data?.result || [];
    if (updates.length) _pollOffset = updates[updates.length - 1].update_id + 1;
    return updates;
  } catch (_) { return []; }
}

// Lazy-loaded so we don't break startup if DB isn't ready
let _clicksDb = null;
let _leadsDb  = null;
let _chatDb   = null;
function clicksDb() { if (!_clicksDb) _clicksDb = require('./clicks-db'); return _clicksDb; }
function leadsDb()  { if (!_leadsDb)  _leadsDb  = require('./leads-db');  return _leadsDb;  }
function chatDb()   { if (!_chatDb)   _chatDb   = require('./chat-db');   return _chatDb;   }

function fmtStats(stats, leadsCount, period) {
  const t = (n, s) => `${n} ${s}`;
  return [
    `📊 <b>Статистика — ${period}</b>`,
    ``,
    `<b>📞 Звонки:</b>`,
    `  ⚖️ Адвокат: <b>${stats.phone_advocate}</b>`,
    `  🕊 Медиатор: <b>${stats.phone_mediator}</b>`,
    `  📞 ZakonExpert: <b>${stats.phone_main}</b>`,
    ``,
    `<b>💬 WhatsApp:</b>`,
    `  ⚖️ Адвокат: <b>${stats.wa_advocate}</b>`,
    `  🕊 Медиатор: <b>${stats.wa_mediator}</b>`,
    `  📞 ZakonExpert: <b>${stats.wa_main}</b>`,
    ``,
    `<b>📩 Заявки (форма/чат-бот): ${leadsCount}</b>`,
    `<b>🔢 Всего нажатий: ${stats.total}</b>`,
  ].join('\n');
}

const STATS_KB = {
  inline_keyboard: [[
    { text: 'Сегодня',    callback_data: 'stats_today' },
    { text: '7 дней',     callback_data: 'stats_week'  },
    { text: '30 дней',    callback_data: 'stats_month' },
    { text: 'Всё время',  callback_data: 'stats_all'   },
  ]],
};

async function handleUpdate(update) {
  const ownChatId = process.env.TELEGRAM_CHAT_ID;
  const msg = update.message;
  const cbq = update.callback_query;

  if (msg) {
    const fromId = String(msg.chat?.id || '');
    if (ownChatId && fromId !== String(ownChatId)) return; // ignore strangers
    const text = (msg.text || '').trim();

    if (msg.reply_to_message && text) {
      const routed = await chatDb().addAdminMessageByBotMsgId(msg.reply_to_message.message_id, text);
      if (routed) {
        await sendToChat(fromId, `✅ Отправлено в чат №${routed.chatNumber} на сайте`);
        return;
      }
    }

    if (text === '/stats' || text === '/stat') {
      await sendToChat(fromId, '📊 <b>Выберите период для статистики:</b>', { reply_markup: STATS_KB });
      return;
    }

    if (text === '/leads') {
      const leads = await leadsDb().getRecent(5);
      if (!leads.length) { await sendToChat(fromId, '📭 Заявок пока нет.'); return; }
      const lines = ['📩 <b>Последние заявки:</b>', ''];
      for (const l of leads) {
        const d = new Date(l.ts).toLocaleString('ru-RU', { timeZone: 'Asia/Almaty', day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' });
        lines.push(`• ${d} — <b>${esc(l.phone)}</b> (${esc(l.name || '—')}) — ${esc(l.issue || '—')}`);
      }
      await sendToChat(fromId, lines.join('\n'));
      return;
    }

    if (text === '/help' || text === '/start') {
      await sendToChat(fromId, [
        `🤖 <b>Команды ZakonExpert бота:</b>`,
        ``,
        `/stats — статистика по периодам`,
        `/leads — последние 5 заявок`,
        `/help — это сообщение`,
      ].join('\n'));
      return;
    }
  }

  if (cbq) {
    const fromId = String(cbq.message?.chat?.id || '');
    const data = cbq.data || '';
    await answerCallback(cbq.id, '');

    let since = 0;
    let period = 'Всё время';
    const now_ts = Date.now();
    if      (data === 'stats_today') { since = now_ts - 86400000;    period = 'Сегодня'; }
    else if (data === 'stats_week')  { since = now_ts - 7*86400000;  period = '7 дней';  }
    else if (data === 'stats_month') { since = now_ts - 30*86400000; period = '30 дней'; }

    if (data.startsWith('stats_')) {
      const [stats, leadsCount] = await Promise.all([
        clicksDb().getStats(since || undefined),
        leadsDb().getCount(since || undefined),
      ]);
      await sendToChat(fromId, fmtStats(stats, leadsCount, period), { reply_markup: STATS_KB });
    }
  }
}

function startPolling() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token || _pollActive) return;
  _pollActive = true;

  async function poll() {
    const updates = await getUpdates();
    for (const u of updates) {
      handleUpdate(u).catch(() => {});
    }
    _pollTimer = setTimeout(poll, 1500);
  }
  _pollTimer = setTimeout(poll, 3000);
}

function stopPolling() {
  _pollActive = false;
  if (_pollTimer) { clearTimeout(_pollTimer); _pollTimer = null; }
}

// ── detectChatId (setup util) ─────────────────────────────────────────────────
async function detectChatId() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return null;
  try {
    const res = await axios.get(
      `https://api.telegram.org/bot${token}/getUpdates?limit=10`,
      { timeout: 5000 }
    );
    const updates = res.data?.result || [];
    for (let i = updates.length - 1; i >= 0; i--) {
      const id = updates[i]?.message?.chat?.id || updates[i]?.callback_query?.message?.chat?.id;
      if (id) return String(id);
    }
    return null;
  } catch (_) { return null; }
}

module.exports = {
  send, notifyVisit, notifyIinCheck, notifyApplication,
  notifyLead, notifyClick, notifyChatMessage,
  startPolling, stopPolling, detectChatId,
};
