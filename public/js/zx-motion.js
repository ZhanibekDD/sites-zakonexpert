'use strict';

// Motion layer for the whole site (2026-10-10). Pairs with /css/zx-motion.css.
// Off for reduced motion and for crawlers; never touches the IIN checker, its results,
// forms, the header, the footer or modals. Elements are hidden only when they are below
// the fold at start, and only by this script, so a failure leaves the page as it was.
(function zxMotion() {
  const root = document.documentElement;
  if (root.dataset.zxMotion) return;
  root.dataset.zxMotion = '1';

  const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const bot = /bot\b|bot\/|crawl|spider|slurp|lighthouse|pagespeed|headlesschrome/i.test(navigator.userAgent || '');
  if (reduce || bot || !('IntersectionObserver' in window)) return;

  const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  const SKIP = '.site-header, .landing-footer, footer, nav, form, table, dialog, .modal, #results, .zx-hero__results, .search-loading, .zp-hero, [data-zx-static], [aria-hidden="true"]';
  const vh = () => window.innerHeight || root.clientHeight;
  const raf = window.requestAnimationFrame.bind(window);

  // ---------- Header shadow and reading progress ----------
  const progress = document.createElement('div');
  progress.className = 'zx-progress';
  progress.setAttribute('aria-hidden', 'true');
  document.body.appendChild(progress);
  const cssProgress = window.CSS && CSS.supports && CSS.supports('animation-timeline: scroll()');
  let ticking = false;
  function onScroll() {
    if (ticking) return;
    ticking = true;
    raf(() => {
      ticking = false;
      const y = window.scrollY || root.scrollTop;
      root.classList.toggle('zx-scrolled', y > 8);
      if (!cssProgress) {
        const max = Math.max(1, root.scrollHeight - vh());
        progress.style.transform = `scaleX(${Math.min(1, y / max)})`;
      }
    });
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  // ---------- Page transitions: keep the header still while the page changes ----------
  const nameHeader = () => { const h = document.querySelector('.site-header'); if (h) h.style.viewTransitionName = 'zx-header'; };
  window.addEventListener('pageswap', (event) => { if (event.viewTransition) nameHeader(); });
  window.addEventListener('pagereveal', (event) => {
    if (!event.viewTransition) return;
    nameHeader();
    event.viewTransition.finished.finally(() => { const h = document.querySelector('.site-header'); if (h) h.style.viewTransitionName = ''; });
  });

  // ---------- Reveal on scroll ----------
  const scope = document.querySelector('main') || document.body;
  const marked = new Set();
  const hasInner = new Set();
  const plan = [];
  const isSkipped = (el) => !!el.closest(SKIP);
  const insideMarked = (el) => { for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) if (marked.has(p)) return true; return false; };

  function want(el, variant, delay) {
    if (!el || marked.has(el) || hasInner.has(el) || isSkipped(el) || insideMarked(el)) return;
    marked.add(el);
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) hasInner.add(p);
    plan.push({ el, variant, delay });
  }

  // Sequences first: their children come in one after another, so nothing else may claim them
  const limit = vh() * 0.92;
  const seqBoxes = Array.from(scope.querySelectorAll('.ze-home-process__grid, .ze-home-result__facts, .zr-faq'))
    .filter((box) => !isSkipped(box) && box.getBoundingClientRect().top >= limit);
  seqBoxes.forEach((box) => {
    marked.add(box);
    for (let p = box.parentElement; p && p !== document.body; p = p.parentElement) hasInner.add(p);
  });

  // Team photos are uncovered from the bottom, like a print coming out
  scope.querySelectorAll('.zr-person, .team-card').forEach((el) => want(el, 'wipe', 0));

  // Titles with their lead paragraph
  scope.querySelectorAll('h2').forEach((h2) => {
    const head = h2.closest('.zr-head, .ze-section-heading, .zg-section-head, .section-head, .section-header') || h2;
    want(head, 'title', 0);
    if (head === h2) {
      const next = h2.nextElementSibling;
      if (next && next.tagName === 'P') want(next, 'rise', 0.1);
    }
  });

  // Groups of similar blocks: cards, steps, lists — staggered by column
  const containers = scope.querySelectorAll('section div, section ul, section ol, main div, main ul, main ol, article ul, article ol');
  const groups = [];
  containers.forEach((box) => {
    const n = box.children.length;
    if (n < 3 || n > 48 || isSkipped(box)) return;
    const cs = getComputedStyle(box);
    const isGrid = cs.display === 'grid' || cs.display === 'inline-grid';
    const isWrapFlex = (cs.display === 'flex' || cs.display === 'inline-flex') && cs.flexWrap === 'wrap';
    const isList = (box.tagName === 'UL' || box.tagName === 'OL') && n <= 12;
    if (isGrid || isWrapFlex || isList) groups.push(box);
  });
  groups.forEach((box) => {
    if (marked.has(box) || insideMarked(box)) return;
    const kids = Array.from(box.children).filter((k) => k.offsetWidth > 40 && k.offsetHeight > 24);
    if (kids.length < 3) return;
    const top0 = kids[0].offsetTop;
    const cols = Math.max(1, kids.filter((k) => Math.abs(k.offsetTop - top0) < 4).length);
    const withMedia = kids.some((k) => k.querySelector('img'));
    const listy = (box.tagName === 'UL' || box.tagName === 'OL') && cols === 1;
    kids.forEach((k, i) => want(k, withMedia ? 'media' : (listy ? 'left' : 'rise'), (i % cols) * 0.09 + (listy ? i * 0.06 : 0)));
  });

  // Remaining blocks of each section (long reading text is left alone)
  scope.querySelectorAll('section > .landing-container > *, section > .container > *').forEach((el) => {
    if (el.offsetHeight > 30 && el.offsetHeight < vh() * 1.4) want(el, 'rise', 0);
  });
  scope.querySelectorAll('figure, blockquote, .zb-screen__inner > *').forEach((el) => want(el, 'zoom', 0));

  // Read all positions first, then write classes (one layout pass)
  const tops = plan.map((p) => p.el.getBoundingClientRect().top);
  const io = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      const el = entry.target;
      io.unobserve(el);
      el.classList.add('is-in');
      const d = parseFloat(el.style.getPropertyValue('--zx-d')) || 0;
      setTimeout(() => {
        el.classList.remove('zx-rv', 'is-in', 'zx-rv--left', 'zx-rv--zoom', 'zx-rv--title', 'zx-rv--wipe', 'zx-rv--media');
        el.style.removeProperty('--zx-d');
      }, 1700 + d * 1000);
    });
  }, { rootMargin: '0px 0px -8% 0px', threshold: 0.01 });
  let count = 0;
  plan.forEach((p, i) => {
    if (tops[i] < limit || count > 420) return;
    count += 1;
    const el = p.el;
    el.classList.add('zx-rv');
    if (p.variant !== 'rise') el.classList.add(`zx-rv--${p.variant}`);
    if (p.delay) el.style.setProperty('--zx-d', `${Math.min(p.delay, 0.6).toFixed(2)}s`);
    io.observe(el);
  });
  const revealAll = () => document.querySelectorAll('.zx-rv').forEach((el) => el.classList.add('is-in'));
  window.addEventListener('beforeprint', revealAll);
  // Safety net: once scrolling stops, anything already passed or on screen is shown
  let settle = 0;
  window.addEventListener('scroll', () => {
    clearTimeout(settle);
    settle = setTimeout(() => document.querySelectorAll('.zx-rv:not(.is-in)').forEach((el) => {
      if (el.getBoundingClientRect().top < vh() * 0.95) { io.unobserve(el); el.classList.add('is-in'); }
    }), 220);
  }, { passive: true });

  // Sequences (process steps, fact lists, FAQ): children one after another
  const seqIo = new IntersectionObserver((entries) => entries.forEach((entry) => {
    if (!entry.isIntersecting) return;
    seqIo.unobserve(entry.target);
    entry.target.classList.add('is-in'); // final state equals the original look, so the classes can stay
  }), { rootMargin: '0px 0px -12% 0px' });
  seqBoxes.forEach((box) => {
    Array.from(box.children).forEach((c, i) => c.style.setProperty('--i', i));
    box.classList.add('zx-seq');
    seqIo.observe(box);
  });

  // ---------- Count-up numbers ----------
  const NUM = /\d[\d\s ]*(?:[.,]\d+)?/;
  function countUp(el) {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node && !NUM.test(node.nodeValue)) node = walker.nextNode();
    if (!node) return;
    const original = node.nodeValue;
    const match = original.match(NUM);
    const raw = match[0].trim();
    const decSep = /[.,]\d+$/.test(raw) ? raw.match(/[.,](?=\d+$)/)[0] : '';
    const decimals = decSep ? raw.split(decSep).pop().length : 0;
    const grouped = /[\s ]/.test(raw);
    const target = parseFloat(raw.replace(/[\s ]/g, '').replace(',', '.'));
    if (!Number.isFinite(target) || target === 0) return;
    const fmt = (v) => {
      const fixed = v.toFixed(decimals);
      let [int, frac] = fixed.split('.');
      if (grouped) int = int.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
      return frac ? `${int}${decSep}${frac}` : int;
    };
    // Put the number in its own box sized to the final value, so nothing around it moves
    const numText = raw;
    const at = original.indexOf(numText, match.index);
    const box = document.createElement('span');
    box.className = 'zx-num';
    box.textContent = numText;
    node.nodeValue = original.slice(0, at);
    node.parentNode.insertBefore(box, node.nextSibling);
    box.parentNode.insertBefore(document.createTextNode(original.slice(at + numText.length)), box.nextSibling);
    box.style.display = 'inline-block';
    box.style.minWidth = `${box.getBoundingClientRect().width}px`;
    box.style.fontVariantNumeric = 'tabular-nums';
    box.textContent = fmt(0);
    const dur = 1600;
    let start = 0;
    function step(t) {
      if (!start) start = t;
      const k = Math.min(1, (t - start) / dur);
      const eased = 1 - Math.pow(2, -10 * k);
      box.textContent = k >= 1 ? numText : fmt(target * eased);
      if (k < 1) raf(step);
    }
    setTimeout(() => raf(step), parseFloat(el.dataset.zxCountDelay || '0') * 1000);
  }
  const countIo = new IntersectionObserver((entries) => entries.forEach((entry) => {
    if (!entry.isIntersecting) return;
    countIo.unobserve(entry.target);
    countUp(entry.target);
  }), { threshold: 0.6 });
  document.querySelectorAll('[data-zx-count]').forEach((el) => countIo.observe(el));

  // ---------- Scenes that play when they come into view ([data-zx-play]) ----------
  const scenes = document.querySelectorAll('[data-zx-play]');
  const anims = (el) => (el.getAnimations ? el.getAnimations({ subtree: true }) : []);
  const playIo = new IntersectionObserver((entries) => entries.forEach((entry) => {
    const el = entry.target;
    if (entry.isIntersecting) {
      if (el.dataset.zxPlayed !== '1') {
        el.dataset.zxPlayed = '1';
        anims(el).forEach((a) => { a.currentTime = 0; a.play(); });
      } else {
        anims(el).forEach((a) => { if (a.effect && a.effect.getComputedTiming().iterations === Infinity) a.play(); });
      }
    } else if (el.dataset.zxPlayed === '1') {
      anims(el).forEach((a) => { if (a.effect && a.effect.getComputedTiming().iterations === Infinity) a.pause(); });
    }
  }), { threshold: 0.25 });
  scenes.forEach((el) => {
    const r = el.getBoundingClientRect();
    if (r.top < vh() && r.bottom > 0) el.dataset.zxPlayed = '1';
    else anims(el).forEach((a) => { a.pause(); a.currentTime = 0; });
    playIo.observe(el);
  });

  // ---------- IIN line: twelve cells fill as digits are typed ----------
  const iin = document.getElementById('iin');
  const cells = document.querySelector('[data-zx-cells]');
  const searchButton = document.getElementById('search-button');
  if (iin && cells) {
    const items = Array.from(cells.children);
    const sync = () => {
      const n = Math.min(12, (iin.value.match(/\d/g) || []).length);
      items.forEach((c, i) => c.classList.toggle('is-on', i < n));
      cells.classList.toggle('is-full', n === 12);
      if (searchButton) searchButton.classList.toggle('is-ready', n === 12);
    };
    iin.addEventListener('input', sync);
    sync();
  }

  if (!finePointer) return;

  // ---------- Cursor light, tilt and magnetic buttons (mouse only) ----------
  const TILT = '.zr-case, .zr-person, .zr-sms, .zr-mistake, .ze-result-showcase__document, .zb-phone, .zg-card, .legal-card, .seo-card';
  const LIT = `${TILT}, .zp-bank, .ze-process-step, .zr-faq__item, .zr-chip, .zr-law, [class*="-card"]:not([class*="__"])`;
  const darkBg = (el) => {
    const m = getComputedStyle(el).backgroundColor.match(/\d+(\.\d+)?/g);
    if (!m || (m[3] !== undefined && Number(m[3]) < 0.5)) return false;
    return (0.299 * m[0] + 0.587 * m[1] + 0.114 * m[2]) < 110;
  };
  document.querySelectorAll(LIT).forEach((el) => {
    if (el.closest('.site-header, .landing-footer, #results, .modal') || el.offsetWidth > 760 || el.offsetWidth < 80) return;
    if (getComputedStyle(el, '::after').content !== 'none') return;
    if (getComputedStyle(el).position === 'static') el.style.position = 'relative';
    el.classList.add('zx-lit');
    if (darkBg(el)) el.classList.add('zx-lit--dark');
    const tilt = el.matches(TILT);
    if (tilt) el.classList.add('zx-tilt');
    el.addEventListener('pointermove', (e) => {
      const r = el.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width;
      const y = (e.clientY - r.top) / r.height;
      el.style.setProperty('--mx', `${(x * 100).toFixed(1)}%`);
      el.style.setProperty('--my', `${(y * 100).toFixed(1)}%`);
      if (tilt && !el.classList.contains('zx-rv')) {
        el.classList.add('is-tilting');
        el.style.transform = `perspective(900px) rotateX(${((0.5 - y) * 6).toFixed(2)}deg) rotateY(${((x - 0.5) * 7).toFixed(2)}deg) translateY(-4px)`;
      }
    });
    el.addEventListener('pointerleave', () => {
      if (!tilt) return;
      el.classList.remove('is-tilting');
      el.style.transform = '';
    });
  });

  const SHINE = '.zp-btn, #search-button, .zp-wa, .landing-btn, .zb-btn, .zg-button, .zr-btn, .btn-primary, .btn-success, .cc-button, .bc-button';
  document.querySelectorAll(SHINE).forEach((el) => {
    if (el.closest('.site-header, #results, .modal')) return;
    if (getComputedStyle(el).backgroundImage === 'none') el.classList.add('zx-shine');
  });
  document.querySelectorAll('.zp-hero #search-button, .zp-hero .zp-wa').forEach((el) => {
    el.classList.add('zx-magnet');
    el.addEventListener('pointermove', (e) => {
      const r = el.getBoundingClientRect();
      const dx = (e.clientX - (r.left + r.width / 2)) / r.width;
      const dy = (e.clientY - (r.top + r.height / 2)) / r.height;
      el.style.transform = `translate(${(dx * 8).toFixed(1)}px, ${(dy * 6).toFixed(1)}px)`;
    });
    el.addEventListener('pointerleave', () => { el.style.transform = ''; });
  });
})();
