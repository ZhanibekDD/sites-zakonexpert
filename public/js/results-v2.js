'use strict';

(function initResultShowcases() {
  const viewers = document.querySelectorAll('[data-result-viewer]');

  viewers.forEach((viewer) => {
    const options = Array.from(viewer.querySelectorAll('[data-result-option]'));
    const image = viewer.querySelector('[data-result-image]');
    const amount = viewer.querySelector('[data-result-amount]');
    const counter = viewer.querySelector('[data-result-counter]');
    const label = viewer.querySelector('[data-result-label]');

    if (!options.length || !image) return;

    function select(option) {
      options.forEach((item) => {
        const active = item === option;
        item.classList.toggle('is-active', active);
        item.setAttribute('aria-selected', active ? 'true' : 'false');
        item.setAttribute('tabindex', active ? '0' : '-1');
      });

      image.src = option.dataset.src;
      image.alt = option.dataset.alt;
      if (amount) amount.textContent = option.dataset.amount;
      if (counter) counter.textContent = `${options.indexOf(option) + 1} из ${options.length}`;
      if (label) label.textContent = option.dataset.label || 'Исполнительная надпись отменена';

      const opener = viewer.querySelector('[data-result-open]');
      if (opener) {
        opener.dataset.lbSrc = option.dataset.src;
        opener.dataset.lbAlt = option.dataset.alt;
        opener.dataset.lbCaption = `${option.dataset.label || 'Исполнительная надпись отменена'} — ${option.dataset.amount}`;
      }
    }

    options.forEach((option, index) => {
      option.addEventListener('click', () => select(option));
      option.addEventListener('keydown', (event) => {
        if (!['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return;
        event.preventDefault();
        const direction = ['ArrowDown', 'ArrowRight'].includes(event.key) ? 1 : -1;
        const next = options[(index + direction + options.length) % options.length];
        next.focus();
        select(next);
      });
    });

    select(options.find((option) => option.classList.contains('is-active')) || options[0]);
  });

  const archive = Array.isArray(window.ZAKONEXPERT_RESULTS_ARCHIVE)
    ? window.ZAKONEXPERT_RESULTS_ARCHIVE
    : [];
  const featuredOptions = Array.from(document.querySelectorAll('[data-result-option]'));

  function amountToCents(label) {
    const normalized = String(label || '')
      .replace(/₸/g, '')
      .replace(/\s/g, '')
      .replace(',', '.');
    const amount = Number(normalized);
    return Number.isFinite(amount) ? Math.round(amount * 100) : 0;
  }

  function formatTenge(cents) {
    return `${new Intl.NumberFormat('ru-RU', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(cents / 100)} ₸`;
  }

  function renderAggregateTotals() {
    if (!archive.length) return;
    const cancelledArchive = archive.filter((item) => item.category === 'cancellation');
    const cancellationCount = featuredOptions.length + cancelledArchive.length;
    const cancellationCents = featuredOptions.reduce((total, option) => (
      total + amountToCents(option.dataset.amount)
    ), 0) + cancelledArchive.reduce((total, item) => (
      total + amountToCents(item.amountLabel)
    ), 0);
    const totalDocuments = featuredOptions.length + archive.length;

    document.querySelectorAll('[data-cancellation-count]').forEach((element) => {
      element.textContent = String(cancellationCount);
    });
    document.querySelectorAll('[data-cancellation-total-amount]').forEach((element) => {
      element.textContent = formatTenge(cancellationCents);
    });
    document.querySelectorAll('[data-results-total-documents]').forEach((element) => {
      element.textContent = String(totalDocuments);
    });

    const eyebrow = document.querySelector('[data-cancellation-summary-eyebrow]');
    if (eyebrow) {
      eyebrow.innerHTML = `<i class="bi bi-shield-check" aria-hidden="true"></i> Подтверждено ${cancellationCount} постановлениями об отмене`;
    }
  }

  renderAggregateTotals();
  const gallery = document.querySelector('[data-results-gallery]');
  const filterButtons = Array.from(document.querySelectorAll('[data-results-filter]'));
  const searchInput = document.querySelector('[data-results-search]');
  const resultCount = document.querySelector('[data-results-count]');
  const emptyState = document.querySelector('[data-results-empty]');
  const loadMore = document.querySelector('[data-results-load-more]');
  let activeFilter = 'all';
  let query = '';
  let visibleLimit = 12;

  function pageLabel(pages) {
    if (pages === 1) return '1 страница';
    if (pages > 1 && pages < 5) return `${pages} страницы`;
    return `${pages} страниц`;
  }

  function matchesQuery(item) {
    if (!query) return true;
    const normalizedQuery = query.toLocaleLowerCase('ru-RU').trim();
    const queryDigits = normalizedQuery.replace(/\D/g, '');
    const itemDigits = item.amountLabel.replace(/\D/g, '');
    if (queryDigits && itemDigits.includes(queryDigits)) return true;
    return `${item.amountLabel} ${item.badge} ${item.title}`.toLocaleLowerCase('ru-RU').includes(normalizedQuery);
  }

  function createArchiveCard(item, index) {
    const article = document.createElement('article');
    article.className = 'rez-v2-card rez-v2-card--archive';
    article.dataset.resultCategory = item.category;

    const opener = document.createElement('button');
    opener.className = 'rez-v2-card__media';
    opener.type = 'button';
    opener.dataset.resultOpen = '';
    opener.dataset.lbSrc = item.src;
    opener.dataset.lbAlt = `Читаемая первая страница документа на сумму ${item.amountLabel}`;
    opener.dataset.lbCaption = `${item.title} — ${item.amountLabel}. Персональные данные скрыты.`;

    const image = document.createElement('img');
    image.src = item.thumbSrc || item.src;
    image.width = 1080;
    image.height = 1516;
    image.loading = index < 4 ? 'eager' : 'lazy';
    image.decoding = 'async';
    image.alt = opener.dataset.lbAlt;

    const ordinal = document.createElement('span');
    ordinal.className = 'rez-v2-card__number';
    ordinal.textContent = `№ ${item.id}`;

    const zoom = document.createElement('span');
    zoom.className = 'rez-v2-card__zoom';
    zoom.innerHTML = '<i class="bi bi-arrows-fullscreen" aria-hidden="true"></i><span>Читать документ</span>';

    opener.append(image, ordinal, zoom);

    const body = document.createElement('div');
    body.className = 'rez-v2-card__body';

    const top = document.createElement('div');
    top.className = 'rez-v2-card__top';

    const badge = document.createElement('span');
    badge.className = `rez-v2-badge${item.category === 'enforcement' ? ' rez-v2-badge--blue' : item.category === 'other' ? ' rez-v2-badge--slate' : ''}`;
    badge.textContent = item.badge;

    const pages = document.createElement('span');
    pages.className = 'rez-v2-card__pages';
    pages.textContent = pageLabel(item.pages);
    top.append(badge, pages);

    const value = document.createElement('strong');
    value.className = 'rez-v2-card__amount';
    value.textContent = item.amountLabel;

    const title = document.createElement('h3');
    title.textContent = item.title;

    const note = document.createElement('p');
    note.innerHTML = '<i class="bi bi-shield-check" aria-hidden="true"></i> Документ читаемый, личные данные закрыты';

    body.append(top, value, title, note);
    article.append(opener, body);
    return article;
  }

  function getFilteredArchive() {
    return archive.filter((item) => {
      const categoryMatches = activeFilter === 'all' || item.category === activeFilter;
      return categoryMatches && matchesQuery(item);
    });
  }

  function renderArchive() {
    if (!gallery) return;
    const filtered = getFilteredArchive();
    const visible = filtered.slice(0, visibleLimit);
    gallery.replaceChildren(...visible.map(createArchiveCard));
    if (resultCount) resultCount.textContent = String(filtered.length);
    if (emptyState) emptyState.hidden = filtered.length !== 0;
    if (loadMore) {
      loadMore.hidden = visible.length >= filtered.length;
      const rest = filtered.length - visible.length;
      loadMore.innerHTML = `<i class="bi bi-plus-lg" aria-hidden="true"></i> Показать ещё${rest > 0 ? ` (${rest})` : ''}`;
    }
  }

  filterButtons.forEach((button) => {
    button.addEventListener('click', () => {
      activeFilter = button.dataset.resultsFilter || 'all';
      visibleLimit = 12;
      filterButtons.forEach((item) => {
        const active = item === button;
        item.classList.toggle('is-active', active);
        item.setAttribute('aria-pressed', active ? 'true' : 'false');
      });
      renderArchive();
    });
  });

  searchInput?.addEventListener('input', () => {
    query = searchInput.value;
    visibleLimit = 12;
    renderArchive();
  });

  loadMore?.addEventListener('click', () => {
    visibleLimit += 12;
    renderArchive();
  });

  renderArchive();

  const lightbox = document.getElementById('rez-lb');
  const lightboxImage = document.getElementById('rez-lb-img');
  const lightboxCaption = document.getElementById('rez-lb-caption');
  const lightboxOriginal = document.getElementById('rez-lb-original');
  const lightboxClose = lightbox?.querySelector('[data-lb-close]');
  const lightboxPrev = lightbox?.querySelector('[data-lb-prev]');
  const lightboxNext = lightbox?.querySelector('[data-lb-next]');
  let currentIndex = -1;
  let lastFocused = null;

  if (!lightbox || !lightboxImage) return;

  function currentOpeners() {
    return Array.from(document.querySelectorAll('[data-result-open]'));
  }

  function renderLightbox(index) {
    const openers = currentOpeners();
    if (!openers.length) return;
    currentIndex = (index + openers.length) % openers.length;
    const opener = openers[currentIndex];
    const nestedImage = opener.querySelector('img');
    lightboxImage.src = opener.dataset.lbSrc || nestedImage?.src || '';
    lightboxImage.alt = opener.dataset.lbAlt || nestedImage?.alt || '';
    if (lightboxCaption) lightboxCaption.textContent = opener.dataset.lbCaption || lightboxImage.alt;
    if (lightboxOriginal) lightboxOriginal.href = lightboxImage.src;
  }

  function openLightbox(opener) {
    lastFocused = document.activeElement;
    renderLightbox(currentOpeners().indexOf(opener));
    lightbox.classList.add('is-open');
    lightbox.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    lightboxClose?.focus();
  }

  function closeLightbox() {
    lightbox.classList.remove('is-open');
    lightbox.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
    if (lastFocused instanceof HTMLElement) lastFocused.focus();
  }

  document.addEventListener('click', (event) => {
    const opener = event.target.closest('[data-result-open]');
    if (opener) openLightbox(opener);
  });
  lightboxClose?.addEventListener('click', closeLightbox);
  lightboxPrev?.addEventListener('click', () => renderLightbox(currentIndex - 1));
  lightboxNext?.addEventListener('click', () => renderLightbox(currentIndex + 1));
  lightbox.addEventListener('click', (event) => {
    if (event.target === lightbox) closeLightbox();
  });
  document.addEventListener('keydown', (event) => {
    if (!lightbox.classList.contains('is-open')) return;
    if (event.key === 'Escape') closeLightbox();
    if (event.key === 'ArrowLeft') renderLightbox(currentIndex - 1);
    if (event.key === 'ArrowRight') renderLightbox(currentIndex + 1);
  });
})();
