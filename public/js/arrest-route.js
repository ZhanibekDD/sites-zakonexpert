(function () {
  'use strict';

  var root = document.querySelector('[data-arrest-diagnostic]');
  if (!root) return;

  var routes = {
    chsi: {
      icon: 'bi-person-badge',
      title: 'Запросить материалы исполнительного производства',
      copy: 'Нужно проверить постановление, исполнительный документ, расчёт и основания для отмены меры, жалобы либо прекращения производства.',
      docs: 'постановление ЧСИ, номер ИП и расчёт задолженности',
      message: 'Есть постановление ЧСИ и арест счёта. Хочу проверить материалы до оплаты.',
    },
    notary: {
      icon: 'bi-pen',
      title: 'Проверить исполнительную надпись и уведомление',
      copy: 'Исполнительная надпись может быть основанием взыскания, но сам арест обычно оформляется постановлением исполнителя. Проверяются оба документа.',
      docs: 'надпись нотариуса, уведомление и постановление ЧСИ',
      message: 'Основание ареста — исполнительная надпись. Хочу проверить возможность оспаривания до оплаты.',
    },
    court: {
      icon: 'bi-bank2',
      title: 'Получить судебный акт и исполнительный документ',
      copy: 'Через нотариуса судебный акт не отменяется. Нужен процессуальный анализ решения, приказа или листа и отдельная проверка действий ЧСИ.',
      docs: 'судебный акт, сведения о вручении и постановление ЧСИ',
      message: 'Арест основан на судебном акте. Хочу понять законный порядок снятия.',
    },
    unknown: {
      icon: 'bi-compass',
      title: 'Получить реквизиты ограничения',
      copy: 'Запросите у банка инициатора, номер и дату документа, затем проверьте исполнительные производства по ИИН.',
      docs: 'скриншот ограничения и ответ банка',
      message: 'Не знаю причину ареста счёта. Хочу установить основание и проверить документы.',
    },
  };

  var buttons = Array.prototype.slice.call(root.querySelectorAll('[data-arrest-route]'));
  var title = root.querySelector('[data-route-title]');
  var copy = root.querySelector('[data-route-copy]');
  var docs = root.querySelector('[data-route-docs]');
  var icon = root.querySelector('[data-route-icon]');
  var whatsapp = root.querySelector('[data-route-whatsapp]');

  function applyRoute(routeName, trackChoice) {
    var route = routes[routeName] || routes.unknown;

    buttons.forEach(function (button) {
      button.setAttribute('aria-pressed', String(button.getAttribute('data-arrest-route') === routeName));
    });

    title.textContent = route.title;
    copy.textContent = route.copy;
    docs.textContent = route.docs;
    icon.className = 'bi ' + route.icon;
    whatsapp.href = 'https://wa.me/77479957635?text=' + encodeURIComponent(route.message);

    if (trackChoice && typeof window.ZE_trackEvent === 'function') {
      window.ZE_trackEvent('arrest_route_selected', routeName, {
        page_type: 'arrest_pillar',
        service_type: 'account_arrest',
      });
    }
  }

  buttons.forEach(function (button) {
    button.addEventListener('click', function () {
      applyRoute(button.getAttribute('data-arrest-route'), true);
    });
  });

  applyRoute('unknown', false);
}());
