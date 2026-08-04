/* ZakonExpert privacy choices: necessary storage by default, analytics/ads by consent. */
(function () {
  'use strict';

  if (window.ZEPrivacy) return;

  var STORAGE_KEY = 'ze_privacy_consent_v1';
  var currentChoice = readChoice();

  function readChoice() {
    try {
      var value = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      return value && (value.choice === 'all' || value.choice === 'necessary') ? value.choice : null;
    } catch (_) {
      return null;
    }
  }

  function analyticsAllowed() {
    return currentChoice === 'all';
  }

  function loadScriptOnce(src, attributes) {
    var alreadyLoaded = Array.prototype.some.call(
      document.querySelectorAll('script[data-ze-loaded]'),
      function (script) { return script.getAttribute('data-ze-loaded') === src; },
    );
    if (!src || alreadyLoaded) return;
    var script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.setAttribute('data-ze-loaded', src);
    Object.keys(attributes || {}).forEach(function (name) {
      if (attributes[name] != null) script.setAttribute(name, attributes[name]);
    });
    document.head.appendChild(script);
  }

  function loadMetrika() {
    if (!analyticsAllowed() || window.__zeMetrikaLoaded) return;
    window.__zeMetrikaLoaded = true;
    window.ym = window.ym || function () { (window.ym.a = window.ym.a || []).push(arguments); };
    window.ym.l = Number(new Date());
    loadScriptOnce('https://mc.yandex.ru/metrika/tag.js?id=110748931');
    window.ym(110748931, 'init', {
      ssr: true,
      webvisor: true,
      clickmap: true,
      ecommerce: 'dataLayer',
      referrer: document.referrer,
      url: location.href,
      accurateTrackBounce: true,
      trackLinks: true,
    });
  }

  function activateDeferredScripts() {
    if (!analyticsAllowed()) return;
    document.querySelectorAll('script[type="text/plain"][data-ze-consent="ads"][data-src]').forEach(function (placeholder) {
      if (placeholder.dataset.activated === 'true') return;
      placeholder.dataset.activated = 'true';
      var attrs = {};
      Array.prototype.forEach.call(placeholder.attributes, function (attr) {
        if (!['type', 'data-src', 'data-ze-consent', 'data-activated'].includes(attr.name)) attrs[attr.name] = attr.value;
      });
      loadScriptOnce(placeholder.getAttribute('data-src'), attrs);
    });
  }

  function applyChoice() {
    if (analyticsAllowed()) {
      loadMetrika();
      activateDeferredScripts();
    }
    window.dispatchEvent(new CustomEvent('ze:privacy-consent', { detail: { choice: currentChoice } }));
  }

  function disableOptionalProcessing() {
    try {
      if (typeof window.ym === 'function') window.ym(110748931, 'destruct');
    } catch (_) {}
    document.cookie.split(';').forEach(function (cookie) {
      var name = cookie.split('=')[0].trim();
      if (/^_ym|^yandexuid$|^_ga/i.test(name)) {
        document.cookie = name + '=; Max-Age=0; path=/; SameSite=Lax';
      }
    });
  }

  function saveChoice(choice) {
    currentChoice = choice === 'all' ? 'all' : 'necessary';
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ choice: currentChoice, savedAt: new Date().toISOString() }));
    } catch (_) {}
    document.getElementById('ze-privacy-banner')?.remove();
    if (currentChoice === 'necessary') disableOptionalProcessing();
    applyChoice();
  }

  function bannerCopy() {
    var lang = String(document.documentElement.lang || 'ru').toLowerCase();
    if (lang.startsWith('kk')) return {
      title: 'Құпиялылық баптаулары',
      text: 'Сайттың жұмысына қажетті сақтау қолданылады. Аналитика мен жарнама тек сіздің келісіміңізден кейін қосылады.',
      accept: 'Барлығына келісемін', necessary: 'Тек қажеттісі', policy: 'Саясатты оқу', settings: 'Құпиялылық',
    };
    return {
      title: 'Настройки конфиденциальности',
      text: 'Для работы сайта используется только необходимое хранение. Аналитика и реклама включаются после вашего согласия.',
      accept: 'Разрешить аналитику и рекламу', necessary: 'Только необходимое', policy: 'Политика', settings: 'Конфиденциальность',
    };
  }

  function showBanner() {
    if (document.getElementById('ze-privacy-banner')) return;
    var copy = bannerCopy();
    var banner = document.createElement('section');
    banner.id = 'ze-privacy-banner';
    banner.setAttribute('role', 'dialog');
    banner.setAttribute('aria-label', copy.title);
    banner.innerHTML = '<div class="ze-privacy-banner__copy"><strong>' + copy.title + '</strong><span>'
      + copy.text + ' <a href="/privacy">' + copy.policy + '</a></span></div>'
      + '<div class="ze-privacy-banner__actions"><button type="button" data-ze-choice="necessary">'
      + copy.necessary + '</button><button type="button" class="is-primary" data-ze-choice="all">'
      + copy.accept + '</button></div>';
    banner.querySelectorAll('[data-ze-choice]').forEach(function (button) {
      button.addEventListener('click', function () { saveChoice(button.getAttribute('data-ze-choice')); });
    });
    document.body.appendChild(banner);
  }

  function addSettingsButton() {
    var footer = document.querySelector('.footer-bottom');
    if (!footer || footer.querySelector('[data-ze-privacy-settings]')) return;
    var copy = bannerCopy();
    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'ze-privacy-settings';
    button.setAttribute('data-ze-privacy-settings', '');
    button.textContent = copy.settings;
    button.addEventListener('click', showBanner);
    footer.appendChild(button);
  }

  var style = document.createElement('style');
  style.textContent = '#ze-privacy-banner{position:fixed;z-index:10050;left:18px;right:18px;bottom:18px;max-width:980px;margin:auto;padding:18px 20px;border:1px solid rgba(255,255,255,.18);border-radius:16px;background:#0d1f3c;color:#fff;box-shadow:0 18px 55px rgba(2,12,27,.38);display:flex;align-items:center;justify-content:space-between;gap:20px;font-family:Arial,sans-serif}'
    + '.ze-privacy-banner__copy{display:grid;gap:5px;line-height:1.45}.ze-privacy-banner__copy strong{font-size:1rem}.ze-privacy-banner__copy span{font-size:.84rem;color:rgba(255,255,255,.76)}.ze-privacy-banner__copy a{color:#f1c75b}'
    + '.ze-privacy-banner__actions{display:flex;gap:9px;flex-wrap:wrap;justify-content:flex-end}.ze-privacy-banner__actions button,.ze-privacy-settings{border:1px solid rgba(255,255,255,.28);border-radius:9px;background:transparent;color:inherit;padding:9px 13px;font-weight:700;cursor:pointer}.ze-privacy-banner__actions .is-primary{background:#d7a742;border-color:#d7a742;color:#102033}.ze-privacy-settings{padding:0;border:0;text-decoration:underline;font-size:inherit;color:inherit;opacity:.75}'
    + '@media(max-width:720px){#ze-privacy-banner{align-items:stretch;flex-direction:column;left:10px;right:10px;bottom:10px;padding:16px}.ze-privacy-banner__actions{justify-content:stretch}.ze-privacy-banner__actions button{flex:1;min-width:130px}}';
  document.head.appendChild(style);

  window.ZEPrivacy = {
    analyticsAllowed: analyticsAllowed,
    choice: function () { return currentChoice; },
    open: showBanner,
    save: saveChoice,
  };

  document.addEventListener('DOMContentLoaded', function () {
    addSettingsButton();
    if (currentChoice) applyChoice();
    else showBanner();
  });
})();
