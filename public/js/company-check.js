/* ZakonExpert — counterparty check powered by the server-side KGD API proxy. */
(function () {
  'use strict';

  var form = document.getElementById('company-check-form');
  if (!form) return;

  var input = document.getElementById('company-check-bin');
  var errorBox = document.getElementById('company-check-error');
  var loading = document.getElementById('company-check-loading');
  var result = document.getElementById('company-check-result');
  var submit = form.querySelector('button[type="submit"]');
  var currentReport = null;

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function digits(value) { return String(value || '').replace(/\D/g, '').slice(0, 12); }

  function money(value) {
    var amount = Number(value);
    if (!Number.isFinite(amount)) amount = 0;
    return Math.round(amount).toLocaleString('ru-RU') + ' ₸';
  }

  function number(value, decimals) {
    var amount = Number(value);
    if (!Number.isFinite(amount)) amount = 0;
    return amount.toLocaleString('ru-RU', {
      minimumFractionDigits: decimals || 0,
      maximumFractionDigits: decimals || 0,
    });
  }

  function date(value) {
    if (!value) return 'Нет данных';
    var match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!match) return String(value);
    return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])))
      .toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
  }

  function setHidden(element, hidden) { element.hidden = Boolean(hidden); }

  function showError(message) {
    errorBox.textContent = message;
    setHidden(errorBox, false);
  }

  function clearError() {
    errorBox.textContent = '';
    setHidden(errorBox, true);
  }

  function track(type) {
    if (typeof window.ZE_trackEvent === 'function') {
      window.ZE_trackEvent(type, 'company-check', { page_type: 'company_check' });
    }
  }

  function summaryCard(label, value, note) {
    return '<article class="cc-summary-card"><span>' + escapeHtml(label) + '</span><strong>'
      + escapeHtml(value) + '</strong>' + (note ? '<small>' + escapeHtml(note) + '</small>' : '') + '</article>';
  }

  function definitionRow(label, value) {
    return '<div><dt>' + escapeHtml(label) + '</dt><dd>' + escapeHtml(value || 'Нет данных') + '</dd></div>';
  }

  function riskCopy(assessment) {
    if (assessment.riskLevel === 'high') return {
      badge: '<i class="bi bi-exclamation-octagon-fill"></i> Высокое внимание',
      title: 'Обнаружены существенные индикаторы — не спешите с оплатой',
      text: 'Запросите подтверждающие документы и проверьте договор, полномочия подписанта и исполнение обязательств до перечисления денег.',
      className: 'cc-risk-badge--high',
    };
    if (assessment.riskLevel === 'attention') return {
      badge: '<i class="bi bi-exclamation-triangle-fill"></i> Требует внимания',
      title: 'Есть сведения, которые стоит проверить дополнительно',
      text: 'Отчёт не означает, что сделка опасна, но найденные отметки лучше разъяснить и подтвердить документами до оплаты.',
      className: 'cc-risk-badge--attention',
    };
    return {
      badge: '<i class="bi bi-check-circle-fill"></i> Явных рисков не найдено',
      title: 'В открытых данных КГД явные неблагоприятные признаки не обнаружены',
      text: 'Это хороший базовый сигнал, но перед крупной сделкой всё равно проверьте договор, судебные дела, лицензии и полномочия подписанта.',
      className: 'cc-risk-badge--low',
    };
  }

  function renderIndicators(items) {
    return items.map(function (item) {
      var state = item.informational ? 'info' : (item.flagged ? 'flag' : 'ok');
      var icon = item.informational ? 'bi-info-circle-fill' : (item.flagged ? 'bi-exclamation-circle-fill' : 'bi-check-circle-fill');
      var stateLabel = item.informational ? item.value : (item.flagged ? item.value : 'Не обнаружено');
      return '<article class="cc-indicator cc-indicator--' + state + '"><span class="cc-indicator__icon"><i class="bi '
        + icon + '"></i></span><div><strong>' + escapeHtml(item.label) + '</strong><small title="'
        + escapeHtml(stateLabel) + '">' + escapeHtml(stateLabel) + '</small></div></article>';
    }).join('');
  }

  function renderStatistics(statistics) {
    var tbody = document.getElementById('cc-statistics');
    var empty = document.getElementById('cc-no-statistics');
    if (!statistics.length) {
      tbody.innerHTML = '';
      setHidden(empty, false);
      return;
    }
    setHidden(empty, true);
    tbody.innerHTML = statistics.map(function (item) {
      return '<tr><td><strong>' + escapeHtml(item.year) + '</strong></td><td>' + number(item.workersCount)
        + '</td><td>' + money(item.taxIn) + '</td><td>' + money(item.vatAmount) + '</td><td>'
        + number(item.knn, 2) + '</td><td>' + number(item.knnAvg, 2) + '</td></tr>';
    }).join('');
  }

  function renderReport(report) {
    currentReport = report;
    var company = report.company;
    var tax = report.tax;
    var assessment = report.assessment;
    var risk = riskCopy(assessment);

    document.getElementById('cc-company-name').textContent = company.nameRu;
    document.getElementById('cc-company-bin').textContent = 'БИН ' + company.bin;
    document.getElementById('cc-actuality').textContent = date(report.actuality);

    var badge = document.getElementById('cc-risk-badge');
    badge.className = 'cc-risk-badge ' + risk.className;
    badge.innerHTML = risk.badge;

    document.getElementById('cc-summary').innerHTML = [
      summaryCard('Экспресс-индикатор', assessment.score + ' из 100', assessment.flaggedCount + ' отметок внимания'),
      summaryCard('Налоговая задолженность', money(tax.debt), tax.debt > 0 ? 'Опубликована КГД' : 'Не обнаружена'),
      summaryCard('Сведения по НДС', tax.vatInfo, tax.vatDate ? 'С ' + date(tax.vatDate) : ''),
      summaryCard('Налоговый режим', tax.taxMode, tax.taxModeDate ? 'С ' + date(tax.taxModeDate) : ''),
    ].join('');

    document.getElementById('cc-indicators').innerHTML = renderIndicators(assessment.indicators);
    document.getElementById('cc-profile').innerHTML = [
      definitionRow('БИН', company.bin),
      definitionRow('Дата регистрации', date(company.registrationDate)),
      definitionRow('Резидентство', company.residency),
      definitionRow('ОКЭД', company.oked),
      definitionRow('Вид деятельности', company.okedName),
      definitionRow('Дата ОКЭД', date(company.okedDate)),
    ].join('');
    document.getElementById('cc-tax').innerHTML = [
      definitionRow('Налоговый режим', tax.taxMode),
      definitionRow('Дата режима', date(tax.taxModeDate)),
      definitionRow('НДС', tax.vatInfo),
      definitionRow('Дата НДС', date(tax.vatDate)),
      definitionRow('Задолженность', money(tax.debt)),
    ].join('');
    renderStatistics(report.statistics || []);
    document.getElementById('cc-conclusion-title').textContent = risk.title;
    document.getElementById('cc-conclusion-text').textContent = risk.text;

    var message = 'Здравствуйте! Нужна расширенная проверка контрагента и договора.\n'
      + company.nameRu + '\nБИН: ' + company.bin + '\n'
      + 'Экспресс-индикатор: ' + assessment.score + '/100.\n'
      + location.origin + '/proverka-kontragenta?bin=' + company.bin;
    document.getElementById('cc-whatsapp').href = 'https://wa.me/77479957635?text=' + encodeURIComponent(message);

    var url = new URL(location.href);
    url.search = '';
    url.searchParams.set('bin', company.bin);
    history.replaceState({}, '', url.pathname + url.search);
    setHidden(loading, true);
    setHidden(result, false);
    result.scrollIntoView({ behavior: 'smooth', block: 'start' });
    track('company_check_completed');
  }

  async function check(bin) {
    clearError();
    if (!/^\d{12}$/.test(bin)) {
      showError('БИН должен содержать ровно 12 цифр. Проверьте реквизиты организации.');
      input.focus();
      return;
    }

    submit.disabled = true;
    submit.querySelector('span').textContent = 'Проверяем…';
    setHidden(result, true);
    setHidden(loading, false);
    track('company_check_started');

    try {
      var response = await fetch('/api/company-check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bin: bin }),
      });
      var payload = await response.json().catch(function () { return {}; });
      if (!response.ok) {
        var message = payload.error || 'Не удалось получить данные КГД. Попробуйте позже.';
        if (response.status === 404) message = 'КГД не вернул сведения по этому БИН. Проверьте номер или попробуйте позже.';
        if (response.status === 503) message = 'Официальный источник временно недоступен. Попробуйте немного позже.';
        throw new Error(message);
      }
      renderReport(payload);
    } catch (error) {
      setHidden(loading, true);
      showError(error.message || 'Не удалось выполнить проверку.');
    } finally {
      submit.disabled = false;
      submit.querySelector('span').textContent = 'Проверить';
    }
  }

  input.addEventListener('input', function () {
    var clean = digits(input.value);
    if (input.value !== clean) input.value = clean;
    clearError();
  });

  form.addEventListener('submit', function (event) {
    event.preventDefault();
    check(digits(input.value));
  });

  document.querySelector('[data-cc-action="print"]').addEventListener('click', function () {
    if (!currentReport) return;
    track('company_check_pdf');
    window.print();
  });

  document.querySelector('[data-cc-action="share"]').addEventListener('click', function (event) {
    if (!currentReport) return;
    var button = event.currentTarget;
    var original = button.innerHTML;
    var done = function () {
      button.innerHTML = '<i class="bi bi-check2"></i> Ссылка скопирована';
      track('company_check_shared');
      setTimeout(function () { button.innerHTML = original; }, 1700);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(location.href).then(done).catch(done);
    else done();
  });

  document.getElementById('cc-whatsapp').addEventListener('click', function () {
    track('click_cta_company_check');
  });

  var initialBin = digits(new URLSearchParams(location.search).get('bin'));
  if (initialBin.length === 12) {
    input.value = initialBin;
    check(initialBin);
  }
})();
