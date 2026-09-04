'use strict';

const express = require('express');
const path = require('path');
const fs = require('fs');
const { BANK_ARREST_HUB_PATH, BANK_ARREST_PATH_SET } = require('../../modules/bank-arrest-pages');
const { LEGAL_INTENT_PATH_SET } = require('../../modules/legal-intent-pages');
const { ROOT_DIR } = require('../paths');

function registerEngagementRoutes(app, dependencies) {
  const {
    commentsDb,
    clicksDb,
    leadsDb,
    chatDb,
    telegram,
    asyncHandler,
    sendNotFound,
    checkAdminKey,
    requireAdminPassword,
    leadLimiter,
    commentLimiter,
    logger,
  } = dependencies;

  // ===== APPLICATION FORM =====
  app.post('/api/application', leadLimiter, asyncHandler(async (req, res) => {
    const { name, phone, bank, description } = req.body;
    if (!name || !phone) {
      return res.status(400).json({ error: 'Имя и телефон обязательны' });
    }
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
    const ua = req.headers['user-agent'] || '';
    logger.info(`Новая заявка: ${name}, ${phone}, банк: ${bank || '—'}`);
    telegram.notifyApplication({ name, phone, bank, description }, ip, ua);
    res.json({ ok: true });
  }));

  // ===== CLICK TRACKING =====

  app.get('/api/document-download-counts', asyncHandler(async (req, res) => {
    const counts = clicksDb ? await clicksDb.getDocumentDownloadCounts() : {};
    res.set('Cache-Control', 'public, max-age=30, stale-while-revalidate=300');
    res.json({ counts });
  }));

  app.get('/download-document/:filename', asyncHandler(async (req, res) => {
    const filename = String(req.params.filename || '');
    if (!/^[a-z0-9_-]+\.(?:docx|pdf)$/i.test(filename)) return sendNotFound(res);
    const downloadsRoot = path.resolve(ROOT_DIR, 'public', 'downloads');
    const resolved = path.resolve(downloadsRoot, filename);
    if (!resolved.startsWith(`${downloadsRoot}${path.sep}`) || !fs.existsSync(resolved)) return sendNotFound(res);
    const documentId = filename.replace(/\.(?:docx|pdf)$/i, '');
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
    const ua = req.headers['user-agent'] || '';
    if (clicksDb && !/bot|crawler|spider|slurp|headless/i.test(ua)) {
      await clicksDb.recordClick({
        type: 'document_download',
        target: documentId,
        page: '/dokumenty',
        format: path.extname(filename).slice(1).toLowerCase(),
        ip,
        ua,
      });
    }
    res.set('Cache-Control', 'private, no-store');
    return res.download(resolved, filename);
  }));

  const TRACK_CLICK_TYPES = new Set(['phone', 'whatsapp']);
  const TRACK_CLICK_TARGETS = new Set(['main', 'advocate', 'mediator']);
  app.post('/api/track-click', asyncHandler(async (req, res) => {
    const { type, target, page } = req.body || {};
    if (!TRACK_CLICK_TYPES.has(type) || !TRACK_CLICK_TARGETS.has(target)) return res.json({ ok: false });
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
    const ua = req.headers['user-agent'] || '';
    if (clicksDb) clicksDb.recordClick({ type, target, page: page || '/', ip, ua }).catch(() => {});
    telegram.notifyClick(type, target, page || '/', ip, ua);
    res.json({ ok: true });
  }));

  // Lightweight product-analytics events (calculator_completed, copy_link, etc.) —
  // logged for later reporting, deliberately does NOT ping Telegram like
  // /api/track-click does, so it can be wired into high-frequency UI actions
  // without spamming the lead-notification channel.
  const ANALYTICS_EVENT_TYPES = new Set([
    'submit_iin', 'calculator_completed', 'bin_search_completed', 'open_case',
    'download_document', 'copy_link', 'external_campaign_visit',
    'click_cta_bailiff', 'click_cta_notary', 'send_document',
    'click_document_review', 'click_whatsapp_after_download',
    'view_company_page', 'view_company_cta', 'click_cta_company',
    'company_check_started', 'company_check_completed', 'company_check_pdf',
    'company_check_shared', 'click_cta_company_check',
    'view_bank_arrest_page', 'click_cta_bank_arrest',
    'view_legal_intent_page', 'click_cta_legal_intent',
    'arrest_diagnostic_started', 'arrest_diagnostic_step',
    'arrest_diagnostic_entry',
    'arrest_diagnostic_completed', 'arrest_diagnostic_copy',
    'arrest_diagnostic_whatsapp',
  ]);
  const COMPANY_FUNNEL_EVENT_TYPES = new Set([
    'view_company_page', 'view_company_cta', 'click_cta_company',
  ]);
  const COMPANY_CTA_POSITIONS = new Set([
    'sidebar', 'bottom', 'catalog-bottom', 'footer',
    'desktop-floating', 'mobile-sticky', 'unknown',
  ]);
  // Best-effort page_type classifier so LEAD-TRACKING-PLAN reports can group
  // events without re-deriving it from the raw path every time.
  function classifyPageType(page) {
    if (!page) return 'other';
    if (page === '/' ) return 'home';
    if (page === BANK_ARREST_HUB_PATH || BANK_ARREST_PATH_SET.has(page)) return 'bank_arrest';
    if (LEGAL_INTENT_PATH_SET.has(page)) return 'legal_intent';
    if (/^\/bailiff\//.test(page)) return 'bailiff_card';
    if (/^\/notary\//.test(page)) return 'notary_card';
    if (/^\/(?:(?:kk|en|zh|tr)\/)?company\//.test(page)) return 'company_card';
    if (/^\/(?:(?:kk|en|zh|tr)\/)?companies$/.test(page)) return 'company_catalog';
    if (/^\/(bailiffs|notaries|banks|mfo|lombards|collectors|insurance|gsi)$/.test(page)) return 'catalog';
    if (/^\/(arest-|snyatie-|zapret-|otmena-|vozrazhenie-|grafik-)/.test(page)) return 'money_page';
    if (page === '/dokumenty') return 'documents';
    if (page === '/calculator' || /^\/tools(?:\/|$)/.test(page)) return 'calculator';
    if (page === '/diagnostika-aresta') return 'arrest_diagnostic';
    if (page === '/bin-search') return 'bin_search';
    if (page === '/proverka-kontragenta') return 'company_check';
    if (page === '/proverka-bankrotstva') return 'bankruptcy_check';
    return 'other';
  }
  function normalizeAnalyticsPage(page) {
    const clean = String(page || '/').split(/[?#]/, 1)[0].slice(0, 300);
    if (!clean.startsWith('/')) return '/';
    return clean.replace(
      /^\/((?:kk|en|zh|tr)\/)?company\/(\d+)(?:-[^/]*)?\/?$/,
      '/$1company/$2'
    );
  }
  function classifyPageLocale(page) {
    return String(page || '').match(/^\/(kk|en|zh|tr)(?:\/|$)/)?.[1] || 'ru';
  }
  function classifyDevice(userAgent) {
    const ua = String(userAgent || '');
    if (/bot|crawler|spider|slurp|headless/i.test(ua)) return 'bot';
    if (/ipad|tablet|kindle|silk|android(?!.*mobile)/i.test(ua)) return 'tablet';
    if (/mobi|iphone|ipod|android/i.test(ua)) return 'mobile';
    return 'desktop';
  }
  app.post('/api/track-event', asyncHandler(async (req, res) => {
    const {
      type, target, page, utm, cta, offer_variant: offerVariant,
      source_entity_type: sourceEntityType,
      source_page: sourcePage,
      service_type: serviceType,
      document_type: documentType,
    } = req.body || {};
    if (!type || !ANALYTICS_EVENT_TYPES.has(type)) return res.json({ ok: false });
    const safePage = normalizeAnalyticsPage(page);
    const ua = req.headers['user-agent'] || '';
    const companyFunnelEvent = COMPANY_FUNNEL_EVENT_TYPES.has(type);
    const pageType = classifyPageType(safePage);
    if (companyFunnelEvent && !['company_card', 'company_catalog'].includes(pageType)) {
      return res.json({ ok: false });
    }
    if (clicksDb) {
      const event = {
        type,
        target: companyFunnelEvent ? 'company-directory' : (target || utm || '-'),
        page: safePage,
        page_type: pageType,
        cta_position: companyFunnelEvent
          ? (COMPANY_CTA_POSITIONS.has(cta) ? cta : '')
          : String(cta || '').slice(0, 50),
        offer_variant: offerVariant === 'b' ? 'b' : 'a',
        page_locale: classifyPageLocale(safePage),
        device_type: classifyDevice(ua),
        source_entity_type: ['bailiff', 'notary', 'company', 'bank', 'legal_intent'].includes(sourceEntityType) ? sourceEntityType : '',
        source_page: normalizeAnalyticsPage(sourcePage || safePage),
        service_type: ['arrest_diagnostic', 'document_review', 'legal_help'].includes(serviceType) ? serviceType : '',
        document_type: ['notary', 'court', 'bailiff', 'state', 'unknown'].includes(documentType) ? documentType : '',
        ...(companyFunnelEvent ? { funnel_version: 'v2' } : {
          ip: req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown',
          ua,
          utm: utm || '',
        }),
      };
      clicksDb.recordClick(event).catch(() => {});
    }
    res.json({ ok: true });
  }));

  // ===== LEAD FORM (chatbot / contact form) =====

  app.post('/api/lead', leadLimiter, asyncHandler(async (req, res) => {
    const { name, phone, issue, question, page, source, campaign, consent } = req.body || {};
    if (consent !== true) return res.status(400).json({ error: 'Необходимо согласие на обработку данных' });
    const safeName = String(name || '').trim().slice(0, 120);
    const safePhone = String(phone || '').trim().slice(0, 40);
    const phoneDigits = safePhone.replace(/\D/g, '');
    const safeIssue = String(issue || 'other').trim().slice(0, 160);
    const safeQuestion = String(question || '').trim().slice(0, 2000);
    const safePage = String(page || '/').trim().slice(0, 300);
    const safeSource = String(source || '').trim().slice(0, 120);
    const safeCampaign = String(campaign || '').trim().slice(0, 160);
    if (phoneDigits.length < 10 || phoneDigits.length > 15) {
      return res.status(400).json({ error: 'Укажите корректный номер телефона' });
    }
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
    const ua = req.headers['user-agent'] || '';
    const lead = {
      name: safeName,
      phone: safePhone,
      issue: safeIssue,
      question: safeQuestion,
      page: safePage,
      source: safeSource,
      campaign: safeCampaign,
    };
    if (leadsDb) {
      try {
        await leadsDb.recordLead({ ...lead, ip, ua });
      } catch (error) {
        logger.warn('Lead storage failed: ' + error.message);
      }
    }
    telegram.notifyLead(lead, ip, ua);
    res.json({ ok: true });
  }));

  const chatSendLimiter = new Map(); // sessionId -> [timestamps]
  function chatRateLimited(sessionId) {
    const now = Date.now();
    if (chatSendLimiter.size > 5000) {
      for (const [key, timestamps] of chatSendLimiter) {
        if (!timestamps.some(timestamp => now - timestamp < 60000)) chatSendLimiter.delete(key);
        if (chatSendLimiter.size <= 5000) break;
      }
    }
    const hits = (chatSendLimiter.get(sessionId) || []).filter(t => now - t < 60000);
    hits.push(now);
    chatSendLimiter.set(sessionId, hits);
    return hits.length > 20; // 20 messages/minute per session is plenty for a real conversation
  }

  app.post('/api/chat/send', asyncHandler(async (req, res) => {
    const sessionId = String(req.body?.sessionId || '').slice(0, 64);
    const text = String(req.body?.text || '').trim().slice(0, 1000);
    const page = String(req.body?.page || '').slice(0, 200);
    if (req.body?.consent !== true) return res.status(400).json({ error: 'Необходимо согласие на обработку сообщения' });
    if (!chatDb) return res.status(503).json({ error: 'Чат временно недоступен' });
    if (!sessionId || !text) return res.status(400).json({ error: 'Пустое сообщение' });
    if (chatRateLimited(sessionId)) return res.status(429).json({ error: 'Слишком много сообщений, подождите немного' });

    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
    const ua = req.headers['user-agent'] || '';
    const chatNumber = await chatDb.addClientMessage(sessionId, text, page);
    const sent = await telegram.notifyChatMessage(chatNumber, text, page, ip, ua);
    if (sent?.message_id) await chatDb.pushBotMsgId(sessionId, sent.message_id);
    res.json({ ok: true });
  }));

  app.get('/api/chat/poll', asyncHandler(async (req, res) => {
    const sessionId = String(req.query?.session || '').slice(0, 64);
    const since = Number.parseInt(req.query?.since, 10) || 0;
    if (!chatDb || !sessionId) return res.json({ messages: [], now: Date.now() });
    const messages = await chatDb.getMessagesSince(sessionId, since);
    res.json({ messages, now: Date.now() });
  }));

  // ===== TELEGRAM SETUP: определить CHAT_ID =====
  app.post('/api/telegram/setup', asyncHandler(async (req, res) => {
    if (!checkAdminKey(req, res)) return;
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) {
      return res.json({ ok: false, error: 'TELEGRAM_BOT_TOKEN не задан в .env' });
    }
    const chatId = await telegram.detectChatId();
    if (!chatId) {
      return res.json({
        ok: false,
        error: 'Сообщений не найдено. Напишите /start боту и обновите страницу.',
        token_hint: `Бот токен задан ✓`,
      });
    }
    // Авто-применяем в runtime (до перезапуска)
    process.env.TELEGRAM_CHAT_ID = chatId;
    await telegram.send(`✅ <b>ZakonExpert подключён!</b>\n\nChat ID: <code>${chatId}</code>\nТеперь уведомления будут приходить сюда.\n\n<i>Добавьте в .env:\nTELEGRAM_CHAT_ID=${chatId}</i>`);
    res.json({ ok: true, chat_id: chatId, note: `Добавьте TELEGRAM_CHAT_ID=${chatId} в .env для постоянной работы` });
  }));

  // ===== КОММЕНТАРИИ =====
  app.post('/comments', commentLimiter, express.urlencoded({ extended: true }), asyncHandler(async (req, res) => {
    if (!commentsDb) return res.redirect(req.headers.referer || '/');
    const { type, slug, name, rating, text, backUrl, privacyConsent } = req.body;
    if (!privacyConsent || !type || !slug || !text || text.trim().length < 3) {
      return res.redirect(backUrl || req.headers.referer || '/');
    }
    await commentsDb.add({
      type:   type.slice(0, 20),
      slug:   slug.slice(0, 120),
      name:   ((name || '').trim() || 'Аноним').slice(0, 50),
      rating: Math.min(5, Math.max(1, parseInt(rating) || 5)),
      text:   text.trim().slice(0, 600),
      ip:     req.ip,
    });
    res.redirect((backUrl || req.headers.referer || '/') + '?comment=sent');
  }));

  app.get('/admin/comments', requireAdminPassword, asyncHandler(async (req, res) => {
    const all = commentsDb ? await commentsDb.getAll() : [];
    res.render('admin/comments', { comments: all });
  }));

  app.post('/admin/comments/:id/approve', requireAdminPassword, express.urlencoded({ extended: true }), asyncHandler(async (req, res) => {
    if (commentsDb) await commentsDb.approve(req.params.id);
    res.redirect('/admin/comments');
  }));

  app.post('/admin/comments/:id/delete', requireAdminPassword, express.urlencoded({ extended: true }), asyncHandler(async (req, res) => {
    if (commentsDb) await commentsDb.remove(req.params.id);
    res.redirect('/admin/comments');
  }));

}

module.exports = { registerEngagementRoutes };
