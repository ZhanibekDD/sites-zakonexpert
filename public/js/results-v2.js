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

  const filterButtons = Array.from(document.querySelectorAll('[data-results-filter]'));
  const resultCards = Array.from(document.querySelectorAll('[data-result-category]'));

  filterButtons.forEach((button) => {
    button.addEventListener('click', () => {
      const filter = button.dataset.resultsFilter;
      filterButtons.forEach((item) => {
        const active = item === button;
        item.classList.toggle('is-active', active);
        item.setAttribute('aria-pressed', active ? 'true' : 'false');
      });
      resultCards.forEach((card) => {
        card.hidden = filter !== 'all' && card.dataset.resultCategory !== filter;
      });
    });
  });

  const lightbox = document.getElementById('rez-lb');
  const lightboxImage = document.getElementById('rez-lb-img');
  const lightboxCaption = document.getElementById('rez-lb-caption');
  const lightboxClose = lightbox?.querySelector('[data-lb-close]');
  const lightboxPrev = lightbox?.querySelector('[data-lb-prev]');
  const lightboxNext = lightbox?.querySelector('[data-lb-next]');
  const openers = Array.from(document.querySelectorAll('[data-result-open]'));
  let currentIndex = -1;
  let lastFocused = null;

  if (!lightbox || !lightboxImage || !openers.length) return;

  function renderLightbox(index) {
    currentIndex = (index + openers.length) % openers.length;
    const opener = openers[currentIndex];
    const nestedImage = opener.querySelector('img');
    lightboxImage.src = opener.dataset.lbSrc || nestedImage?.src || '';
    lightboxImage.alt = opener.dataset.lbAlt || nestedImage?.alt || '';
    if (lightboxCaption) {
      lightboxCaption.textContent = opener.dataset.lbCaption || lightboxImage.alt;
    }
  }

  function openLightbox(opener) {
    lastFocused = document.activeElement;
    renderLightbox(openers.indexOf(opener));
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

  openers.forEach((opener) => opener.addEventListener('click', () => openLightbox(opener)));
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
