'use strict';

(() => {
  const create = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  const formatValue = value => {
    const raw = String(value || '').trim();
    if (!raw) return '—';
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
      const date = new Date(`${raw}T12:00:00+05:00`);
      if (!Number.isNaN(date.getTime())) return new Intl.DateTimeFormat('ru-RU').format(date);
    }
    return raw;
  };

  const searchForm = document.querySelector('[data-od-housing-search]');
  if (searchForm) {
    const status = document.querySelector('[data-od-housing-search-status]');
    const results = document.querySelector('[data-od-housing-search-results]');
    searchForm.addEventListener('submit', async event => {
      event.preventDefault();
      const fullName = searchForm.elements.fullName.value.trim();
      results.hidden = true;
      results.replaceChildren();
      status.textContent = 'Проверяем официальные жилищные списки…';
      const button = searchForm.querySelector('button[type="submit"]');
      button.disabled = true;
      try {
        const response = await fetch('/api/open-data/housing-search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fullName }),
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || 'Поиск временно недоступен');
        status.textContent = payload.results.length
          ? `Найдено записей: ${payload.results.length}. Проверено наборов: ${payload.searchedDatasets}.`
          : `Совпадений не найдено. Проверено наборов: ${payload.searchedDatasets}.`;
        payload.results.forEach(item => {
          const card = create('article', 'od-name-result');
          const badge = create('span', 'od-name-result__badge', item.listType);
          const title = create('h3', '', item.fullName);
          const facts = create('dl', 'od-name-result__facts');
          (Array.isArray(item.details) ? item.details : []).filter(field => field.value).forEach(field => {
            const row = create('div');
            row.append(create('dt', '', field.label), create('dd', '', formatValue(field.value)));
            facts.append(row);
          });
          const datasetRow = create('div');
          datasetRow.append(create('dt', '', 'Набор'), create('dd', '', item.datasetTitle));
          facts.append(datasetRow);
          const link = create('a', 'od-text-link', 'Открыть официальный источник →');
          link.href = item.datasetUrl;
          link.target = '_blank';
          link.rel = 'noopener noreferrer nofollow';
          card.append(badge, title, facts, link);
          results.append(card);
        });
        results.hidden = payload.results.length === 0;
      } catch (error) {
        status.textContent = error.message;
      } finally {
        button.disabled = false;
      }
    });
  }

  const records = document.querySelector('[data-od-housing-records]');
  if (!records) return;
  const datasetKey = records.dataset.datasetKey;
  const query = records.querySelector('[data-od-records-query]');
  const find = records.querySelector('[data-od-records-find]');
  const reset = records.querySelector('[data-od-records-reset]');
  const more = records.querySelector('[data-od-records-more]');
  const status = records.querySelector('[data-od-records-status]');
  const table = records.querySelector('[data-od-records-table]');
  const head = records.querySelector('[data-od-records-head]');
  const body = records.querySelector('[data-od-records-body]');
  let nextCursor = '';
  let activeName = '';
  let columns = [];

  const load = async ({ append = false } = {}) => {
    status.textContent = activeName ? 'Ищем ФИО в официальном списке…' : 'Загружаем записи из официального источника…';
    find.disabled = true;
    more.disabled = true;
    try {
      const response = await fetch('/api/open-data/housing-records', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dataset: datasetKey,
          cursor: append && nextCursor ? nextCursor : '',
          fullName: activeName,
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Не удалось получить список');
      columns = payload.columns;
      if (!append) {
        head.replaceChildren(...columns.map(column => create('th', '', column.label)));
        body.replaceChildren();
      }
      payload.rows.forEach(row => {
        const tr = create('tr');
        columns.forEach(column => tr.append(create('td', '', formatValue(row[column.key]))));
        body.append(tr);
      });
      nextCursor = payload.nextCursor || '';
      table.hidden = columns.length === 0;
      more.hidden = !payload.hasMore;
      reset.hidden = !activeName;
      status.textContent = payload.rows.length
        ? `${activeName ? 'Найдено' : append ? 'Добавлено' : 'Показано'} записей: ${payload.rows.length}.`
        : activeName ? 'Точное совпадение по ФИО в этом наборе не найдено.' : 'В официальном наборе пока нет записей.';
    } catch (error) {
      status.textContent = error.message;
      more.hidden = true;
    } finally {
      find.disabled = false;
      more.disabled = false;
    }
  };

  find.addEventListener('click', () => {
    activeName = query.value.trim();
    nextCursor = '';
    load();
  });
  query.addEventListener('keydown', event => {
    if (event.key === 'Enter') {
      event.preventDefault();
      find.click();
    }
  });
  reset.addEventListener('click', () => {
    query.value = '';
    activeName = '';
    nextCursor = '';
    load();
  });
  more.addEventListener('click', () => load({ append: true }));
  load();
})();
