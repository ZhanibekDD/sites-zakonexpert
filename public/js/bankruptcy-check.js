'use strict';

(function initBankruptcyCheck() {
  const form = document.getElementById('bc-form');
  const input = document.getElementById('bc-iin');
  const consent = document.getElementById('bc-consent');
  const submit = document.getElementById('bc-submit');
  const errorBox = document.getElementById('bc-form-error');
  const loading = document.getElementById('bc-loading');
  const result = document.getElementById('bc-result');
  const summary = document.getElementById('bc-result-summary');
  const sources = document.getElementById('bc-result-sources');
  const printButton = document.getElementById('bc-print');

  if (!form || !input || !consent || !submit || !errorBox || !loading || !result || !summary || !sources) return;

  const sourceDefinitions = [
    { key: 'outOfCourt', title: 'Внесудебное банкротство', icon: 'bi-building-check' },
    { key: 'judicial', title: 'Судебное банкротство', icon: 'bi-bank' },
    { key: 'recovery', title: 'Восстановление платёжеспособности', icon: 'bi-arrow-repeat' },
  ];

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function setError(message) {
    errorBox.textContent = message;
    errorBox.hidden = !message;
  }

  function setBusy(isBusy) {
    submit.disabled = isBusy;
    submit.innerHTML = isBusy
      ? '<span class="spinner-border spinner-border-sm" aria-hidden="true"></span> Проверяем'
      : 'Проверить <i class="bi bi-arrow-right" aria-hidden="true"></i>';
    loading.hidden = !isBusy;
  }

  function sourceWasChecked(data) {
    return Boolean(data && data.ok !== false && !data.error);
  }

  function renderRecord(row, headers) {
    const cells = Array.isArray(row) ? row : [];
    const labels = Array.isArray(headers) ? headers : [];
    const details = cells.map(function(cell, index) {
      if (!cell) return '';
      const label = labels[index] || `Поле ${index + 1}`;
      return `<div><span>${escapeHtml(label)}</span><strong>${escapeHtml(cell)}</strong></div>`;
    }).join('');
    return `<div class="bc-record">${details || '<strong>Запись опубликована в реестре</strong>'}</div>`;
  }

  function renderSource(definition, data) {
    const checked = sourceWasChecked(data);
    const rows = Array.isArray(data?.rows) ? data.rows : [];
    const total = Number.isFinite(Number(data?.total)) ? Number(data.total) : rows.length;
    let stateClass = '';
    let stateLabel = `${total || rows.length} записей`;
    let body = '';

    if (!checked) {
      stateClass = ' bc-source-result--unavailable';
      stateLabel = 'Источник недоступен';
      body = '<p class="bc-source-result__unavailable">Реестр временно не ответил. Повторите проверку позже.</p>';
    } else if (rows.length) {
      stateClass = ' bc-source-result--found';
      stateLabel = `Найдено: ${rows.length}`;
      body = rows.map(function(row) { return renderRecord(row, data.headers); }).join('');
    } else {
      stateLabel = 'Совпадений нет';
      body = '<p class="bc-source-result__empty"><i class="bi bi-check-circle"></i> Источник проверен, записей по указанному ИИН не найдено.</p>';
    }

    return `<article class="bc-source-result${stateClass}">
      <div class="bc-source-result__head"><i class="bi ${definition.icon}"></i><div><strong>${definition.title}</strong><small>${stateLabel}</small></div></div>
      <div class="bc-source-result__body">${body}</div>
    </article>`;
  }

  function renderResult(data) {
    const checkedSources = sourceDefinitions.filter(function(definition) {
      return sourceWasChecked(data[definition.key]);
    }).length;
    const totalRecords = sourceDefinitions.reduce(function(total, definition) {
      const rows = data[definition.key]?.rows;
      return total + (Array.isArray(rows) ? rows.length : 0);
    }, 0);

    if (totalRecords > 0) {
      summary.className = 'bc-result-summary bc-result-summary--found';
      summary.innerHTML = '<i class="bi bi-exclamation-octagon-fill" aria-hidden="true"></i><div><h2 id="bc-result-title">Найдены опубликованные записи</h2><p>Проверьте вид процедуры, даты и текущий статус в деталях ниже.</p></div>';
    } else if (checkedSources === sourceDefinitions.length) {
      summary.className = 'bc-result-summary bc-result-summary--clear';
      summary.innerHTML = '<i class="bi bi-check-circle-fill" aria-hidden="true"></i><div><h2 id="bc-result-title">Записей о банкротстве не найдено</h2><p>Все три подключённых реестра ответили, совпадений по указанному ИИН нет.</p></div>';
    } else {
      summary.className = 'bc-result-summary bc-result-summary--partial';
      summary.innerHTML = `<i class="bi bi-exclamation-triangle-fill" aria-hidden="true"></i><div><h2 id="bc-result-title">Проверка выполнена частично</h2><p>Ответили ${checkedSources} из ${sourceDefinitions.length} источников. Отсутствие записи пока нельзя подтвердить полностью.</p></div>`;
    }

    sources.innerHTML = sourceDefinitions.map(function(definition) {
      return renderSource(definition, data[definition.key] || { ok: false });
    }).join('');
    result.hidden = false;
    result.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
  }

  input.addEventListener('input', function() {
    this.value = this.value.replace(/\D/g, '').slice(0, 12);
    if (errorBox.textContent) setError('');
  });

  consent.addEventListener('change', function() {
    if (this.checked && errorBox.textContent) setError('');
  });

  form.addEventListener('submit', async function(event) {
    event.preventDefault();
    const iin = input.value.replace(/\D/g, '');
    setError('');

    if (iin.length !== 12) {
      setError('Введите ИИН из 12 цифр.');
      input.focus();
      return;
    }
    if (!consent.checked) {
      setError('Подтвердите согласие на разовую обработку ИИН.');
      consent.focus();
      return;
    }

    result.hidden = true;
    setBusy(true);
    try {
      const response = await fetch('/api/bankruptcy-check', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ iin }),
      });
      const data = await response.json().catch(function() { return {}; });
      if (!response.ok) throw new Error(data.error || 'Не удалось выполнить проверку.');
      renderResult(data);
    } catch (error) {
      setError(error.message || 'Официальные источники временно недоступны. Повторите позже.');
    } finally {
      setBusy(false);
    }
  });

  if (printButton) printButton.addEventListener('click', function() { window.print(); });
}());
