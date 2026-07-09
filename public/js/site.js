document.documentElement.classList.add('js-enabled');

// ── Announcement bar — "Сначала снимаем, потом оплата" ──
(function() {
  var bar = document.createElement('div');
  bar.id = 'announce-bar';
  bar.innerHTML = '<div class="announce-inner">'
    + '<span class="announce-badge">✅ Гарантия</span>'
    + '<span class="announce-text">Сначала снимаем аресты&nbsp;— потом оплата. Официальный договор.</span>'
    + '<a href="https://wa.me/77752998738?text=%D0%A1%D0%BD%D0%B0%D1%87%D0%B0%D0%BB%D0%B0+%D1%81%D0%BD%D0%B8%D0%BC%D0%B8%D1%82%D0%B5+%D0%B0%D1%80%D0%B5%D1%81%D1%82%2C+%D0%BF%D0%BE%D1%82%D0%BE%D0%BC+%D0%BE%D0%BF%D0%BB%D0%B0%D1%82%D0%B0.+%D0%A5%D0%BE%D1%87%D1%83+%D1%83%D0%B7%D0%BD%D0%B0%D1%82%D1%8C+%D0%BF%D0%BE%D0%B4%D1%80%D0%BE%D0%B1%D0%BD%D0%B5%D0%B5." class="announce-cta" target="_blank" rel="noopener">Узнать условия →</a>'
    + '</div>';
  var style = document.createElement('style');
  style.textContent = '#announce-bar{background:linear-gradient(90deg,#052e16,#065f46,#052e16);color:#fff;padding:8px 0;text-align:center;font-size:0.82rem;line-height:1.4;}'
    + '.announce-inner{max-width:1100px;margin:0 auto;padding:0 16px;display:flex;align-items:center;justify-content:center;flex-wrap:wrap;gap:8px 16px;}'
    + '.announce-badge{background:#4ade80;color:#052e16;font-weight:800;font-size:0.75rem;padding:2px 10px;border-radius:100px;white-space:nowrap;}'
    + '.announce-text{color:rgba(255,255,255,0.92);}'
    + '.announce-cta{color:#4ade80;font-weight:700;text-decoration:none;white-space:nowrap;border-bottom:1px solid rgba(74,222,128,0.4);}'
    + '.announce-cta:hover{color:#86efac;}';
  document.head.appendChild(style);
  document.addEventListener('DOMContentLoaded', function() {
    document.body.insertBefore(bar, document.body.firstChild);
  });
})();

// ── Guarantee badge in every legal-hero and article-cta ──
(function() {
  var BADGE_HTML = '<div class="guarantee-pill">'
    + '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#15803d" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>'
    + '<span>Сначала снимаем — потом оплата</span>'
    + '</div>';
  var style = document.createElement('style');
  style.textContent = '.guarantee-pill{display:inline-flex;align-items:center;gap:6px;background:#f0fdf4;border:1.5px solid #86efac;border-radius:100px;padding:5px 14px;font-size:0.78rem;font-weight:700;color:#15803d;margin-top:12px;margin-bottom:4px;}'
    + '.legal-hero .guarantee-pill,.legal-hero-actions .guarantee-pill{display:block;margin-bottom:10px;}'
    + '.article-cta-guarantee{font-size:0.78rem;color:#15803d;font-weight:700;margin:8px 0 0;display:flex;align-items:center;gap:5px;}';
  document.head.appendChild(style);
  document.addEventListener('DOMContentLoaded', function() {
    // Inject into every legal-hero actions block
    var heroActions = document.querySelectorAll('.legal-hero-actions, .legal-actions');
    heroActions.forEach(function(el) {
      var pill = document.createElement('div');
      pill.innerHTML = BADGE_HTML;
      el.parentNode.insertBefore(pill.firstChild, el);
    });
    // Inject into every article-cta block
    var ctas = document.querySelectorAll('.article-cta');
    ctas.forEach(function(el) {
      var note = document.createElement('p');
      note.className = 'article-cta-guarantee';
      note.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#15803d" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg> Платите только после снятия ареста — официальный договор';
      el.appendChild(note);
    });

    // Add guarantee line to footer-bottom
    var footerBottom = document.querySelector('.footer-bottom');
    if (footerBottom) {
      var guarantee = document.createElement('span');
      guarantee.style.cssText = 'color:#4ade80;font-size:0.75rem;font-weight:700;';
      guarantee.textContent = '✅ Сначала снимаем — потом оплата';
      footerBottom.appendChild(guarantee);
    }

    // Add pulse badge to sticky WA button
    var stickyWa = document.querySelector('.sticky-wa');
    if (stickyWa) {
      var badge = document.createElement('span');
      badge.style.cssText = 'position:absolute;top:-8px;left:-8px;background:#4ade80;color:#052e16;font-size:0.6rem;font-weight:800;padding:2px 6px;border-radius:100px;white-space:nowrap;line-height:1.4;';
      badge.textContent = 'Без предоплаты';
      stickyWa.style.position = 'relative';
      stickyWa.appendChild(badge);
    }
  });
})();

// Анимация fade-in при скролле — работает на всех страницах
(function() {
  if (!('IntersectionObserver' in window)) {
    // Fallback: сразу показываем всё если браузер не поддерживает
    document.querySelectorAll('.fade-in-section').forEach(function(el) {
      el.classList.add('visible');
    });
    return;
  }
  var observer = new IntersectionObserver(function(entries) {
    entries.forEach(function(entry) {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
      }
    });
  }, { threshold: 0.08 });

  document.addEventListener('DOMContentLoaded', function() {
    document.querySelectorAll('.fade-in-section').forEach(function(el) {
      observer.observe(el);
    });
  });
})();

document.addEventListener('DOMContentLoaded', () => {
  const navToggle = document.querySelector('[data-nav-toggle]');
  const navLinks = document.querySelector('[data-nav-links]');

  if (navToggle && navLinks) {
    navToggle.addEventListener('click', () => {
      const isOpen = navLinks.classList.toggle('is-open');
      navToggle.setAttribute('aria-expanded', String(isOpen));
    });

    navLinks.querySelectorAll('a').forEach(link => {
      link.addEventListener('click', () => {
        // Don't close mobile menu when clicking the dropdown toggle
        if (link.classList.contains('nav-dropdown-toggle')) return;
        navLinks.classList.remove('is-open');
        navToggle.setAttribute('aria-expanded', 'false');
      });
    });
  }

  // Реестры dropdown — hover on desktop, click on mobile
  (function() {
    var dropdowns = document.querySelectorAll('.nav-has-dropdown');
    dropdowns.forEach(function(li) {
      var toggle = li.querySelector('.nav-dropdown-toggle');
      if (!toggle) return;
      // Mobile: click to toggle
      toggle.addEventListener('click', function(e) {
        var isMobile = window.innerWidth < 980;
        if (isMobile) {
          e.preventDefault();
          li.classList.toggle('is-open');
        }
      });
    });
    // Close on outside click
    document.addEventListener('click', function(e) {
      dropdowns.forEach(function(li) {
        if (!li.contains(e.target)) li.classList.remove('is-open');
      });
    });
  })();

  document.querySelectorAll('.current-year').forEach(node => {
    node.textContent = String(new Date().getFullYear());
  });

  const contactForm = document.getElementById('contact-form');
  if (contactForm) {
    const lang = document.documentElement.lang && document.documentElement.lang.startsWith('kk') ? 'kk' : 'ru';
    const resultNote = contactForm.querySelector('.contact-result-note');
    const whatsappNumber = '77752998738';

    contactForm.addEventListener('submit', (event) => {
      event.preventDefault();
      const formData = new FormData(contactForm);
      const name = (formData.get('name') || '').toString().trim();
      const phone = (formData.get('phone') || '').toString().trim();
      const topic = (formData.get('topic') || '').toString().trim();
      const message = (formData.get('message') || '').toString().trim();

      const lines = lang === 'kk'
        ? [
            'Сәлеметсіз бе! ZakonExpert сайты арқылы арест/шектеу мәселесі бойынша өтініш жіберіп отырмын.',
            name ? `Аты-жөні: ${name}` : '',
            phone ? `Телефон: ${phone}` : '',
            topic ? `Мәселе түрі: ${topic}` : '',
            message ? `Жағдайдың қысқаша сипаты: ${message}` : '',
          ]
        : [
            'Здравствуйте! Хочу разобрать ситуацию по аресту счетов/исполнительному производству.',
            name ? `Имя: ${name}` : '',
            phone ? `Телефон: ${phone}` : '',
            topic ? `Тип проблемы: ${topic}` : '',
            message ? `Кратко о ситуации: ${message}` : '',
          ];

      const text = lines.filter(Boolean).join('\n');
      const url = `https://wa.me/${whatsappNumber}?text=${encodeURIComponent(text)}`;
      window.open(url, '_blank', 'noopener');

      if (resultNote) {
        resultNote.textContent = lang === 'kk'
          ? 'Өтініш WhatsApp-қа дайындалды. Терезе ашылмаса — жоғарыдағы WhatsApp сілтемесін пайдаланыңыз.'
          : 'Сообщение подготовлено для WhatsApp. Если окно не открылось — воспользуйтесь ссылкой WhatsApp выше.';
      }
    });
  }
});
