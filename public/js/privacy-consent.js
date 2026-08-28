/* ZakonExpert privacy choices: necessary storage by default, analytics by consent. */
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

  function applyChoice() {
    if (analyticsAllowed()) loadMetrika();
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
      text: 'Сайттың жұмысына қажетті сақтау қолданылады. Аналитика тек сіздің келісіміңізден кейін қосылады.',
      accept: 'Аналитикаға келісемін', necessary: 'Тек қажеттісі', policy: 'Саясатты оқу', settings: 'Құпиялылық',
    };
    return {
      title: 'Настройки конфиденциальности',
      text: 'Для работы сайта используется только необходимое хранение. Аналитика включается после вашего согласия.',
      accept: 'Разрешить аналитику', necessary: 'Только необходимое', policy: 'Политика', settings: 'Конфиденциальность',
    };
  }

  function showBanner(shouldFocus) {
    var existing = document.getElementById('ze-privacy-banner');
    if (existing) {
      if (shouldFocus) existing.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return existing;
    }
    var copy = bannerCopy();
    var banner = document.createElement('section');
    banner.id = 'ze-privacy-banner';
    banner.setAttribute('role', 'region');
    banner.setAttribute('aria-label', copy.title);
    banner.innerHTML = '<div class="ze-privacy-banner__copy"><strong>' + copy.title + '</strong><span>'
      + copy.text + ' <a href="/privacy">' + copy.policy + '</a></span></div>'
      + '<div class="ze-privacy-banner__actions"><button type="button" data-ze-choice="necessary">'
      + copy.necessary + '</button><button type="button" class="is-primary" data-ze-choice="all">'
      + copy.accept + '</button></div>';
    banner.querySelectorAll('[data-ze-choice]').forEach(function (button) {
      button.addEventListener('click', function () { saveChoice(button.getAttribute('data-ze-choice')); });
    });
    var header = document.querySelector('.site-header, body > header');
    if (header) header.insertAdjacentElement('afterend', banner);
    else document.body.insertBefore(banner, document.body.firstChild);
    if (shouldFocus) banner.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return banner;
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
    button.addEventListener('click', function () { showBanner(true); });
    footer.appendChild(button);
  }

  // Keep the dedicated client reviews page visible in every legacy header
  // that uses the shared ZakonExpert navigation markup.
  function addReviewsNavLink() {
    var nav = document.querySelector('[data-nav-links]');
    if (!nav || nav.querySelector('[data-nav-reviews]')) return;

    var item = document.createElement('li');
    item.setAttribute('data-nav-reviews', '');
    var link = document.createElement('a');
    link.className = 'nav-link ze-reviews-nav-link';
    link.href = '/reviews';
    link.textContent = 'Отзывы';
    if (window.location.pathname === '/reviews' || window.location.pathname === '/reviews.html') {
      link.classList.add('active');
    }
    item.appendChild(link);

    var resultItem = Array.prototype.find.call(nav.children, function (candidate) {
      var candidateLink = candidate.querySelector(':scope > .nav-link');
      return candidateLink && candidateLink.textContent.trim() === 'Результаты';
    });
    if (resultItem) resultItem.insertAdjacentElement('afterend', item);
    else {
      var contactItem = Array.prototype.find.call(nav.children, function (candidate) {
        var candidateLink = candidate.querySelector(':scope > .nav-link');
        return candidateLink && candidateLink.textContent.trim() === 'Контакты';
      });
      if (contactItem) nav.insertBefore(item, contactItem);
      else nav.appendChild(item);
    }
  }

  var style = document.createElement('style');
  style.textContent = '#ze-privacy-banner{position:relative;z-index:2;width:calc(100% - 36px);max-width:980px;margin:14px auto;padding:14px 18px;border:1px solid rgba(255,255,255,.18);border-radius:14px;background:#0d1f3c;color:#fff;box-shadow:0 10px 30px rgba(2,12,27,.18);display:flex;align-items:center;justify-content:space-between;gap:18px;font-family:Arial,sans-serif}'
    + '.ze-privacy-banner__copy{display:grid;gap:5px;line-height:1.45}.ze-privacy-banner__copy strong{font-size:1rem}.ze-privacy-banner__copy span{font-size:.84rem;color:rgba(255,255,255,.76)}.ze-privacy-banner__copy a{color:#f1c75b}'
    + '.ze-privacy-banner__actions{display:flex;gap:9px;flex-wrap:wrap;justify-content:flex-end}.ze-privacy-banner__actions button,.ze-privacy-settings{border:1px solid rgba(255,255,255,.28);border-radius:9px;background:transparent;color:inherit;padding:9px 13px;font-weight:700;cursor:pointer}.ze-privacy-banner__actions .is-primary{background:#d7a742;border-color:#d7a742;color:#102033}.ze-privacy-settings{padding:0;border:0;text-decoration:underline;font-size:inherit;color:inherit;opacity:.75}'
    + '.ze-reviews-nav-link{position:relative}.ze-reviews-nav-link::after{content:"";position:absolute;left:14px;right:14px;bottom:5px;height:2px;border-radius:999px;background:#d7a742;opacity:.9}'
    + '@media(max-width:720px){#ze-privacy-banner{width:calc(100% - 20px);align-items:stretch;flex-direction:column;margin:10px auto;padding:13px 14px;gap:11px}.ze-privacy-banner__copy strong{font-size:.92rem}.ze-privacy-banner__copy span{font-size:.78rem}.ze-privacy-banner__actions{justify-content:stretch;flex-wrap:nowrap}.ze-privacy-banner__actions button{flex:1;min-width:0;padding:8px 7px;font-size:.78rem}}';
  document.head.appendChild(style);

  window.ZEPrivacy = {
    analyticsAllowed: analyticsAllowed,
    choice: function () { return currentChoice; },
    open: showBanner,
    save: saveChoice,
  };

  document.addEventListener('DOMContentLoaded', function () {
    addReviewsNavLink();
    addSettingsButton();
    if (currentChoice) applyChoice();
    else showBanner();
  });
})();
