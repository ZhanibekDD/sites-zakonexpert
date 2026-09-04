'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const source = fs.readFileSync(path.join(__dirname, '..', 'public/js/site.js'), 'utf8');

function element(tag = 'div') {
  const attributes = new Map();
  const classes = new Set();
  const node = {
    tag, children: [], dataset: {}, events: {}, className: '', innerHTML: '', hidden: false,
    classList: {
      add(value) { classes.add(value); }, remove(value) { classes.delete(value); },
      contains(value) { return classes.has(value); },
      toggle(value) { if (classes.has(value)) { classes.delete(value); return false; } classes.add(value); return true; },
    },
    setAttribute(key, value) { attributes.set(key, String(value)); },
    hasAttribute(key) { return attributes.has(key); },
    getAttribute(key) { return attributes.get(key) ?? null; },
    appendChild(child) { this.children.push(child); },
    prepend(child) { this.children.unshift(child); },
    insertAdjacentElement(_position, child) { this.children.push(child); },
    addEventListener(type, handler) { (this.events[type] ||= []).push(handler); },
    contains(child) { return this === child || this.children.some(item => item.contains?.(child)); },
    focus() {},
    querySelector(selector) {
      if (this.className === 'ze-wa-qr-dock') {
        if (!this.controls) this.controls = {};
        if (!this.controls[selector]) {
          this.controls[selector] = element('button');
          if (selector === '.ze-wa-qr-panel') this.controls[selector].hidden = true;
        }
        return this.controls[selector];
      }
      if (selector === '[data-nav-kgd]') return this.children.find(item => 'navKgd' in item.dataset) || null;
      if (selector === '.ze-legal-entity') return this.children.find(item => item.className === 'ze-legal-entity') || null;
      if (selector === ':scope > .nav-link') return this.children.find(item => item.className === 'nav-link') || null;
      return null;
    },
    querySelectorAll(selector) {
      if (selector === 'a') return this.children.flatMap(item => item.tag === 'a' ? [item] : item.querySelectorAll(selector));
      return [];
    },
  };
  return node;
}

function scenario({ readyState, suppressed, lang }) {
  const html = element('html');
  html.lang = lang;
  if (suppressed) html.setAttribute('data-suppress-zakonexpert-contacts', '');
  const header = element('header');
  const navToggle = element('button');
  const navLinks = element('ul');
  const footer = element('footer');
  const year = element('span');
  const body = element('body');
  const document = {
    readyState, documentElement: html, head: element('head'), body, events: {},
    createElement: element,
    createComment: text => ({ text }),
    getElementById: () => null,
    addEventListener(type, handler) { (this.events[type] ||= []).push(handler); },
    querySelector(selector) {
      if (selector === '[data-global-site-search]') return header.children.find(item => 'globalSiteSearch' in item.dataset) || null;
      if (selector === '.site-header') return header;
      if (selector === '[data-nav-toggle]') return navToggle;
      if (selector === '[data-nav-links]') return navLinks;
      if (selector === '.footer-bottom') return footer;
      if (selector === '.ze-wa-qr-dock') return body.children.find(item => item.className === 'ze-wa-qr-dock') || null;
      return null;
    },
    querySelectorAll: selector => selector === '.current-year' ? [year] : [],
  };
  const context = vm.createContext({
    document, console,
    window: { location: { pathname: '/companies', hostname: 'zakonexpertt.kz' }, innerWidth: 760, console },
  });
  vm.runInContext(source, context, { filename: 'public/js/site.js' });
  if (readyState === 'loading') {
    assert.equal(header.children.length, 0, 'controls must wait for DOM readiness');
    for (const handler of document.events.DOMContentLoaded || []) handler();
  }
  const search = document.querySelector('[data-global-site-search]');
  assert(search, 'shared search must initialize both before and after DOMContentLoaded');
  assert(search.innerHTML.includes('action="/poisk"'));
  assert(search.innerHTML.includes(lang === 'kk' ? 'Іздеу' : 'Найти'));
  assert.equal(year.textContent, String(new Date().getFullYear()));
  assert.equal(footer.children.length, 1);
  assert.equal(navLinks.children.length, 1, 'KGD entry must be inserted only once');
  assert.equal(navToggle.events.click.length, 1);
  navToggle.events.click[0]();
  assert.equal(navToggle.getAttribute('aria-expanded'), 'true');
  navToggle.events.click[0]();
  assert.equal(navToggle.getAttribute('aria-expanded'), 'false');
  const qr = document.querySelector('.ze-wa-qr-dock');
  assert.equal(Boolean(qr), !suppressed, 'organization pages must never acquire the site WhatsApp dock');
  if (qr) {
    const trigger = qr.querySelector('.ze-wa-qr-trigger');
    const panel = qr.querySelector('.ze-wa-qr-panel');
    trigger.events.click[0]();
    assert.equal(panel.hidden, false);
    for (const handler of document.events.keydown || []) handler({ key: 'Escape' });
    assert.equal(panel.hidden, true);
  }
  const listenerCount = Object.values(document.events).reduce((sum, handlers) => sum + handlers.length, 0);
  vm.runInContext(source, context, { filename: 'public/js/site.js' });
  assert.equal(Object.values(document.events).reduce((sum, handlers) => sum + handlers.length, 0), listenerCount);
  assert.equal(header.children.length, 1, 'duplicate script must not duplicate global search');
  assert.equal(navToggle.events.click.length, 1, 'duplicate script must not double-bind navigation');
}

for (const readyState of ['loading', 'complete']) {
  for (const suppressed of [true, false]) {
    for (const lang of ['ru', 'kk']) scenario({ readyState, suppressed, lang });
  }
}
console.log('Site shell OK: 8 readiness/language/privacy scenarios, no duplicate controls or listeners');
