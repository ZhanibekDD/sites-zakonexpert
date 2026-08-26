(function () {
  'use strict';

  function node(tag, text, className) {
    var element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined && text !== null) element.textContent = String(text);
    return element;
  }

  function displayValue(value) {
    return value === null || value === undefined || value === '' ? '—' : String(value);
  }

  document.querySelectorAll('[data-od-records]').forEach(function (root) {
    var dataset = root.getAttribute('data-dataset-key') || '';
    var form = root.querySelector('[data-od-records-form]');
    var input = form && form.querySelector('[name="query"]');
    var reset = root.querySelector('[data-od-records-reset]');
    var status = root.querySelector('[data-od-records-status]');
    var freshness = root.querySelector('[data-od-records-freshness]');
    var tableBox = root.querySelector('[data-od-records-table]');
    var pagination = root.querySelector('[data-od-records-pagination]');
    var prev = root.querySelector('[data-od-records-prev]');
    var next = root.querySelector('[data-od-records-next]');
    var pageLabel = root.querySelector('[data-od-records-page]');
    var offset = 0;
    var query = '';
    var loading = false;

    function render(payload) {
      tableBox.textContent = '';
      if (!payload.rows || !payload.rows.length) {
        tableBox.hidden = true;
        status.textContent = query ? 'По этому запросу записей не найдено.' : 'В этой версии набора нет записей.';
      } else {
        var wrap = node('div', null, 'od-table-wrap');
        var table = node('table');
        var head = node('thead');
        var headRow = node('tr');
        payload.columns.forEach(function (column) { headRow.appendChild(node('th', column.label)); });
        head.appendChild(headRow);
        table.appendChild(head);
        var body = node('tbody');
        payload.rows.forEach(function (row) {
          var tr = node('tr');
          payload.columns.forEach(function (column) { tr.appendChild(node('td', displayValue(row[column.key]))); });
          body.appendChild(tr);
        });
        table.appendChild(body);
        wrap.appendChild(table);
        tableBox.appendChild(wrap);
        tableBox.hidden = false;
        var delivery = payload.delivery === 'official-api'
          ? ' Получены из API и сохранены локально.'
          : payload.delivery === 'stale-cache'
            ? ' Показана сохранённая копия; обновление выполняется в фоне.'
            : ' Показаны из быстрой локальной копии.';
        status.textContent = 'Показаны записи ' + (payload.offset + 1) + '–' + (payload.offset + payload.rows.length) + (query ? ' по запросу «' + query + '»' : '') + '.' + delivery;
        if (freshness) freshness.innerHTML = '<i class="bi bi-lightning-charge-fill"></i> ' + (payload.delivery === 'official-api' ? 'API синхронизирован' : 'локальная копия · быстро');
      }
      pagination.hidden = !payload.rows.length;
      prev.disabled = offset <= 0;
      next.disabled = !payload.hasMore;
      pageLabel.textContent = 'Страница ' + (Math.floor(offset / 50) + 1);
    }

    async function load() {
      if (loading || !dataset) return;
      loading = true;
      status.textContent = 'Открываем сохранённые данные…';
      if (form) Array.prototype.forEach.call(form.elements, function (element) { element.disabled = true; });
      try {
        var response = await fetch('/api/open-data/records', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ dataset: dataset, offset: offset, limit: 50, query: query }),
        });
        var payload = await response.json();
        if (!response.ok) throw new Error(payload.error || 'Не удалось получить записи');
        render(payload);
      } catch (error) {
        tableBox.hidden = true;
        pagination.hidden = true;
        status.textContent = error.message || 'Официальный источник временно недоступен.';
      } finally {
        loading = false;
        if (form) Array.prototype.forEach.call(form.elements, function (element) { element.disabled = false; });
      }
    }

    if (form) form.addEventListener('submit', function (event) {
      event.preventDefault();
      var value = (input.value || '').replace(/\s+/g, ' ').trim();
      if (value && value.length < 2) { status.textContent = 'Введите не менее двух символов.'; return; }
      query = value;
      offset = 0;
      load();
    });
    if (reset) reset.addEventListener('click', function () { input.value = ''; query = ''; offset = 0; load(); });
    if (prev) prev.addEventListener('click', function () { offset = Math.max(0, offset - 50); load(); });
    if (next) next.addEventListener('click', function () { offset += 50; load(); });
    load();
  });
})();
