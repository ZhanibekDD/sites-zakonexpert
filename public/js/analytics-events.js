/* ZakonExpert — product analytics events (Stage 3).
   Separate from chatbot.js's phone/whatsapp click tracking (which pings
   Telegram per lead) — these are silent, logged-only UI events. */
(function () {
  'use strict';

  function send(type, target, extra) {
    var payload = JSON.stringify(Object.assign({
      type: type,
      target: target || '-',
      page: location.pathname,
    }, extra || {}));
    if (navigator.sendBeacon) {
      navigator.sendBeacon('/api/track-event', new Blob([payload], { type: 'application/json' }));
    } else {
      fetch('/api/track-event', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload, keepalive: true }).catch(function () {});
    }
  }

  window.ZE_trackEvent = send;

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
