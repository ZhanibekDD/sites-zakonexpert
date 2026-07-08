document.documentElement.classList.add('js-enabled');

// ── Announcement bar — "Сначала снимаем, потом оплата" ──
(function() {
  var bar = document.createElement('div');
  bar.id = 'announce-bar';
  bar.innerHTML = '<div class="announce-inner">'
    + '<span class="announce-badge">✅ Гарантия</span>'
    + '<span class="announce-text">Сначала снимаем аресты&nbsp;— потом оплата. Официальный договор.</span>'
    + '<a href="https://wa.me/77000300024?text=%D0%A1%D0%BD%D0%B0%D1%87%D0%B0%D0%BB%D0%B0+%D1%81%D0%BD%D0%B8%D0%BC%D0%B8%D1%82%D0%B5+%D0%B0%D1%80%D0%B5%D1%81%D1%82%2C+%D0%BF%D0%BE%D1%82%D0%BE%D0%BC+%D0%BE%D0%BF%D0%BB%D0%B0%D1%82%D0%B0.+%D0%A5%D0%BE%D1%87%D1%83+%D1%83%D0%B7%D0%BD%D0%B0%D1%82%D1%8C+%D0%BF%D0%BE%D0%B4%D1%80%D0%BE%D0%B1%D0%BD%D0%B5%D0%B5." class="announce-cta" target="_blank" rel="noopener">Узнать условия →</a>'
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
    const whatsappNumber = '77000300024';

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
