'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { summarizeCompanyFunnel } = require('../modules/clicks-db');

const source = fs.readFileSync(
  path.join(__dirname, '..', 'public', 'js', 'company-conversion.js'),
  'utf8'
);

function element(attributes) {
  return {
    attributes: { ...attributes },
    textContent: attributes.text || '',
    getAttribute(name) { return this.attributes[name] || null; },
    setAttribute(name, value) { this.attributes[name] = value; },
  };
}

const title = element({ 'data-offer-a': 'Offer A', 'data-offer-b': 'Offer B', text: 'Offer A' });
const sidebar = element({ 'data-cta-position': 'sidebar' });
const duplicateSidebar = element({ 'data-cta-position': 'sidebar' });
const mobile = element({ 'data-cta-position': 'mobile-sticky' });
const events = [];
const storage = new Map();

const documentElement = element({
  'data-company-page-type': 'company_card',
  'data-company-locale': 'ru',
});
const document = {
  documentElement,
  querySelectorAll(selector) {
    if (selector === '[data-company-offer]') return [title];
    if (selector === '[data-company-whatsapp]') return [sidebar, duplicateSidebar, mobile];
    return [];
  },
};

class FakeIntersectionObserver {
  constructor(callback) { this.callback = callback; }
  observe(target) {
    this.callback([{ target, isIntersecting: true, intersectionRatio: .75 }]);
  }
  unobserve() {}
}

const context = {
  document,
  Math,
  Set,
  Uint32Array,
  sessionStorage: {
    getItem(key) { return storage.get(key) || null; },
    setItem(key, value) { storage.set(key, value); },
  },
  window: {
    crypto: { getRandomValues(values) { values[0] = 1; } },
    IntersectionObserver: FakeIntersectionObserver,
    ZE_trackEvent(type, target, extra) { events.push({ type, target, extra }); },
  },
};

vm.runInNewContext(source, context, { filename: 'public/js/company-conversion.js' });

assert.strictEqual(storage.get('ze_company_offer_v2'), 'b');
assert.strictEqual(documentElement.getAttribute('data-company-offer-variant'), 'b');
assert.strictEqual(title.textContent, 'Offer B');
assert.strictEqual(events.filter(event => event.type === 'view_company_page').length, 1);
assert.deepStrictEqual(
  events.filter(event => event.type === 'view_company_cta').map(event => event.extra.cta),
  ['sidebar', 'mobile-sticky'],
  'CTA impressions must be deduplicated by visible position'
);
assert(events.every(event => event.extra.offer_variant === 'b'));
assert(events.every(event => event.extra.page_type === 'company_card'));

const analyticsSource = fs.readFileSync(
  path.join(__dirname, '..', 'public', 'js', 'analytics-events.js'),
  'utf8'
);
const clickHandlers = [];
const analyticsPayloads = [];
const analyticsRoot = element({
  'data-company-offer-variant': 'b',
  'data-company-locale': 'en',
  'data-company-page-type': 'company_card',
});
const companyLink = element({ 'data-cta-position': 'sidebar' });
const analyticsContext = {
  Blob,
  document: {
    documentElement: analyticsRoot,
    addEventListener(type, handler) { if (type === 'click') clickHandlers.push(handler); },
  },
  fetch(url, options) {
    analyticsPayloads.push(JSON.parse(options.body));
    return Promise.resolve({ ok: true });
  },
  location: { pathname: '/en/company/7137221-alfa-pravo', search: '' },
  navigator: {},
  sessionStorage: { getItem() { return null; }, setItem() {} },
  URLSearchParams,
  window: {},
  setTimeout,
};
vm.runInNewContext(analyticsSource, analyticsContext, { filename: 'public/js/analytics-events.js' });
clickHandlers[0]({ target: { closest() { return companyLink; } } });
assert.strictEqual(analyticsPayloads.length, 1);
assert.strictEqual(analyticsPayloads[0].page, '/en/company/7137221');
assert(!JSON.stringify(analyticsPayloads[0]).includes('alfa-pravo'),
  'company names from URL slugs must not enter the conversion event');
assert.strictEqual(analyticsPayloads[0].offer_variant, 'b');

const funnel = summarizeCompanyFunnel([
  { type: 'view_company_page', funnel_version: 'v2', offer_variant: 'a', device_type: 'desktop', page_locale: 'ru', page_type: 'company_card', page: '/company/1' },
  { type: 'view_company_page', funnel_version: 'v2', offer_variant: 'a', device_type: 'mobile', page_locale: 'ru', page_type: 'company_card', page: '/company/2' },
  { type: 'view_company_page', funnel_version: 'v2', offer_variant: 'b', device_type: 'mobile', page_locale: 'kk', page_type: 'company_card', page: '/kk/company/1' },
  { type: 'view_company_page', funnel_version: 'v2', offer_variant: 'b', device_type: 'mobile', page_locale: 'ru', page_type: 'company_catalog', page: '/companies' },
  { type: 'view_company_cta', funnel_version: 'v2', offer_variant: 'a', device_type: 'desktop', page_locale: 'ru', page_type: 'company_card', page: '/company/1', cta_position: 'sidebar' },
  { type: 'view_company_cta', funnel_version: 'v2', offer_variant: 'a', device_type: 'mobile', page_locale: 'ru', page_type: 'company_card', page: '/company/2', cta_position: 'mobile-sticky' },
  { type: 'view_company_cta', funnel_version: 'v2', offer_variant: 'b', device_type: 'mobile', page_locale: 'kk', page_type: 'company_card', page: '/kk/company/1', cta_position: 'mobile-sticky' },
  { type: 'click_cta_company', funnel_version: 'v2', offer_variant: 'a', device_type: 'desktop', page_locale: 'ru', page_type: 'company_card', page: '/company/1', cta_position: 'sidebar' },
  { type: 'click_cta_company', funnel_version: 'v2', offer_variant: 'b', device_type: 'mobile', page_locale: 'kk', page_type: 'company_card', page: '/kk/company/1', cta_position: 'mobile-sticky' },
  { type: 'click_cta_company', offer_variant: 'a', device_type: 'desktop', page_locale: 'ru', page_type: 'company_card', cta_position: 'sidebar' },
  { type: 'calculator_completed' },
]);

assert.strictEqual(funnel.trackedCompanyEvents, 9);
assert.strictEqual(funnel.pageViews, 4);
assert.strictEqual(funnel.ctaImpressions, 3);
assert.strictEqual(funnel.whatsappClicks, 2);
assert.strictEqual(funnel.clicksPer1000Views, 500);
assert.strictEqual(funnel.ctaClickThroughRatePct, 66.67);
assert.strictEqual(funnel.byPosition.sidebar.ctaClickThroughRatePct, 100);
assert.strictEqual(funnel.byPosition['mobile-sticky'].ctaClickThroughRatePct, 50);
assert.strictEqual(funnel.byVariant.a.clicksPer1000Views, 500);
assert.strictEqual(funnel.byVariant.b.clicksPer1000Views, 500);
assert.strictEqual(funnel.byDevice.mobile.pageViews, 3);
assert.strictEqual(funnel.byLocale.kk.whatsappClicks, 1);
assert.strictEqual(funnel.byPageType.company_catalog.pageViews, 1);
assert.strictEqual(funnel.topPages[0].page, '/company/1');
assert.strictEqual(funnel.topPages[0].whatsappClicks, 1);
assert.strictEqual(funnel.topPages.length, 4);

const emptyFunnel = summarizeCompanyFunnel([]);
assert.strictEqual(emptyFunnel.clicksPer1000Views, null);
assert.strictEqual(emptyFunnel.ctaClickThroughRatePct, null);

console.log('Company conversion OK: A/B assignment, CTA impressions and funnel reporting');
