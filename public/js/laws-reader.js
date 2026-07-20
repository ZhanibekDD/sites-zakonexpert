'use strict';

document.addEventListener('DOMContentLoaded', () => {
  const reader = document.querySelector('[data-law-reader]');
  const progress = document.querySelector('[data-reading-progress]');

  if (reader && progress) {
    const updateProgress = () => {
      const rect = reader.getBoundingClientRect();
      const start = window.scrollY + rect.top;
      const distance = Math.max(1, reader.offsetHeight - window.innerHeight);
      const percent = Math.max(0, Math.min(100, ((window.scrollY - start) / distance) * 100));
      progress.style.width = `${percent}%`;
    };
    updateProgress();
    window.addEventListener('scroll', updateProgress, { passive: true });
    window.addEventListener('resize', updateProgress);
  }

  if (reader) {
    const saved = window.localStorage.getItem('lawReaderSize');
    if (['normal', 'large', 'xlarge'].includes(saved)) reader.dataset.readerSize = saved;

    document.querySelectorAll('[data-reader-size]').forEach(button => {
      const refresh = () => button.classList.toggle('active', button.dataset.readerSize === (reader.dataset.readerSize || 'normal'));
      refresh();
      button.addEventListener('click', () => {
        reader.dataset.readerSize = button.dataset.readerSize;
        window.localStorage.setItem('lawReaderSize', button.dataset.readerSize);
        document.querySelectorAll('[data-reader-size]').forEach(item => item.classList.remove('active'));
        button.classList.add('active');
      });
    });
  }

  document.querySelectorAll('[data-print-law]').forEach(button => {
    button.addEventListener('click', () => window.print());
  });

  document.querySelectorAll('[data-copy-law]').forEach(button => {
    button.addEventListener('click', async () => {
      const original = button.innerHTML;
      try {
        await navigator.clipboard.writeText(window.location.href);
        button.innerHTML = '<i class="bi bi-check2"></i> Скопировано';
      } catch (_error) {
        button.innerHTML = '<i class="bi bi-x-lg"></i> Не удалось';
      }
      window.setTimeout(() => { button.innerHTML = original; }, 1600);
    });
  });
});
