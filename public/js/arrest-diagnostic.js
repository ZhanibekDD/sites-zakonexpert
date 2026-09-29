(function () {
  'use strict';

  var root = document.querySelector('[data-arrest-diagnostic]');
  if (!root) return;

  var queryParams = new URLSearchParams(location.search);
  var requestedSource = queryParams.get('source') || '';
  var presetSource = ['notary', 'court', 'bailiff', 'state', 'unknown'].indexOf(requestedSource) >= 0
    ? requestedSource
    : '';
  var requestedEntry = queryParams.get('entry') || '';
  var entryPoint = ['bailiff_profile', 'notary_profile', 'bailiff_region', 'notary_region'].indexOf(requestedEntry) >= 0
    ? requestedEntry
    : 'direct';
  var answers = { symptom: '', source: presetSource, payment: '' };
  var currentStep = 1;
  var resultSummary = '';

  var labels = {
    symptom: {
      account: 'счёт или карта заблокированы',
      writeoff: 'деньги удержали или списали',
      paid: 'долг оплачен, но арест остался',
      restriction: 'запрет на выезд, авто или имущество',
      sms: 'пришло SMS 1414 или уведомление',
    },
    source: {
      notary: 'исполнительная надпись нотариуса',
      court: 'судебный акт или судебный приказ',
      bailiff: 'известно только постановление ЧСИ',
      state: 'штраф, налог, алименты или иной акт',
      unknown: 'документ-основание неизвестен',
    },
    payment: {
      none: 'пока ничего не оплачено',
      principal: 'основной долг оплачен полностью или частично',
      all: 'оплачено всё по расчёту ЧСИ',
      unknown: 'состав суммы непонятен',
    },
  };

  var sourceRoutes = {
    notary: {
      eyebrow: 'Вероятный путь: нотариус → ЧСИ → банк',
      title: 'Сначала проверить отмену исполнительной надписи',
      lead: 'Арест в этой ситуации обычно является последствием исполнительного документа. Работа только с банком не устранит основание взыскания.',
      priority: 'Получить копию надписи, подтверждение её направления и зафиксировать дату, когда вы фактически получили документ или узнали о нём.',
      steps: [
        'Получите исполнительную надпись, заявление взыскателя, расчёт и сведения о вручении копии.',
        'Проверьте бесспорность требования, платежи, срок и правильность уведомления.',
        'При наличии оснований выберите надлежащий способ отмены: возражение нотариусу либо судебное оспаривание с оценкой срока.',
        'После отмены добейтесь процессуального решения по исполнительному производству и отдельных постановлений об отмене мер.',
      ],
      docs: ['исполнительная надпись', 'доказательство её отправки и получения', 'договор, расчёт и история платежей', 'постановления ЧСИ'],
    },
    court: {
      eyebrow: 'Вероятный путь: суд → ЧСИ → банк',
      title: 'Определить вид судебного акта до оплаты',
      lead: 'Судебный приказ, заочное решение, упрощённое производство и обычное решение оспариваются по разным правилам. Номер дела важнее названия банка.',
      priority: 'Скачать полный судебный акт и установить дату, когда вы узнали о деле. Без этого нельзя правильно выбрать заявление и оценить срок.',
      steps: [
        'Получите судебный акт и материалы дела через Судебный кабинет или канцелярию суда.',
        'Проверьте вид акта, порядок извещения, расчёт долга и дату получения.',
        'Оцените допустимый способ: возражение, отмена, апелляция, восстановление срока или урегулирование.',
        'Если акт отменён или изменён, передайте процессуальный документ ЧСИ и проконтролируйте отмену каждой меры.',
      ],
      docs: ['полный судебный акт', 'номер дела и сведения об извещении', 'материалы дела и расчёт взыскателя', 'постановления ЧСИ и банковская выписка'],
    },
    bailiff: {
      eyebrow: 'Промежуточное звено найдено: ЧСИ',
      title: 'Найти документ, на основании которого ЧСИ открыл производство',
      lead: 'Постановление ЧСИ показывает принудительную стадию, но способ защиты определяется исполнительным документом: надписью, актом суда, штрафом или другим основанием.',
      priority: 'Запросить у ЧСИ постановление о возбуждении ИП, исполнительный документ, расчёт и перечень всех действующих мер.',
      steps: [
        'Установите номер исполнительного производства и контакты исполнителя в официальной АИС ОИП.',
        'Получите весь пакет: основание, постановления, расчёт, сведения о взыскателе и совершённых действиях.',
        'Проверьте возможность отмены или прекращения по документу-основанию до необратимой оплаты.',
        'Подайте письменное заявление по выбранному способу и получите отдельные решения по каждому аресту или запрету.',
      ],
      docs: ['постановление о возбуждении ИП', 'исполнительный документ', 'расчёт основного долга и оплаты ЧСИ', 'перечень арестов, запретов и удержаний'],
    },
    state: {
      eyebrow: 'Специальная категория взыскания',
      title: 'Проверить акт государственного органа и специальный порядок',
      lead: 'Штраф, налог, алименты и иные обязательства нельзя автоматически оспаривать как исполнительную надпись. Сначала определяется орган и специальная процедура.',
      priority: 'Получить первичный акт, дату его вступления в силу, расчёт задолженности и постановление ЧСИ. Не использовать шаблон возражения нотариусу.',
      steps: [
        'Установите орган, который вынес первичный акт, и получите его полную копию.',
        'Сверьте сумму, платежи, срок исполнения и порядок обжалования именно этой категории.',
        'Проверьте соразмерность и перечень мер ЧСИ отдельно от законности основного акта.',
        'Выберите специальный способ: обжалование акта, корректировка расчёта, рассрочка или исполнение с контролем снятия мер.',
      ],
      docs: ['первичный акт государственного органа', 'расчёт и история начислений', 'квитанции и подтверждения льгот при наличии', 'постановления ЧСИ'],
    },
    unknown: {
      eyebrow: 'Причина пока не установлена',
      title: 'Сначала определить инициатора и получить номер документа',
      lead: 'По одному сообщению банка или SMS нельзя понять, что отменять. Ограничение может исходить от ЧСИ, суда, КГД либо внутренней проверки банка.',
      priority: 'Запросить у банка инициатора, номер, дату и вид документа, затем проверить наличие исполнительного производства только через официальный сервис.',
      steps: [
        'Сохраните уведомление и запросите у банка письменные реквизиты ограничения.',
        'Самостоятельно откройте АИС ОИП или eGov, не переходя по подозрительной ссылке из сообщения.',
        'Получите копию документа у указанного ЧСИ, суда, органа или банка.',
        'После идентификации основания пройдите диагностику заново и выберите точный правовой способ.',
      ],
      docs: ['скрин уведомления без кодов и реквизитов карты', 'ответ банка с номером документа', 'выписка по счёту', 'документ из официального источника'],
    },
  };

  var symptomRoutes = {
    account: {
      step: 'Запросите у банка справку или сообщение с точным видом ограничения, инициатором, датой и номером постановления.',
      doc: 'справка банка о причине ограничения',
    },
    writeoff: {
      step: 'Скачайте выписку с датой, суммой, получателем и назначением списания; сохраните остаток до новых операций.',
      doc: 'банковская выписка с операцией списания',
    },
    paid: {
      step: 'Соберите квитанции и письменные подтверждения кредитора, чтобы исключить повторное взыскание уже оплаченной суммы.',
      doc: 'квитанции и справка кредитора об оплате',
    },
    restriction: {
      step: 'Получите отдельное постановление по каждому ограничению: выезд, регистрационные действия, авто или недвижимость.',
      doc: 'постановления по каждому запрету или аресту',
    },
    sms: {
      step: 'Не вводите данные по ссылке из SMS. Откройте eGov или АИС ОИП самостоятельно и сверьте номер документа.',
      doc: 'текст уведомления и результат проверки в официальном сервисе',
    },
  };

  var paymentRoutes = {
    none: {
      step: 'До платежа зафиксируйте результат проверки: есть ли основания для отмены документа или прекращения производства и как повлияет оплата на расходы ЧСИ.',
      warning: 'Не оплачивайте требование только ради быстрой разблокировки. Сначала проверьте документ-основание и возможность его отмены или прекращения ИП. Если таких оснований нет, долг исполняется законным способом по проверенному расчёту.',
    },
    principal: {
      step: 'Направьте ЧСИ и взыскателю подтверждения оплаты с требованием зачесть каждый платёж и выдать обновлённый письменный расчёт.',
      warning: 'Оплата основного долга не всегда автоматически прекращает производство. Возможны отдельный расчёт оплаты деятельности ЧСИ и необходимость процессуального решения о снятии мер. Не платите одну сумму повторно.',
    },
    all: {
      step: 'Письменно запросите постановление об окончании или прекращении ИП и отдельные постановления об отмене всех мер обеспечения.',
      warning: 'Квитанция сама по себе может не разблокировать счёт. Банку нужен надлежащий документ инициатора меры. Проверьте, что отменены все аресты и запреты, а не только один из них.',
    },
    unknown: {
      step: 'Запросите расчёт с отдельными строками: основной долг, проценты, пеня, расходы и оплата деятельности ЧСИ.',
      warning: 'Не переводите сумму по устному сообщению или неизвестным реквизитам. Сверьте письменный расчёт, получателя и назначение платежа, затем сохраните квитанцию.',
    },
  };

  var questions = Array.prototype.slice.call(root.querySelectorAll('[data-question]'));
  var result = root.querySelector('[data-result]');
  var progressBar = root.querySelector('[data-progress-bar]');
  var progressLabel = root.querySelector('[data-progress-label]');
  var progressPercent = root.querySelector('[data-progress-percent]');
  var progressSteps = Array.prototype.slice.call(root.querySelectorAll('[data-progress-step]'));
  var mobileBar = document.querySelector('[data-mobile-bar]');

  function track(type, target, extra) {
    if (typeof window.ZE_trackEvent === 'function') {
      window.ZE_trackEvent(type, target, extra || {});
    }
  }

  function unique(items) {
    return items.filter(function (item, index) { return items.indexOf(item) === index; });
  }

  function fillList(element, items, ordered) {
    element.innerHTML = '';
    items.forEach(function (item) {
      var row = document.createElement('li');
      row.textContent = item;
      element.appendChild(row);
    });
    if (ordered) element.setAttribute('aria-label', 'Порядок действий');
  }

  function updateProgress(step) {
    var visibleStep = Math.min(step, 3);
    var percent = Math.round((visibleStep / 3) * 100);
    progressBar.style.width = percent + '%';
    progressLabel.textContent = step > 3 ? 'Диагностика завершена' : 'Вопрос ' + visibleStep + ' из 3';
    progressPercent.textContent = step > 3 ? '100%' : percent + '%';
    progressSteps.forEach(function (item, index) {
      item.classList.toggle('is-active', step <= 3 && index === visibleStep - 1);
      item.classList.toggle('is-complete', step > 3 || index < visibleStep - 1);
    });
  }

  function showStep(step) {
    currentStep = step;
    questions.forEach(function (question) {
      var active = Number(question.getAttribute('data-question')) === step;
      question.hidden = !active;
      question.classList.toggle('is-active', active);
    });
    result.hidden = true;
    updateProgress(step);
    var heading = root.querySelector('[data-question="' + step + '"] h2');
    if (heading) heading.focus({ preventScroll: true });
  }

  function buildResult() {
    var source = sourceRoutes[answers.source];
    var symptom = symptomRoutes[answers.symptom];
    var payment = paymentRoutes[answers.payment];
    var steps = unique([symptom.step].concat(source.steps, [payment.step]));
    var docs = unique(source.docs.concat([symptom.doc]));

    root.querySelector('[data-result-eyebrow]').textContent = source.eyebrow;
    root.querySelector('[data-result-title]').textContent = source.title;
    root.querySelector('[data-result-lead]').textContent = source.lead;
    root.querySelector('[data-result-priority]').textContent = source.priority;
    root.querySelector('[data-result-warning]').textContent = payment.warning;
    fillList(root.querySelector('[data-result-steps]'), steps, true);
    fillList(root.querySelector('[data-result-docs]'), docs, false);

    resultSummary = [
      'Диагностика ареста — ZakonExpert',
      'Ситуация: ' + labels.symptom[answers.symptom] + '.',
      'Основание: ' + labels.source[answers.source] + '.',
      'Оплата: ' + labels.payment[answers.payment] + '.',
      'Первый приоритет: ' + source.priority,
      'Маршрут:',
    ].concat(steps.map(function (step, index) {
      return (index + 1) + '. ' + step;
    })).join('\n');

    var whatsappMessage = resultSummary + '\n\nПрошу проверить документы и определить, можно ли сначала отменить документ-основание и прекратить исполнительное производство до оплаты. Понимаю, что результат зависит от документов. Готов(а) начать работу по договору с предоплатой 50% после согласования объёма.';
    root.querySelector('[data-result-whatsapp]').href = 'https://wa.me/77003097566?text=' + encodeURIComponent(whatsappMessage);

    questions.forEach(function (question) {
      question.hidden = true;
      question.classList.remove('is-active');
    });
    result.hidden = false;
    currentStep = 4;
    updateProgress(4);
    if (mobileBar) mobileBar.classList.add('is-hidden');
    result.scrollIntoView({ behavior: 'smooth', block: 'start' });
    track('arrest_diagnostic_completed', answers.source + ':' + answers.symptom, {
      cta: entryPoint,
      service_type: 'arrest_diagnostic',
      document_type: answers.source,
      source_entity_type: presetSource === 'bailiff' || presetSource === 'notary' ? presetSource : '',
    });
  }

  root.addEventListener('click', function (event) {
    var option = event.target.closest('[data-answer]');
    if (option) {
      var key = option.getAttribute('data-answer');
      var value = option.getAttribute('data-value');
      answers[key] = value;
      track(currentStep === 1 ? 'arrest_diagnostic_started' : 'arrest_diagnostic_step', key + ':' + value, {
        cta: entryPoint,
        service_type: 'arrest_diagnostic',
        document_type: key === 'source' ? value : '',
        source_entity_type: presetSource === 'bailiff' || presetSource === 'notary' ? presetSource : '',
      });
      if (currentStep === 1 && presetSource && answers.source === presetSource) showStep(3);
      else if (currentStep < 3) showStep(currentStep + 1);
      else buildResult();
      return;
    }

    if (event.target.closest('[data-back]')) {
      showStep(Math.max(1, currentStep - 1));
      return;
    }

    if (event.target.closest('[data-reset]')) {
      answers = { symptom: '', source: presetSource, payment: '' };
      resultSummary = '';
      if (mobileBar) mobileBar.classList.remove('is-hidden');
      showStep(1);
      root.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }

    var copyButton = event.target.closest('[data-copy-result]');
    if (copyButton && resultSummary) {
      var original = copyButton.innerHTML;
      var done = function () {
        copyButton.innerHTML = '<i class="bi bi-check2" aria-hidden="true"></i> Результат скопирован';
        track('arrest_diagnostic_copy', answers.source + ':' + answers.symptom, {
          cta: entryPoint,
          service_type: 'arrest_diagnostic',
          document_type: answers.source,
        });
        setTimeout(function () { copyButton.innerHTML = original; }, 1800);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(resultSummary).then(done).catch(done);
      } else {
        var field = document.createElement('textarea');
        field.value = resultSummary;
        field.setAttribute('readonly', '');
        field.style.position = 'fixed';
        field.style.opacity = '0';
        document.body.appendChild(field);
        field.select();
        try { document.execCommand('copy'); } catch (error) { /* noop */ }
        document.body.removeChild(field);
        done();
      }
    }
  });

  root.querySelector('[data-result-whatsapp]').addEventListener('click', function () {
    track('arrest_diagnostic_whatsapp', answers.source + ':' + answers.symptom, {
      cta: entryPoint,
      service_type: 'arrest_diagnostic',
      document_type: answers.source,
      source_entity_type: presetSource === 'bailiff' || presetSource === 'notary' ? presetSource : '',
    });
  });

  updateProgress(1);
})();
