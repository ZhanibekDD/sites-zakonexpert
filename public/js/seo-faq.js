document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.law-faq').forEach(faq => {
    const buttons = faq.querySelectorAll('.law-faq-q, .law-faq-question');

    buttons.forEach(button => {
      button.type = 'button';
      button.setAttribute('aria-expanded', 'false');

      button.addEventListener('click', () => {
        const item = button.closest('.law-faq-item');
        if (!item) return;

        const willOpen = !item.classList.contains('open');
        faq.querySelectorAll('.law-faq-item.open').forEach(openItem => {
          openItem.classList.remove('open');
          const openButton = openItem.querySelector('.law-faq-q, .law-faq-question');
          if (openButton) openButton.setAttribute('aria-expanded', 'false');
        });

        if (willOpen) item.classList.add('open');
        button.setAttribute('aria-expanded', String(willOpen));
      });
    });
  });
});
