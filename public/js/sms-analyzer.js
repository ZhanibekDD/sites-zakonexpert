/* ZakonExpert — private, browser-only SMS 1414 route analyzer. */
(function (root, factory) {
  'use strict';

  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ZESmsAnalyzer = api;
}(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  var ROUTES = {
    notary_enforcement: {
      eyebrow: 'Исполнительная надпись уже у ЧСИ',
      title: 'Нужно проверить и нотариуса, и исполнительное производство',
      summary: 'По тексту похоже, что нотариальная исполнительная надпись уже передана судебному исполнителю. Не делайте вывод только по SMS: сначала получите документ-основание и постановление ЧСИ.',
      steps: [
        'Откройте карточку производства и сохраните номер, ФИО ЧСИ и сумму требований.',
        'Запросите копию исполнительной надписи и выясните, когда и как она была направлена вам.',
        'Проверьте основания для возражения нотариусу или обращения в суд, затем отдельно решайте вопрос с производством и ограничениями.',
      ],
      links: [
        { href: '/notaries', label: 'Найти нотариуса', icon: 'bi-book' },
        { href: '/bailiffs', label: 'Найти ЧСИ', icon: 'bi-person-badge' },
        { href: '/diagnostika-aresta?source=notary&entry=sms_1414', label: 'Пройти диагностику', icon: 'bi-signpost-split' },
      ],
      whatsapp: 'Здравствуйте! Получил(а) SMS с 1414. В сообщении указаны исполнительная надпись и исполнительное производство. Прошу проверить документ-основание и порядок действий до оплаты.',
    },
    notary: {
      eyebrow: 'Уведомление нотариуса',
      title: 'Похоже на исполнительную надпись нотариуса',
      summary: 'Для возражения важны сама копия надписи и подтверждённая дата её получения. Закон предусматривает десять рабочих дней для направления возражения со дня получения копии, но применимость срока нужно проверять по документам.',
      steps: [
        'Сохраните SMS и зафиксируйте дату получения, но не публикуйте ИИН и коды доступа.',
        'Получите копию исполнительной надписи и найдите нотариуса в актуальном реестре.',
        'Проверьте сумму, кредитора, уведомление и другие основания для возражения; при наличии оснований действуйте без промедления.',
      ],
      links: [
        { href: '/notaries', label: 'Найти нотариуса', icon: 'bi-book' },
        { href: '/vozrazhenie-na-ispolnitelnuyu-nadpis', label: 'Как подать возражение', icon: 'bi-file-earmark-text' },
        { href: '/dokumenty', label: 'Образцы документов', icon: 'bi-download' },
      ],
      whatsapp: 'Здравствуйте! Получил(а) уведомление с 1414 об исполнительной надписи нотариуса. Прошу проверить надпись, дату уведомления и возможные основания для возражения до оплаты.',
    },
    travel: {
      eyebrow: 'Ограничение на выезд',
      title: 'Похоже на уведомление об ограничении на выезд',
      summary: 'Ограничение связано с конкретным исполнительным производством. Сначала установите ЧСИ и документ-основание: способ снятия зависит не от текста SMS, а от постановлений и статуса производства.',
      steps: [
        'Проверьте наличие производства и сохраните его номер.',
        'Получите постановление об ограничении и исполнительный документ, на котором оно основано.',
        'Проверьте основания для отмены документа, прекращения производства либо другой законный способ урегулирования.',
      ],
      links: [
        { href: '/zapret-na-vyezd-iz-kazahstana', label: 'Порядок снятия запрета', icon: 'bi-airplane' },
        { href: '/bailiffs', label: 'Найти ЧСИ', icon: 'bi-person-badge' },
        { href: '/diagnostika-aresta?source=bailiff&entry=sms_1414', label: 'Разобрать ситуацию', icon: 'bi-signpost-split' },
      ],
      whatsapp: 'Здравствуйте! Получил(а) SMS с 1414 об ограничении на выезд. Прошу проверить производство, постановление и возможный порядок снятия ограничения.',
    },
    court: {
      eyebrow: 'Судебный документ',
      title: 'Похоже, основанием является акт суда',
      summary: 'Исполнительный лист, судебный приказ и решение суда оспариваются по разным правилам. Нужны точное название акта, суд, дата и номер дела — одного SMS для выбора процедуры недостаточно.',
      steps: [
        'Получите у ЧСИ копию исполнительного документа и постановление о возбуждении производства.',
        'Найдите судебный акт и проверьте дату его получения или дату, когда вы узнали о нём.',
        'Определите процедуру: отмена приказа, обжалование решения, восстановление срока либо работа с исполнением.',
      ],
      links: [
        { href: '/nadpis-ili-list', label: 'Надпись или судебный лист', icon: 'bi-intersect' },
        { href: '/bailiffs', label: 'Найти ЧСИ', icon: 'bi-person-badge' },
        { href: '/diagnostika-aresta?source=court&entry=sms_1414', label: 'Пройти диагностику', icon: 'bi-signpost-split' },
      ],
      whatsapp: 'Здравствуйте! Получил(а) SMS с 1414. Похоже, производство основано на судебном документе. Прошу определить вид акта и возможный порядок действий до оплаты.',
    },
    enforcement: {
      eyebrow: 'Исполнительное производство',
      title: 'Похоже, ЧСИ возбудил исполнительное производство',
      summary: 'Обеспечительные меры могут приниматься одновременно с возбуждением производства. Поэтому сразу проверьте не только сумму долга, но и документ-основание, постановления ЧСИ и уже установленные ограничения.',
      steps: [
        'Проверьте производство по ИИН и сохраните номер, сумму, ФИО и контакты ЧСИ.',
        'Запросите постановление о возбуждении и копию исполнительного документа.',
        'До оплаты проверьте основание взыскания и расчёт оплаты деятельности ЧСИ; после возбуждения производства платежи взыскателю нужно проводить с обязательным извещением ЧСИ.',
      ],
      links: [
        { href: '/#checker-section', label: 'Проверить по ИИН', icon: 'bi-search' },
        { href: '/bailiffs', label: 'Найти ЧСИ', icon: 'bi-person-badge' },
        { href: '/diagnostika-aresta?source=bailiff&entry=sms_1414', label: 'Пройти диагностику', icon: 'bi-signpost-split' },
      ],
      whatsapp: 'Здравствуйте! Получил(а) SMS с 1414 о возбуждении исполнительного производства. Прошу проверить документ-основание, постановления ЧСИ и расчёт требований до оплаты.',
    },
    unknown: {
      eyebrow: 'Нужна ручная проверка',
      title: 'По этому тексту нельзя надёжно определить вид документа',
      summary: 'Сообщение может относиться к другой государственной услуге или в нём недостаточно признаков. Не переходите по подозрительным ссылкам и не сообщайте SMS-коды. Проверьте уведомление в официальных сервисах.',
      steps: [
        'Проверьте отправителя и не вводите коды или банковские данные по ссылкам из сообщения.',
        'Откройте eGov или официальный реестр исполнительных производств самостоятельно, не через ссылку из SMS.',
        'Если в официальном сервисе есть производство, получите постановление и документ-основание.',
      ],
      links: [
        { href: '/#checker-section', label: 'Проверить по ИИН', icon: 'bi-search' },
        { href: 'https://aisoip.adilet.gov.kz', label: 'Официальный АИС ОИП', icon: 'bi-box-arrow-up-right', external: true },
        { href: '/contact', label: 'Контакты ZakonExpert', icon: 'bi-chat-dots' },
      ],
      whatsapp: 'Здравствуйте! Получил(а) непонятное SMS с 1414. Прошу помочь определить, связано ли оно с исполнительным производством и какие документы нужно проверить.',
    },
  };

  function normalize(value) {
    return String(value || '')
      .toLocaleLowerCase('ru-RU')
      .replace(/[ё]/g, 'е')
      .replace(/[^a-zа-я0-9\s-]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function classifySms(value) {
    var text = normalize(value);
    if (text.length < 8) return { id: 'empty', route: null };

    var hasNotary = /исполнительн[а-я]*\s+надпис|нотариус|енис/.test(text);
    var hasEnforcement = /исполнительн[а-я]*\s+производств|\bчси\b|судебн[а-я]*\s+исполнител|аис\s*оип|aisoip/.test(text);
    var hasTravel = /ограничен[а-я]*\s+(?:на\s+)?выезд|запрет[а-я]*\s+(?:на\s+)?выезд|пересечен[а-я]*\s+границ/.test(text);
    var hasArrest = /\bарест[а-я]*|заблокирован[а-я]*|инкассов[а-я]*|приостановлен[а-я]*\s+расход/.test(text);
    var hasCourt = /исполнительн[а-я]*\s+лист|судебн[а-я]*\s+(?:приказ|решен|акт)|\bсуд[а-я]*\s+акт/.test(text);
    var id = 'unknown';

    if (hasNotary && (hasEnforcement || hasArrest)) id = 'notary_enforcement';
    else if (hasNotary) id = 'notary';
    else if (hasTravel) id = 'travel';
    else if (hasCourt) id = 'court';
    else if (hasEnforcement || hasArrest) id = 'enforcement';

    return { id: id, route: ROUTES[id] };
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, function (character) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character];
    });
  }

  function routeHtml(id, route) {
    var links = route.links.map(function (link) {
      var external = link.external ? ' target="_blank" rel="noopener"' : '';
      return '<a class="sms-result-link" href="' + escapeHtml(link.href) + '"' + external + '>'
        + '<i class="bi ' + escapeHtml(link.icon) + '" aria-hidden="true"></i>'
        + '<span>' + escapeHtml(link.label) + '</span></a>';
    }).join('');
    var steps = route.steps.map(function (step, index) {
      return '<li><span>' + (index + 1) + '</span><p>' + escapeHtml(step) + '</p></li>';
    }).join('');
    var whatsappUrl = 'https://wa.me/77003097566?text=' + encodeURIComponent(route.whatsapp);

    return '<div class="sms-result-head"><span class="sms-result-eyebrow">' + escapeHtml(route.eyebrow) + '</span>'
      + '<h3>' + escapeHtml(route.title) + '</h3><p>' + escapeHtml(route.summary) + '</p></div>'
      + '<ol class="sms-result-steps">' + steps + '</ol>'
      + '<div class="sms-result-links">' + links + '</div>'
      + '<a class="sms-result-whatsapp" href="' + whatsappUrl + '" target="_blank" rel="noopener"'
      + ' data-product-event="click_cta_legal_intent" data-event-target="sms-1414-analyzer"'
      + ' data-event-cta="analyzer_result" data-service-type="sms_1414" data-document-type="' + escapeHtml(id) + '">'
      + '<i class="bi bi-whatsapp" aria-hidden="true"></i> Отправить специалисту только тип уведомления</a>';
  }

  function init() {
    if (typeof document === 'undefined') return;
    var container = document.querySelector('[data-sms-analyzer]');
    if (!container) return;

    var form = container.querySelector('[data-sms-form]');
    var input = container.querySelector('[data-sms-input]');
    var counter = container.querySelector('[data-sms-counter]');
    var result = container.querySelector('[data-sms-result]');
    var clearButton = container.querySelector('[data-sms-clear]');

    function updateCounter() {
      counter.textContent = String(input.value.length) + ' / 2000';
    }

    container.addEventListener('click', function (event) {
      var example = event.target.closest('[data-sms-example]');
      if (!example) return;
      input.value = example.getAttribute('data-sms-example') || '';
      updateCounter();
      input.focus();
    });

    input.addEventListener('input', updateCounter);
    clearButton.addEventListener('click', function () {
      input.value = '';
      result.hidden = true;
      result.innerHTML = '';
      updateCounter();
      input.focus();
    });

    form.addEventListener('submit', function (event) {
      event.preventDefault();
      var match = classifySms(input.value);
      if (!match.route) {
        result.hidden = false;
        result.innerHTML = '<p class="sms-result-empty"><i class="bi bi-info-circle" aria-hidden="true"></i> Вставьте хотя бы часть сообщения — без ИИН, кодов и банковских данных.</p>';
        result.focus();
        return;
      }

      result.hidden = false;
      result.setAttribute('data-route', match.id);
      result.innerHTML = routeHtml(match.id, match.route);
      result.focus();
      if (typeof window !== 'undefined' && typeof window.ZE_trackEvent === 'function') {
        window.ZE_trackEvent('calculator_completed', 'sms-1414-analyzer', {
          page_type: 'sms_analyzer',
          service_type: 'sms_1414',
          document_type: match.id,
        });
      }
    });

    updateCounter();
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
  }

  return {
    classifySms: classifySms,
    normalize: normalize,
    routes: ROUTES,
  };
}));
