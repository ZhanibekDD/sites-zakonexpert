'use strict';

// «Сейчас / После снятия» on bank pages: the visitor can switch the example screen,
// and the first time it scrolls into view it plays the switch once by itself.
(function initBankScreens() {
  document.querySelectorAll('.zb-figure').forEach((figure) => {
    const screen = figure.querySelector('[data-zb-screen]');
    const buttons = Array.from(figure.querySelectorAll('[data-zb-state]'));
    if (!screen || !buttons.length) return;
    let touched = false;

    function setState(state) {
      screen.classList.toggle('is-arrest', state === 'arrest');
      screen.classList.toggle('is-free', state === 'free');
      buttons.forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.zbState === state)));
    }

    buttons.forEach((button) => button.addEventListener('click', () => {
      touched = true;
      setState(button.dataset.zbState);
    }));

    const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduceMotion || !('IntersectionObserver' in window)) return;
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      observer.disconnect();
      setTimeout(() => { if (!touched) setState('free'); }, 1600);
    }, { threshold: 0.6 });
    observer.observe(screen);
  });
})();
