/* ZakonExpert — unified official-source counterparty check. */
(function () {
  'use strict';

  var form = document.getElementById('company-check-form');
  if (!form) return;

  var input = document.getElementById('company-check-bin');
  var suggestions = document.getElementById('company-check-suggestions');
  var errorBox = document.getElementById('company-check-error');
  var loading = document.getElementById('company-check-loading');
  var result = document.getElementById('company-check-result');
  var submit = form.querySelector('button[type="submit"]');
  var currentReport = null;
  var suggestTimer = null;
  var suggestRequest = null;
  var suggestionItems = [];
  var activeSuggestion = -1;

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function digits(value) { return String(value || '').replace(/\D/g, '').slice(0, 12); }

  function money(value) {
    if (value === null || value === undefined || value === '') return 'Нет данных';
    var amount = Number(value);
    if (!Number.isFinite(amount)) return 'Нет данных';
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

  function hideSuggestions() {
    suggestions.innerHTML = '';
    suggestionItems = [];
    activeSuggestion = -1;
    setHidden(suggestions, true);
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
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

  function definitionLinkRow(label, value, href) {
    if (!href) return definitionRow(label, value);
    return '<div><dt>' + escapeHtml(label) + '</dt><dd><a class="cc-inline-link" href="'
      + escapeHtml(href) + '">' + escapeHtml(value || 'Открыть') + '</a></dd></div>';
  }

  function riskCopy(assessment) {
    if (assessment.riskLevel === 'high') return {
      badge: '<i class="bi bi-exclamation-octagon-fill"></i> Высокое внимание',
      title: 'Обнаружены существенные индикаторы',
      text: 'Запросите подтверждающие документы и отдельно проверьте договор, полномочия подписанта и исполнение обязательств до оплаты.',
      className: 'cc-risk-badge--high',
    };
    if (assessment.riskLevel === 'attention') return {
      badge: '<i class="bi bi-exclamation-triangle-fill"></i> Требует внимания',
      title: 'Есть сведения, которые нужно проверить дополнительно',
      text: 'Найденные отметки не являются автоматическим выводом о ненадёжности, но требуют объяснений и документов.',
      className: 'cc-risk-badge--attention',
    };
    if (assessment.riskLevel === 'low') return {
      badge: '<i class="bi bi-check-circle-fill"></i> Явных рисков не найдено',
      title: 'В подключённых реестрах явные неблагоприятные признаки не обнаружены',
      text: 'Проверка отражает только доступные официальные сведения и не гарантирует исполнение будущей сделки.',
      className: 'cc-risk-badge--low',
    };
    return {
      badge: '<i class="bi bi-info-circle-fill"></i> Данных для оценки недостаточно',
      title: 'Профиль найден, но не все источники сейчас доступны',
      text: 'Не делайте вывод о надёжности по отсутствующим данным. Статус каждого источника указан ниже.',
      className: 'cc-risk-badge--unknown',
    };
  }

  function renderIndicators(items) {
    if (!items.length) return '<p class="cc-empty cc-empty--full">Индикаторы КГД пока не получены. Это не означает отсутствие рисков.</p>';
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

  function renderProcurement(procurement) {
    var target = document.getElementById('cc-procurement');
    if (!procurement) {
      target.innerHTML = '<p class="cc-empty cc-empty--full">Источник госзакупок пока не подключён или временно недоступен. Отсутствие данных не означает отсутствие договоров.</p>';
      return;
    }
    var supplier = procurement.contracts.asSupplier;
    var customer = procurement.contracts.asCustomer;
    var rnu = procurement.unreliableSupplier;
    var latest = supplier.latest.concat(customer.latest)
      .sort(function (a, b) { return String(b.createdAt || '').localeCompare(String(a.createdAt || '')); })
      .slice(0, 5);
    target.innerHTML = '<div class="cc-procurement-stats">'
      + summaryCard('Участник госзакупок', procurement.participant.registered ? 'Да' : 'Не найден', procurement.participant.indexedAt ? 'Индекс: ' + date(procurement.participant.indexedAt) : '')
      + summaryCard('Договоры как поставщик', number(supplier.count), 'По данным официального реестра')
      + summaryCard('Договоры как заказчик', number(customer.count), 'По данным официального реестра')
      + summaryCard('Недобросовестный поставщик', rnu.found ? 'Найдено: ' + number(rnu.count) : 'Не обнаружено', rnu.found ? 'Требует проверки' : 'По ответу реестра')
      + '</div>'
      + (latest.length ? '<div class="cc-contracts"><strong>Последние опубликованные договоры</strong>'
        + latest.map(function (item) {
          return '<div><span>' + escapeHtml(item.number || 'Договор без номера') + '</span><small>'
            + escapeHtml(date(item.createdAt)) + '</small><b>' + escapeHtml(money(item.amount)) + '</b></div>';
        }).join('') + '</div>' : '');
  }

  function renderSources(sources) {
    var labels = {
      ok: ['Получено', 'ok'],
      not_found: ['Не найдено', 'neutral'],
      not_configured: ['Ожидается доступ', 'pending'],
      access_denied: ['Нет доступа', 'error'],
      unavailable: ['Недоступен', 'error'],
      partial: ['Частично', 'pending'],
      official_search: ['Официальный поиск', 'neutral'],
    };
    document.getElementById('cc-sources').innerHTML = sources.map(function (source) {
      var state = labels[source.status] || ['Недоступен', 'error'];
      return '<article class="cc-source cc-source--' + state[1] + '"><span class="cc-source__state"><i class="bi bi-circle-fill"></i>'
        + escapeHtml(state[0]) + '</span><div><a href="' + escapeHtml(source.url) + '" target="_blank" rel="noopener">'
        + escapeHtml(source.label) + ' <i class="bi bi-box-arrow-up-right"></i></a><small>'
        + escapeHtml(source.detail) + (source.actuality ? ' · ' + escapeHtml(date(source.actuality)) : '')
        + '</small></div></article>';
    }).join('');
  }

  function contactPresentation(type) {
    var values = {
      phone: ['Телефон', 'bi-telephone'],
      mobile_phone: ['Мобильный телефон', 'bi-phone'],
      email: ['E-mail', 'bi-envelope'],
      website: ['Сайт', 'bi-globe2'],
      whatsapp: ['WhatsApp', 'bi-whatsapp'],
      viber: ['Viber', 'bi-chat-dots'],
      telegram: ['Telegram', 'bi-telegram'],
    };
    return values[type] || ['Контакт', 'bi-link-45deg'];
  }

  function contactHref(contact) {
    var value = String(contact.value || '').trim();
    var normalized = String(contact.normalized || value).trim();
    if (contact.type === 'email') return /^\S+@\S+\.\S+$/.test(value) ? 'mailto:' + value : '';
    if (contact.type === 'phone' || contact.type === 'mobile_phone') {
      var phone = normalized.replace(/[^\d+]/g, '');
      return phone ? 'tel:' + phone : '';
    }
    if (contact.type === 'whatsapp') {
      var whatsapp = normalized.replace(/\D/g, '');
      return whatsapp ? 'https://wa.me/' + whatsapp : '';
    }
    if (contact.type === 'website') {
      if (/^https?:\/\//i.test(value)) return value;
      if (/^[\wа-яё-]+(?:\.[\wа-яё-]+)+(?:\/.*)?$/i.test(value)) return 'https://' + value;
      return '';
    }
    if (contact.type === 'telegram') {
      if (/^https?:\/\//i.test(value)) return value;
      if (/^@[\w_]{4,}$/i.test(value)) return 'https://t.me/' + value.slice(1);
    }
    return /^https?:\/\//i.test(value) ? value : '';
  }

  function detailRow(icon, label, value, source, href) {
    var external = href && /^https?:\/\//i.test(href);
    var content = href
      ? '<a href="' + escapeHtml(href) + '"' + (external ? ' target="_blank" rel="noopener"' : '') + '>' + escapeHtml(value) + '</a>'
      : '<strong>' + escapeHtml(value) + '</strong>';
    return '<div class="cc-detail-row"><i class="bi ' + escapeHtml(icon) + '"></i><div><span class="cc-detail-row__label">'
      + escapeHtml(label) + '</span>' + content
      + (source ? '<small>Источник: ' + escapeHtml(source) + '</small>' : '') + '</div></div>';
  }

  function renderCompanyDetails(company) {
    var contacts = Array.isArray(company.contacts) ? company.contacts : [];
    var addresses = Array.isArray(company.addresses) ? company.addresses.slice() : [];
    var attributes = Array.isArray(company.attributes) ? company.attributes : [];
    var legalAddress = String(company.address || '').trim();
    if (legalAddress && legalAddress !== 'Нет данных'
        && !addresses.some(function (item) { return String(item.value || '').trim() === legalAddress; })) {
      addresses.unshift({ value: legalAddress, primary: true, sourceLabel: 'ГБД ЮЛ — data.egov.kz' });
    }

    var contactHtml = contacts.length
      ? contacts.map(function (contact) {
        var meta = contactPresentation(contact.type);
        return detailRow(meta[1], meta[0], contact.value, contact.sourceLabel, contactHref(contact));
      }).join('')
      : '<p class="cc-empty">Телефоны и e-mail не опубликованы в подключённом справочнике.</p>';
    var addressHtml = addresses.length
      ? addresses.map(function (address) {
        return detailRow('bi-geo-alt', address.primary ? 'Юридический адрес' : 'Дополнительный адрес', address.value, address.sourceLabel, '');
      }).join('')
      : '<p class="cc-empty">Адрес организации не опубликован.</p>';
    var hours = attributes.filter(function (attribute) { return attribute.type === 'work_hours'; });
    if (hours.length) {
      addressHtml += hours.map(function (attribute) {
        return detailRow('bi-clock', 'Режим работы', attribute.value, attribute.sourceLabel, '');
      }).join('');
    }

    var mappedAddress = addresses.find(function (address) {
      return Number.isFinite(Number(address.latitude)) && Number.isFinite(Number(address.longitude));
    }) || addresses[0];
    var mapHtml = '<div class="cc-map-card"><div class="cc-map-card__empty"><div><i class="bi bi-map"></i>Местонахождение не удалось определить по опубликованным данным.</div></div></div>';
    if (mappedAddress && mappedAddress.value) {
      var hasCoordinates = Number.isFinite(Number(mappedAddress.latitude)) && Number.isFinite(Number(mappedAddress.longitude));
      var mapQuery = hasCoordinates
        ? Number(mappedAddress.latitude) + ',' + Number(mappedAddress.longitude)
        : mappedAddress.value;
      var encodedMapQuery = encodeURIComponent(mapQuery);
      var encodedAddress = encodeURIComponent(mappedAddress.value);
      mapHtml = '<div class="cc-map-card"><iframe loading="lazy" referrerpolicy="no-referrer-when-downgrade" title="Карта расположения '
        + escapeHtml(company.nameRu) + '" src="https://maps.google.com/maps?q=' + encodedMapQuery
        + '&amp;output=embed&amp;hl=ru&amp;z=15"></iframe><div class="cc-map-card__actions">'
        + '<a href="https://2gis.kz/search/' + encodedAddress + '" target="_blank" rel="noopener"><i class="bi bi-geo-alt-fill"></i> Открыть в 2GIS</a>'
        + '<a href="https://maps.google.com/?q=' + encodedMapQuery + '" target="_blank" rel="noopener"><i class="bi bi-map"></i> Google Maps</a>'
        + '</div></div>';
    }

    document.getElementById('cc-company-details').innerHTML = '<div class="cc-details-stack">'
      + '<section class="cc-details-group"><h4 class="cc-details-group__title"><i class="bi bi-person-lines-fill"></i> Контактные данные</h4>' + contactHtml + '</section>'
      + '<section class="cc-details-group"><h4 class="cc-details-group__title"><i class="bi bi-building"></i> Адреса и режим работы</h4>' + addressHtml + '</section>'
      + '</div>' + mapHtml
      + '<p class="cc-details-note"><i class="bi bi-info-circle"></i><span>Контакты и координаты могут поступать из справочников организаций. Перед звонком, визитом или оплатой сверяйте их с официальным сайтом компании.</span></p>';
  }

  function renderReport(report) {
    currentReport = report;
    var company = report.company;
    var tax = report.tax;
    var assessment = report.assessment;
    var procurement = report.procurement;
    var risk = riskCopy(assessment);
    var supplierCount = procurement ? procurement.contracts.asSupplier.count : null;

    document.getElementById('cc-company-name').textContent = company.nameRu;
    document.getElementById('cc-company-bin').textContent = 'БИН ' + company.bin;
    document.getElementById('cc-actuality').textContent = date(report.actuality);

    var badge = document.getElementById('cc-risk-badge');
    badge.className = 'cc-risk-badge ' + risk.className;
    badge.innerHTML = risk.badge;

    document.getElementById('cc-summary').innerHTML = [
      summaryCard('Экспресс-индикатор', assessment.score === null ? 'Не рассчитан' : assessment.score + ' из 100', assessment.flaggedCount === null ? 'Недостаточно данных' : assessment.flaggedCount + ' отметок внимания'),
      summaryCard('Налоговая задолженность', money(tax.debt), tax.debt === null ? 'КГД не ответил' : (tax.debt > 0 ? 'Опубликована КГД' : 'Не обнаружена')),
      summaryCard('НДС', tax.vatInfo, tax.vatDate ? 'С ' + date(tax.vatDate) : ''),
      summaryCard('Договоры поставщика', supplierCount === null ? 'Нет данных' : number(supplierCount), procurement ? 'Портал госзакупок' : 'Источник не ответил'),
    ].join('');

    var note = document.getElementById('cc-coverage-note');
    note.className = 'cc-coverage-note ' + (report.coverage.complete ? 'cc-coverage-note--complete' : 'cc-coverage-note--partial');
    note.innerHTML = report.coverage.complete
      ? '<i class="bi bi-check-circle-fill"></i><span><strong>Все подключённые источники ответили.</strong> Ниже указана дата каждого набора данных.</span>'
      : '<i class="bi bi-info-circle-fill"></i><span><strong>Отчёт частичный.</strong> Доступные сведения показаны, отсутствующие не заменены догадками.</span>';

    document.getElementById('cc-indicators').innerHTML = renderIndicators(assessment.indicators || []);
    document.getElementById('cc-profile').innerHTML = [
      definitionRow('БИН', company.bin),
      definitionRow('Статус', company.status),
      definitionRow('Дата регистрации', date(company.registrationDate)),
      definitionRow('Руководитель', company.leader),
      definitionRow('Юридический адрес', company.address),
      definitionRow('Резидентство', company.residency),
      definitionRow('ОКЭД', company.oked),
      definitionRow('Вид деятельности', company.okedName),
      definitionLinkRow('Карточка в каталоге', company.cardUrl ? 'Открыть полный профиль' : 'Нет данных', company.cardUrl),
    ].join('');
    document.getElementById('cc-tax').innerHTML = [
      definitionRow('Налоговый режим', tax.taxMode),
      definitionRow('Дата режима', date(tax.taxModeDate)),
      definitionRow('НДС', tax.vatInfo),
      definitionRow('Дата НДС', date(tax.vatDate)),
      definitionRow('Задолженность', money(tax.debt)),
    ].join('');
    renderCompanyDetails(company);
    renderProcurement(procurement);
    renderStatistics(report.statistics || []);
    renderSources(report.sources || []);
    document.getElementById('cc-conclusion-title').textContent = risk.title;
    document.getElementById('cc-conclusion-text').textContent = risk.text;

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
    hideSuggestions();
    if (!/^\d{12}$/.test(bin)) {
      showError('Введите БИН из 12 цифр или выберите организацию из подсказок.');
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
      if (!response.ok) throw new Error(payload.error || 'Не удалось получить данные из официальных источников.');
      renderReport(payload);
    } catch (error) {
      setHidden(loading, true);
      showError(error.message || 'Не удалось выполнить проверку.');
    } finally {
      submit.disabled = false;
      submit.querySelector('span').textContent = 'Проверить';
    }
  }

  function renderSuggestions(items) {
    suggestionItems = items;
    activeSuggestion = -1;
    if (!items.length) {
      suggestions.innerHTML = '<p>Совпадений не найдено. Можно ввести точный БИН.</p>';
    } else {
      suggestions.innerHTML = items.map(function (item, index) {
        var contacts = [
          item.phone ? '<span><i class="bi bi-telephone"></i>' + escapeHtml(item.phone) + '</span>' : '',
          item.email ? '<span><i class="bi bi-envelope"></i>' + escapeHtml(item.email) + '</span>' : '',
        ].filter(Boolean).join('');
        return '<button id="company-suggestion-' + String(index) + '" type="button" role="option" aria-selected="false" data-index="'
          + String(index) + '" data-bin="' + escapeHtml(item.bin) + '" data-name="' + escapeHtml(item.name) + '">'
          + '<span class="cc-suggestion__top"><strong class="cc-suggestion__name">' + escapeHtml(item.name) + '</strong>'
          + (item.status ? '<span class="cc-suggestion__status">' + escapeHtml(item.status) + '</span>' : '') + '</span>'
          + '<span class="cc-suggestion__meta"><span><i class="bi bi-upc-scan"></i>БИН ' + escapeHtml(item.bin || 'не указан') + '</span>'
          + (item.activity ? '<span><i class="bi bi-briefcase"></i>' + escapeHtml(item.activity) + '</span>' : '')
          + (item.leader ? '<span><i class="bi bi-person"></i>' + escapeHtml(item.leader) + '</span>' : '')
          + (item.address ? '<span class="cc-suggestion__address"><i class="bi bi-geo-alt"></i>' + escapeHtml(item.address) + '</span>' : '') + '</span>'
          + (contacts ? '<span class="cc-suggestion__contacts">' + contacts + '</span>' : '') + '</button>';
      }).join('') + '<a class="cc-suggestions__more" href="/companies?q=' + encodeURIComponent(input.value.trim())
        + '"><i class="bi bi-search"></i> Показать больше совпадений в каталоге</a>';
    }
    setHidden(suggestions, false);
    input.setAttribute('aria-expanded', 'true');
  }

  function setActiveSuggestion(index) {
    var options = suggestions.querySelectorAll('button[data-index]');
    if (!options.length) return;
    activeSuggestion = Math.max(0, Math.min(index, options.length - 1));
    options.forEach(function (option, optionIndex) {
      option.setAttribute('aria-selected', optionIndex === activeSuggestion ? 'true' : 'false');
    });
    var active = options[activeSuggestion];
    input.setAttribute('aria-activedescendant', active.id);
    active.scrollIntoView({ block: 'nearest' });
  }

  function chooseSuggestion(index) {
    var item = suggestionItems[index];
    if (!item) return;
    if (!/^\d{12}$/.test(String(item.bin || ''))) {
      if (item.url && /^\/company\//.test(item.url)) location.href = item.url;
      return;
    }
    input.dataset.bin = item.bin;
    input.value = item.bin + ' — ' + item.name;
    hideSuggestions();
    clearError();
    check(item.bin);
  }

  async function loadSuggestions(query) {
    if (suggestRequest) suggestRequest.abort();
    suggestRequest = new AbortController();
    try {
      var response = await fetch('/api/company-suggest?q=' + encodeURIComponent(query), { signal: suggestRequest.signal });
      if (!response.ok) return;
      var payload = await response.json();
      if (input.value.trim() === query) renderSuggestions(payload.items || []);
    } catch (error) {
      if (error.name !== 'AbortError') hideSuggestions();
    }
  }

  input.addEventListener('input', function () {
    clearError();
    delete input.dataset.bin;
    window.clearTimeout(suggestTimer);
    var query = input.value.trim();
    if (/^\d{12}$/.test(query)) {
      input.dataset.bin = query;
      hideSuggestions();
      return;
    }
    if (query.length < 2) {
      hideSuggestions();
      return;
    }
    suggestTimer = window.setTimeout(function () { loadSuggestions(query); }, 170);
  });

  input.addEventListener('keydown', function (event) {
    if (suggestions.hidden || !suggestionItems.length) {
      if (event.key === 'Escape') hideSuggestions();
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveSuggestion(activeSuggestion < suggestionItems.length - 1 ? activeSuggestion + 1 : 0);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveSuggestion(activeSuggestion > 0 ? activeSuggestion - 1 : suggestionItems.length - 1);
    } else if (event.key === 'Enter' && activeSuggestion >= 0) {
      event.preventDefault();
      chooseSuggestion(activeSuggestion);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      hideSuggestions();
    }
  });

  suggestions.addEventListener('click', function (event) {
    var option = event.target.closest('button[data-bin]');
    if (!option) return;
    chooseSuggestion(Number(option.dataset.index));
  });

  document.addEventListener('click', function (event) {
    if (!form.contains(event.target)) hideSuggestions();
  });

  form.addEventListener('submit', function (event) {
    event.preventDefault();
    var exact = /^\d{12}$/.test(input.value.trim()) ? input.value.trim() : '';
    check(input.dataset.bin || exact);
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

  var initialBin = digits(new URLSearchParams(location.search).get('bin'));
  if (initialBin.length === 12) {
    input.value = initialBin;
    input.dataset.bin = initialBin;
    check(initialBin);
  }
})();
