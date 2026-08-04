/* ZakonExpert — privacy-safe company conversion funnel.
   The A/B choice is stored only as "a" or "b" for the browser session.
   No visitor ID, company data, WhatsApp text or form input is collected. */
(function () {
  'use strict';

  var root = document.documentElement;
  var pageType = root.getAttribute('data-company-page-type');
  if (!pageType) return;

  var locale = root.getAttribute('data-company-locale') || 'ru';
  var storageKey = 'ze_company_offer_v2';

  function randomVariant() {
    try {
      if (window.crypto && typeof window.crypto.getRandomValues === 'function') {
        var values = new Uint32Array(1);
        window.crypto.getRandomValues(values);
        return values[0] % 2 === 0 ? 'a' : 'b';
      }
    } catch (error) { /* fall through to Math.random */ }
    return Math.random() < .5 ? 'a' : 'b';
  }

  function resolveVariant() {
    var stored = null;
    try { stored = sessionStorage.getItem(storageKey); } catch (error) { /* storage may be disabled */ }
    if (stored === 'a' || stored === 'b') return stored;
    var selected = randomVariant();
    try { sessionStorage.setItem(storageKey, selected); } catch (error) { /* session-only fallback */ }
    return selected;
  }

  var variant = resolveVariant();
  root.setAttribute('data-company-offer-variant', variant);

  document.querySelectorAll('[data-company-offer]').forEach(function (element) {
    var copy = element.getAttribute('data-offer-' + variant);
    if (copy) element.textContent = copy;
  });

  function track(type, ctaPosition) {
    if (typeof window.ZE_trackEvent !== 'function') return;
    window.ZE_trackEvent(type, 'company-directory', {
      cta: ctaPosition || '',
      offer_variant: variant,
      page_locale: locale,
      page_type: pageType,
      source_entity_type: 'company',
    });
  }

  track('view_company_page');

  var seenPositions = new Set();
  function recordImpression(element) {
    var position = element.getAttribute('data-cta-position') || 'unknown';
    if (seenPositions.has(position)) return;
    seenPositions.add(position);
    track('view_company_cta', position);
  }

  var ctas = document.querySelectorAll('[data-company-whatsapp]');
  if (typeof window.IntersectionObserver !== 'function') {
    ctas.forEach(recordImpression);
    return;
  }

  var observer = new window.IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (!entry.isIntersecting || entry.intersectionRatio < .5) return;
      recordImpression(entry.target);
      observer.unobserve(entry.target);
    });
  }, { threshold: [.5] });

  ctas.forEach(function (cta) { observer.observe(cta); });
})();
