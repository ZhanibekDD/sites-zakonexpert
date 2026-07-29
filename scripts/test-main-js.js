'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'main.js'), 'utf8');
let onReady = null;

const document = {
  documentElement: { lang: 'ru' },
  head: { appendChild() {} },
  addEventListener(type, handler) {
    if (type === 'DOMContentLoaded') onReady = handler;
  },
  createElement() {
    return {};
  },
  getElementById() {
    return null;
  },
  querySelector() {
    return null;
  },
  querySelectorAll() {
    return [];
  },
};

const context = {
  document,
  window: {},
  bootstrap: {},
  IntersectionObserver: class {
    observe() {}
  },
  console,
  setTimeout,
  clearTimeout,
  setInterval,
  clearInterval,
  fetch,
  URLSearchParams,
};

vm.runInNewContext(source, context, { filename: 'public/js/main.js' });
if (typeof onReady !== 'function') {
  throw new Error('main.js did not register DOMContentLoaded');
}

onReady();
console.log('main.js safely initializes on pages without the IIN search form');
