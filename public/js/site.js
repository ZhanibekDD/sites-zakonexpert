document.documentElement.classList.add('js-enabled');

// ZakonExpert provenance marker.
// This does not alter public facts or user content. It creates a deterministic,
// harmless origin fingerprint so copied/rebranded implementations can be traced.
(function installZakonExpertProvenance() {
  const namespace = 'ZE-PROVENANCE-V1';
  const canonicalOrigin = 'https://zakonexpert.kz';
  const policyUrl = canonicalOrigin + '/.well-known/ai-policy.txt';
  const originUrl = canonicalOrigin + '/.well-known/ze-origin.json';
  const pathname = window.location.pathname || '/';

  function fnv1a32(input) {
    let hash = 0x811c9dc5;
    for (let i = 0; i < input.length; i += 1) {
      hash ^= input.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash >>> 0;
  }

  const fingerprint = 'ZE1-' + fnv1a32(namespace + '|' + canonicalOrigin + '|' + pathname)
    .toString(16)
    .padStart(8, '0');

  document.documentElement.setAttribute('data-ze-origin', 'zakonexpert.kz');
  document.documentElement.setAttribute('data-ze-fingerprint', fingerprint);

  let originMeta = document.querySelector('meta[name="zakonexpert-origin"]');
  if (!originMeta) {
    originMeta = document.createElement('meta');
    originMeta.name = 'zakonexpert-origin';
    document.head && document.head.appendChild(originMeta);
  }
  originMeta.content = 'origin=zakonexpert.kz; namespace=' + namespace + '; fingerprint=' + fingerprint;

  let policyMeta = document.querySelector('meta[name="ai-use-policy"]');
  if (!policyMeta) {
    policyMeta = document.createElement('meta');
    policyMeta.name = 'ai-use-policy';
    document.head && document.head.appendChild(policyMeta);
  }
  policyMeta.content = policyUrl;

  if (document.head && !document.querySelector('link[rel="license"][data-ze-license]')) {
    const licenseLink = document.createElement('link');
    licenseLink.rel = 'license';
    licenseLink.href = canonicalOrigin + '/copyright-and-data-use';
    licenseLink.dataset.zeLicense = '1';
    document.head.appendChild(licenseLink);
  }

  if (document.head) {
    document.head.appendChild(document.createComment(
      ' ZakonExpert provenance: ' + fingerprint + ' | canonical=' + canonicalOrigin + pathname + ' | policy=' + policyUrl + ' '
    ));
  }

  window.__ZE_PROVENANCE__ = Object.freeze({
    namespace,
    canonicalOrigin,
    pathname,
    fingerprint,
    policyUrl,
    originUrl,
  });

  const host = (window.location.hostname || '').toLowerCase();
  const authorizedHost = !host
    || host === 'localhost'
    || host === '127.0.0.1'
    || host === '::1'
    || host === 'zakonexpert.kz'
    || host.endsWith('.zakonexpert.kz');

  if (!authorizedHost && window.console && typeof window.console.warn === 'function') {
    console.warn(
      '[ZakonExpert] Protected implementation detected outside the canonical ZakonExpert domain. '
      + 'Public availability is not a licence to clone or rebrand the implementation.',
      window.__ZE_PROVENANCE__
    );
  }
})();

// Floating round WhatsApp buttons were removed in favor of clear header and inline actions.
document.querySelectorAll('.sticky-wa, .company-desktop-cta').forEach(node => node.remove());

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
  const companyWhatsAppLink = 'https://wa.me/77003097566';
  const companyPhoneRaw = '77003097566';
  const companyPhoneDisplay = '+7 (700) 309-75-66';
  const navToggle = document.querySelector('[data-nav-toggle]');
  const navLinks = document.querySelector('[data-nav-links]');

  // Keep the KGD company check visible in legacy page headers as well.
  if (navLinks && !navLinks.querySelector('[data-nav-kgd]')) {
    const kgdItem = document.createElement('li');
    const kgdLink = document.createElement('a');
    kgdItem.dataset.navKgd = '';
    kgdLink.className = 'nav-link';
    kgdLink.href = '/proverka-kontragenta';
    kgdLink.textContent = 'КГД';
    kgdLink.title = 'Проверка организации по БИН';
    if (window.location.pathname === '/proverka-kontragenta') kgdLink.classList.add('active');
    kgdItem.appendChild(kgdLink);

    const registryItem = Array.from(navLinks.children).find(item => {
      const link = item.querySelector(':scope > .nav-link');
      return link && link.textContent.trim().startsWith('Реестры');
    });
    if (registryItem) registryItem.insertAdjacentElement('afterend', kgdItem);
    else navLinks.appendChild(kgdItem);
  }

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

  // Keep the legal entity visible on every page that uses the shared script.
  const footerBottom = document.querySelector('.footer-bottom');
  if (footerBottom && !footerBottom.querySelector('.ze-legal-entity')) {
    const legalEntity = document.createElement('span');
    legalEntity.className = 'ze-legal-entity';
    legalEntity.textContent = 'ТОО «ZakonExpert» · БИН 260740044168';
    footerBottom.appendChild(legalEntity);
  }

  // Desktop visitors can scan the official WhatsApp Business link without
  // copying a phone number. Mobile visitors keep the direct inline links.
  if (!document.querySelector('.ze-wa-qr-dock')) {
    const qrDock = document.createElement('aside');
    qrDock.className = 'ze-wa-qr-dock';
    qrDock.setAttribute('aria-label', 'WhatsApp ZakonExpert');
    qrDock.innerHTML = `
      <button class="ze-wa-qr-trigger" type="button" aria-expanded="false" aria-controls="ze-wa-qr-panel">
        <i class="bi bi-qr-code-scan" aria-hidden="true"></i>
        <span>WhatsApp QR</span>
      </button>
      <div class="ze-wa-qr-panel" id="ze-wa-qr-panel" hidden>
        <button class="ze-wa-qr-close" type="button" aria-label="Закрыть QR-код">&times;</button>
        <span class="ze-wa-qr-kicker">Напишите компании ZakonExpert</span>
        <strong>Отсканируйте камерой телефона</strong>
        <a class="ze-wa-qr-image-link" href="${companyWhatsAppLink}" target="_blank" rel="noopener" data-whatsapp-qr-link>
          <img src="/img/contact/whatsapp-zakonexpert-qr.svg" width="320" height="320" alt="QR-код WhatsApp компании ZakonExpert" loading="lazy">
        </a>
        <a class="ze-wa-qr-phone" href="tel:+${companyPhoneRaw}">${companyPhoneDisplay}</a>
        <a class="ze-wa-qr-button" href="${companyWhatsAppLink}" target="_blank" rel="noopener" data-whatsapp-qr-link>
          <i class="bi bi-whatsapp" aria-hidden="true"></i> Открыть WhatsApp
        </a>
      </div>`;
    document.body.appendChild(qrDock);

    const trigger = qrDock.querySelector('.ze-wa-qr-trigger');
    const panel = qrDock.querySelector('.ze-wa-qr-panel');
    const close = qrDock.querySelector('.ze-wa-qr-close');
    const setPanelOpen = (open) => {
      panel.hidden = !open;
      trigger.setAttribute('aria-expanded', String(open));
      if (open && typeof window.ZE_trackEvent === 'function') {
        window.ZE_trackEvent('whatsapp_qr_opened', 'desktop-dock', { cta: 'desktop_qr' });
      }
    };

    trigger.addEventListener('click', () => setPanelOpen(panel.hidden));
    close.addEventListener('click', () => setPanelOpen(false));
    document.addEventListener('click', (event) => {
      if (!panel.hidden && !qrDock.contains(event.target)) setPanelOpen(false);
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !panel.hidden) {
        setPanelOpen(false);
        trigger.focus();
      }
    });
  }

  const contactForm = document.getElementById('contact-form');
  if (contactForm) {
    const lang = document.documentElement.lang && document.documentElement.lang.startsWith('kk') ? 'kk' : 'ru';
    const resultNote = contactForm.querySelector('.contact-result-note');
    const whatsappNumber = companyPhoneRaw;

    contactForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!contactForm.checkValidity()) {
        contactForm.reportValidity();
        return;
      }
      const formData = new FormData(contactForm);
      const name = (formData.get('name') || '').toString().trim();
      const phone = (formData.get('phone') || '').toString().trim();
      const topic = (formData.get('topic') || '').toString().trim();
      const message = (formData.get('message') || '').toString().trim();
      const submitButton = contactForm.querySelector('button[type="submit"]');

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
      if (submitButton) submitButton.disabled = true;
      if (resultNote) resultNote.textContent = lang === 'kk' ? 'Өтініш жіберілуде…' : 'Отправляем заявку…';
      const attribution = window.ZE_getLeadAttribution ? window.ZE_getLeadAttribution() : {};

      try {
        const response = await fetch('/api/lead', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name,
            phone,
            issue: topic || 'other',
            question: message,
            page: location.pathname,
            source: attribution.source || '',
            campaign: attribution.campaign || '',
            consent: true,
          }),
        });
        if (!response.ok) throw new Error('lead rejected');
        contactForm.reset();
        if (resultNote) {
          resultNote.innerHTML = lang === 'kk'
            ? `Өтініш қабылданды. Маман сізбен хабарласады. <a href="${url}" target="_blank" rel="noopener">WhatsApp-та құжаттарды жіберу</a>.`
            : `Заявка принята. Специалист свяжется с вами. <a href="${url}" target="_blank" rel="noopener">Отправить документы в WhatsApp</a>.`;
        }
      } catch (_) {
        if (resultNote) {
          resultNote.innerHTML = lang === 'kk'
            ? `Өтінішті сақтау мүмкін болмады. <a href="${url}" target="_blank" rel="noopener">WhatsApp-қа тікелей жазыңыз</a>.`
            : `Не удалось сохранить заявку. <a href="${url}" target="_blank" rel="noopener">Напишите напрямую в WhatsApp</a>.`;
        }
      } finally {
        if (submitButton) submitButton.disabled = false;
      }
    });
  }
});
