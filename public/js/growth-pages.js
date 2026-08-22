/* ZakonExpert growth pages: privacy-aware funnel events. */
(function () {
  'use strict';

  function root() {
    return document.querySelector('[data-growth-root]');
  }

  function track(type, target, extra) {
    if (typeof window.ZE_trackEvent !== 'function') return;
    window.ZE_trackEvent(type, target || '-', Object.assign({
      page_type: root() ? root().getAttribute('data-growth-page-type') : 'growth_page',
      source_page: location.pathname,
    }, extra || {}));
  }

  document.addEventListener('DOMContentLoaded', function () {
    var page = root();
    if (!page) return;
    var pageType = page.getAttribute('data-growth-page-type') || 'growth_page';
    var eventType = pageType === 'legal_intent' ? 'view_legal_intent_page' : 'view_bank_arrest_page';
    track(eventType, page.getAttribute('data-growth-page-key') || location.pathname);
  });

  document.addEventListener('click', function (event) {
    var link = event.target.closest('[data-growth-cta]');
    if (!link || !root()) return;
    var pageType = root().getAttribute('data-growth-page-type') || 'growth_page';
    var eventType = pageType === 'legal_intent' ? 'click_cta_legal_intent' : 'click_cta_bank_arrest';
    track(eventType, link.getAttribute('href') || '-', {
      cta_position: link.getAttribute('data-growth-cta') || 'unknown',
      service_type: pageType,
    });
  });
})();
