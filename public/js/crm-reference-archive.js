'use strict';

(() => {
  if (location.pathname !== '/crm') return;
  const terminal = ['declined', 'cancelled', 'lost'];
  function sync() {
    const show = document.body.classList.contains('crm-show-archive');
    for (const stage of terminal) {
      document.querySelectorAll(`.column[data-stage="${stage}"]`).forEach(col => {
        col.style.setProperty('display', show ? 'block' : 'none', 'important');
        if (show) {
          col.style.setProperty('min-width', '160px', 'important');
          col.style.setProperty('width', '160px', 'important');
        }
      });
    }
  }
  new MutationObserver(sync).observe(document.body, { attributes: true, attributeFilter: ['class'] });
  const board = document.querySelector('#board');
  if (board) new MutationObserver(sync).observe(board, { childList: true, subtree: true });
  document.addEventListener('click', e => {
    if (e.target.closest('#crmArchiveToggle')) setTimeout(sync, 0);
  });
  sync();
})();
