'use strict';

const axios = require('axios');

// Visitor dedup cache: ip -> last notification timestamp
const visitCache = new Map();
const VISIT_COOLDOWN = 30 * 60 * 1000; // 30 min

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

const PAGE_LABELS = {
  '/':                                     '🏠 Главная',
  '/index.html':                           '🏠 Главная',
  '/services.html':                        '📋 Услуги',
  '/contact.html':                         '📞 Контакты',
  '/advocate':                             '⚖️ Адвокат Маулен',
  '/arest-kaspi':                          '🏦 Арест Kaspi',
  '/arest-kaspi.html':                     '🏦 Арест Kaspi',
  '/arest-halyk-bank':                     '🏦 Арест Halyk',
  '/arest-halyk-bank.html':               '🏦 Арест Halyk',
  '/arest-freedom-bank':                   '🏦 Арест Freedom',
  '/arest-freedom-bank.html':              '🏦 Арест Freedom',
  '/ispolnitelnaya-nadpis.html':           '📄 Исп. надпись',
  '/otmena-ispolnitelnoi-nadpisi':         '📄 Исп. надпись',
  '/snyatie-zapreta-na-avto.html':         '🚗 Запрет авто',
  '/snyatie-zapreta-na-avto':              '🚗 Запрет авто',
  '/zapret-registracionnyh-deystviy':      '🚗 Запрет рег. действий',
  '/zapret-registracionnyh-deystviy.html': '🚗 Запрет рег. действий',
  '/grafik-platezhey.html':                '📅 График платежей',
  '/grafik-oplaty-zadolzhennosti':         '📅 График платежей',
  '/grafik-platezhey':                     '📅 График платежей',
  '/chsi-arest-schetov.html':              '⚖️ ЧСИ аресты',
  '/chsi-arest-schetov':                   '⚖️ ЧСИ аресты',
  '/ubtar-procenty-i-rashody-chsi':        '💰 Расходы ЧСИ',
  '/ubrat-procenty-i-rashody-chsi':        '💰 Расходы ЧСИ',
  '/zakony.html':                          '📚 Законы',
  '/zakony':                               '📚 Законы',
  '/statyi':                               '📚 Статьи законов',
  '/news':                                 '📰 Новости',
  '/besspornost-dolga.html':               '📋 Бесспорность долга',
  '/besspornost-dolga':                    '📋 Бесспорность долга',
  '/spornost-dolga':                       '📋 Спорность долга',
  '/otmena-resheniya-suda.html':           '🏛 Отмена решения суда',
  '/snyatie-aresta-so-scheta':             '💳 Снятие ареста',
  '/snyatie-aresta-so-scheta.html':        '💳 Снятие ареста',
  '/alimenty-i-aresty':                    '👶 Алименты и арест',
  '/alimenty-i-aresty.html':              '👶 Алименты и арест',
  '/shtrafy-i-aresty':                     '🚔 Штрафы и арест',
  '/shtrafy-i-aresty.html':               '🚔 Штрафы и арест',
  '/snyatie-ogranicheniya-na-imushchestvo':'🏠 Арест имущества',
  '/snyatie-ogranichenii-u-notariusa':     '📝 Ограничения нотариуса',
  '/ispolnitelnaya-nadpis':                '📄 Исп. надпись',
  '/notaries':                             '📒 Каталог нотариусов',
  '/notary-search':                        '🔍 Поиск нотариуса',
  '/bailiffs':                             '📒 Каталог ЧСИ',
  '/bailiff-search':                       '🔍 Поиск ЧСИ',
  '/lawyers':                              '📒 Каталог адвокатов',
  '/lawyer-search':                        '🔍 Поиск адвоката',
  '/privacy.html':                         '🔒 Политика конф.',
  '/privacy':                              '🔒 Политика конф.',
  '/chsi-refinansirovanie':                '💼 ЧСИ Рефинансирование',
};

function pageLabel(url) {
  return PAGE_LABELS[url] || url;
}

async function send(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return;
  try {
    await axios.post(
      `https://api.telegram.org/bot${token}/sendMessage`,
      { chat_id: chatId, text, parse_mode: 'HTML' },
      { timeout: 6000 }
    );
  } catch (_) {
    // fire-and-forget, never block the main flow
  }
}

function refSource(referer) {
  if (!referer) return '';
  try {
    const host = new URL(referer).hostname.toLowerCase();
    if (/google/i.test(host)) return '🔍 Google';
    if (/yandex/i.test(host)) return '🔍 Яндекс';
    if (/2gis|dgis/i.test(host)) return '🗺 2GIS';
    if (/facebook|fb\.com/i.test(host)) return '📘 Facebook';
    if (/instagram/i.test(host)) return '📸 Instagram';
    if (/t\.me|telegram/i.test(host)) return '✈️ Telegram';
    if (/whatsapp/i.test(host)) return '💬 WhatsApp';
    if (host.includes('zakonexpertt.kz')) return '';
    return `🔗 ${host}`;
  } catch (_) { return ''; }
}

function notifyVisit(page, ip, ua, referer) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return;

  const realIp = String(ip || '').split(',')[0].trim();

  // Throttle: one notification per IP+page per 30 min
  const key = `${realIp}:${page}`;
  const lastSeen = visitCache.get(key);
  if (lastSeen && Date.now() - lastSeen < VISIT_COOLDOWN) return;
  visitCache.set(key, Date.now());

  const src = refSource(referer);
  const lines = [
    `👁 <b>Новый посетитель</b>`,
    ``,
    `📄 Страница: <b>${esc(pageLabel(page))}</b>`,
    src ? `📡 Источник: <b>${src}</b>` : null,
    `⏰ Время: ${now()}`,
    `🌐 IP: <code>${esc(realIp)}</code>`,
    `📱 ${esc(device(ua))}`,
  ].filter(v => v !== null);
  send(lines.join('\n')).catch(() => {});
}

function notifyIinCheck(ip, ua, isDebtor, count, iin) {
  const maskedIin = iin ? String(iin).replace(/\D/g, '').substring(0, 6) + '******' : '—';
  const lines = [
    isDebtor
      ? `🚨 <b>Найдены аресты!</b>`
      : `🔍 <b>Проверка по ИИН</b>`,
    ``,
    `🪪 ИИН: <code>${maskedIin}</code>`,
    isDebtor
      ? `📊 Производств: <b>${count}</b> — потенциальный клиент!`
      : `📊 Производств не найдено`,
    `⏰ ${now()}`,
    `🌐 IP: <code>${esc(String(ip || '').split(',')[0].trim())}</code>`,
    `📱 ${esc(device(ua))}`,
  ];
  send(lines.join('\n')).catch(() => {});
}

function notifyApplication(data, ip, ua) {
  const lines = [
    `📩 <b>НОВАЯ ЗАЯВКА С САЙТА!</b>`,
    ``,
    `👤 Имя: <b>${esc(data.name)}</b>`,
    `📞 Телефон: <b>${esc(data.phone)}</b>`,
    `🏦 Банк / тип: ${esc(data.bank)}`,
    data.description ? `📝 ${esc(data.description)}` : null,
    ``,
    `⏰ Время: ${now()}`,
    `🌐 IP: <code>${esc(String(ip || '').split(',')[0].trim())}</code>`,
    `📱 ${esc(device(ua))}`,
  ].filter(v => v !== null);
  send(lines.join('\n')).catch(() => {});
}

// Returns the chat_id of the last person who wrote to the bot (for setup)
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
      const chatId =
        updates[i]?.message?.chat?.id ||
        updates[i]?.callback_query?.message?.chat?.id;
      if (chatId) return String(chatId);
    }
    return null;
  } catch (_) {
    return null;
  }
}

module.exports = { send, notifyVisit, notifyIinCheck, notifyApplication, detectChatId };
