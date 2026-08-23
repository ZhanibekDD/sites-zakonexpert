/* ZakonExpert — product analytics events (Stage 3).
   Separate from chatbot.js's phone/whatsapp click tracking (which pings
   Telegram per lead) — these are silent, logged-only UI events. */
(function () {
  'use strict';

  // ── Yandex.Metrika goal bridge ─────────────────────────────────────────
  // Only non-personal params are ever allowed here — no ИИН, ФИО, phone,
  // email, message text or document contents. Never throws, never blocks
  // navigation (tel:/wa.me links must always work even if ym() fails).
  var YM_COUNTER_ID = 110748931;
  var YM_ALLOWED_PARAMS = [
    'page_path', 'page_type', 'cta_position', 'source_entity_type',
    'source_page', 'service_type', 'document_type', 'offer_variant',
    'page_locale', 'device_type',
    'utm_source', 'utm_medium', 'utm_campaign',
  ];
  function sendYandexGoal(goalName, params) {
    try {
      if (!window.ZEPrivacy || !window.ZEPrivacy.analyticsAllowed()) return;
      if (typeof window.ym !== 'function') return;
      var safeParams = {};
      if (params) {
        for (var i = 0; i < YM_ALLOWED_PARAMS.length; i++) {
          var key = YM_ALLOWED_PARAMS[i];
          if (params[key] != null) safeParams[key] = String(params[key]);
        }
      }
      window.ym(YM_COUNTER_ID, 'reachGoal', goalName, safeParams);
    } catch (err) { /* noop — never block the click that triggered this */ }
  }
  window.ZE_sendYandexGoal = sendYandexGoal;

  // Track-event types that also count as Metrika conversion goals — 1:1 by name.
  var YM_GOAL_EVENT_TYPES = new Set([
    'submit_iin', 'calculator_completed', 'bin_search_completed',
    'download_document', 'send_document', 'click_cta_bailiff',
    'click_cta_notary', 'click_document_review', 'click_whatsapp_after_download',
    'click_cta_company', 'company_check_completed', 'click_cta_company_check',
    'click_cta_bank_arrest', 'click_cta_legal_intent',
    'whatsapp_qr_opened', 'whatsapp_qr_clicked',
    'arrest_diagnostic_entry',
    'arrest_diagnostic_completed', 'arrest_diagnostic_whatsapp',
  ]);

  function analyticsPagePath(type) {
    var path = location.pathname;
    if (!/^(?:view_company_page|view_company_cta|click_cta_company)$/.test(type)) return path;
    return path.replace(
      /^\/((?:kk|en|zh|tr)\/)?company\/(\d+)(?:-[^/]*)?\/?$/,
      '/$1company/$2'
    );
  }

  function send(type, target, extra) {
    if (!window.ZEPrivacy || !window.ZEPrivacy.analyticsAllowed()) return;
    var pagePath = analyticsPagePath(type);
    var payload = JSON.stringify(Object.assign({
      type: type,
      target: target || '-',
      page: pagePath,
    }, extra || {}));
    if (navigator.sendBeacon) {
      navigator.sendBeacon('/api/track-event', new Blob([payload], { type: 'application/json' }));
    } else {
      fetch('/api/track-event', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload, keepalive: true }).catch(function () {});
    }
    if (YM_GOAL_EVENT_TYPES.has(type)) {
      var goalParams = Object.assign({ page_path: pagePath }, extra || {});
      if (extra && extra.cta) goalParams.cta_position = extra.cta;
      sendYandexGoal(type, goalParams);
    }
  }

  window.ZE_trackEvent = send;

  // Shared registry/product CTAs. Attribute values are fixed enums in the
  // templates; names, phone numbers and other card data are never copied.
  document.addEventListener('click', function (e) {
    var link = e.target.closest('[data-product-event]');
    if (!link) return;
    send(link.getAttribute('data-product-event') || '', link.getAttribute('data-event-target') || 'product-cta', {
      cta: link.getAttribute('data-event-cta') || 'unknown',
      source_entity_type: link.getAttribute('data-source-entity-type') || '',
      source_page: location.pathname,
      service_type: link.getAttribute('data-service-type') || '',
      document_type: link.getAttribute('data-document-type') || '',
    });
  });

  // Company-directory CTA clicks are a separate conversion channel. The
  // current page path identifies the card; no company name, BIN or WhatsApp
  // message is copied into analytics.
  document.addEventListener('click', function (e) {
    var link = e.target.closest('[data-company-whatsapp]');
    if (!link) return;
    send('click_cta_company', 'company-directory', {
      cta: link.getAttribute('data-cta-position') || 'unknown',
      offer_variant: document.documentElement.getAttribute('data-company-offer-variant') || 'a',
      page_locale: document.documentElement.getAttribute('data-company-locale') || 'ru',
      page_type: document.documentElement.getAttribute('data-company-page-type') || 'company_catalog',
      source_entity_type: 'company',
    });
  });

  // ── copy_link: any element with [data-copy-link="<url>"] ──────────────────
  document.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-copy-link]');
    if (!btn) return;
    var url = btn.getAttribute('data-copy-link') || location.href;
    var trackPage = btn.getAttribute('data-track-page') || location.pathname;
    var restore = btn.innerHTML;
    var doneCopy = function () {
      send('copy_link', url, { page: trackPage });
      btn.innerHTML = '<i class="bi bi-check2"></i> Ссылка скопирована';
      setTimeout(function () { btn.innerHTML = restore; }, 1800);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(doneCopy).catch(doneCopy);
    } else {
      var tmp = document.createElement('input');
      tmp.value = url;
      document.body.appendChild(tmp);
      tmp.select();
      try { document.execCommand('copy'); } catch (err) { /* noop */ }
      document.body.removeChild(tmp);
      doneCopy();
    }
  });

  // ── download_document: any <a download> or link into /downloads/ ─────────
  document.addEventListener('click', function (e) {
    var link = e.target.closest('a[download], a[href*="/downloads/"]');
    if (!link) return;
    send('download_document', link.getAttribute('href') || link.href);
    try { sessionStorage.setItem('ze_downloaded_doc', location.pathname); } catch (err) { /* noop */ }
  });

  // ── click_whatsapp_after_download: any wa.me click once a document was downloaded this session ──
  document.addEventListener('click', function (e) {
    var link = e.target.closest('a[href*="wa.me"]');
    if (!link) return;
    var downloadedOn = null;
    try { downloadedOn = sessionStorage.getItem('ze_downloaded_doc'); } catch (err) { /* noop */ }
    if (downloadedOn) send('click_whatsapp_after_download', link.getAttribute('href') || link.href, { source_page: downloadedOn });
  });

  // ── official WhatsApp Business QR/link conversion ───────────────────────
  document.addEventListener('click', function (e) {
    var link = e.target.closest('[data-whatsapp-qr-link]');
    if (!link) return;
    send('whatsapp_qr_clicked', 'official-business-link', {
      cta: link.closest('.ze-wa-qr-panel') ? 'desktop_qr' : 'contact_qr',
    });
  });

  // ── external_campaign_visit: utm_source present on page load ─────────────
  var params = new URLSearchParams(location.search);
  var utmSource = params.get('utm_source');
  if (utmSource) {
    var utm = {
      utm_source: utmSource,
      utm_medium: params.get('utm_medium') || '',
      utm_campaign: params.get('utm_campaign') || '',
      utm_content: params.get('utm_content') || '',
      utm_term: params.get('utm_term') || '',
    };
    try { sessionStorage.setItem('ze_utm', JSON.stringify(utm)); } catch (err) { /* noop */ }
    send('external_campaign_visit', utmSource, { utm: JSON.stringify(utm) });
  }
})();
