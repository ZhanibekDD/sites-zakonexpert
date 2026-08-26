'use strict';

(() => {
  const search = document.querySelector('[data-od-catalog-search]');
  if (!search) return;

  const cards = [...document.querySelectorAll('[data-od-dataset-card]')];
  const count = document.querySelector('[data-od-catalog-count]');
  const empty = document.querySelector('[data-od-catalog-empty]');
  const normalize = value => String(value || '')
    .toLocaleLowerCase('ru')
    .replace(/ё/g, 'е')
    .replace(/\s+/g, ' ')
    .trim();

  const update = () => {
    const query = normalize(search.value);
    let visible = 0;

    cards.forEach(card => {
      const matches = !query || normalize(card.dataset.odSearch).includes(query);
      card.hidden = !matches;
      if (matches) visible += 1;
    });

    if (count) count.textContent = `${visible} из ${cards.length} наборов`;
    if (empty) empty.hidden = visible !== 0;
  };

  search.addEventListener('input', update);
})();
