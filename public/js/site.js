document.documentElement.classList.add('js-enabled');

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

  // Реестры dropdown — click-based on all screen sizes
  (function() {
    var toggle = document.querySelector('.nav-dropdown-toggle');
    var li = toggle && toggle.closest('.nav-has-dropdown');
    if (!toggle || !li) return;
    toggle.addEventListener('click', function(e) {
      e.preventDefault();
      li.classList.toggle('open');
    });
    document.addEventListener('click', function(e) {
      if (!li.contains(e.target)) li.classList.remove('open');
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
