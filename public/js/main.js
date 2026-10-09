/**
 * Скрипт для проверки данных должников и арестов по ИИН
 */
document.addEventListener('DOMContentLoaded', function() {
    // Проверка загрузки Bootstrap
    ensureBootstrapLoaded();
    
    // DOM элементы
    const searchForm = document.getElementById('search-form');
    const iinInput = document.getElementById('iin');
    const iinConsent = document.getElementById('iin-consent');
    const iinValidation = document.getElementById('iin-validation');
    const searchButton = document.getElementById('search-button');
    const loadingContainer = document.getElementById('loading-container');
    const loadingMessage = document.querySelector('#loading-container .loading-message');
    const progressBar = document.querySelector('#loading-container .progress-bar');
    const results = document.getElementById('results');
    const errorMessage = document.getElementById('error-message');
    const errorText = document.getElementById('error-text');
    const debtorDetailsModal = document.getElementById('debtorDetailsModal');
    const debtorDetailsContent = document.getElementById('debtorDetailsContent');
    const testDataButton = document.getElementById('test-data-button');
    const debtorsTable = document.getElementById('debtors-table');
    const restrictionsTable = document.getElementById('restrictions-table');

    const isKz = document.documentElement.lang && document.documentElement.lang.startsWith('kk');
    // Russian plural forms: 1 производство, 2 производства, 5 производств.
    function plural(n, one, few, many) {
        const mod10 = n % 10, mod100 = n % 100;
        if (mod10 === 1 && mod100 !== 11) return one;
        if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
        return many;
    }
    // Numbers and dates use the Russian pattern on both languages (565 350,00 ₸, 27.09.2026):
    // some browsers have no kk-KZ data and fall back to US formats (565,350.00, 09/27/2026).
    const locale = 'ru-RU';
    const baseLabels = {
        debtorNum: 'Номер ИП',
        date: 'Дата',
        amount: 'Сумма взыскания',
        creditor: 'Взыскатель',
        organ: 'Орган',
        executor: 'Исполнитель',
        status: 'Рекомендация',
        action: 'Действие',
        restrictionType: 'Тип ограничения'
    };
    const baseText = {
        iinInvalid: 'ИИН должен содержать 12 цифр',
        loadingCheck: 'Проверка данных в реестре должников...',
        invalidFormat: 'Некорректный формат или отсутствуют данные',
        genericErrorShort: 'Произошла ошибка при проверке данных. Пожалуйста, попробуйте позже.',
        genericErrorLong: 'Не удалось получить данные. Проверьте ИИН и попробуйте позже. Если ошибка повторяется — напишите нам в WhatsApp.',
        serverError: 'Ошибка сервера',
        serverCheckError: 'Ошибка сервера при проверке',
        apiNoData: 'Не удалось получить данные из API',
        statusAnalysis: 'Требуется правовой анализ',
        statusReview: 'Нужна проверка оснований',
        statusDocs: 'Нужна проверка документов',
        statusSettle: 'Возможны варианты урегулирования',
        btnResolve: 'Разобрать',
        details: 'Подробнее',
        yes: 'Да',
        no: 'Нет',
        complete: 'Загрузка завершена!',
        loading: 'Загрузка...',
        loadingRegistry: 'Проверка данных в реестрах',
        interfaceError: 'Ошибка интерфейса: не удалось отобразить результаты.',
        tableNotFound: 'Не найдены элементы таблиц или секций.',
        noDetails: 'Подробные детали для этого производства отсутствуют.',
        detailsLoadError: 'Ошибка: Не удалось загрузить детали.',
        waPrefix: 'Здравствуйте! Прошу разобрать ситуацию по исполнительному производству.',
        errorLabel: 'Ошибка:',
        waWrite: 'Написать в WhatsApp',
        helpMany: 'Нужна помощь по этим производствам?',
        helpOne: 'Нужна помощь по этому производству?',
        helpText: 'Напишите в WhatsApp — разберём каждое производство и объясним ваши права бесплатно',
        noArrestsTitle: 'Исполнительных производств не найдено',
        noArrestsText: 'По этому ИИН в реестре должников нет открытых производств у судебных исполнителей.',
        noArrestsNote: 'Если у вас непонятная ситуация — напишите нам, разберёмся бесплатно.',
        waNoArrest: 'Здравствуйте! Проверил(а) по ИИН — арестов не найдено, но у меня есть вопрос по задолженности.',
        chsiFee: 'Услуга ЧСИ',
        chsiFeeLink: '— убрать проценты ЧСИ →',
        resKicker: 'Результат проверки по ИИН',
        resTitle: (n) => `Найдено ${n} ${plural(n, 'исполнительное производство', 'исполнительных производства', 'исполнительных производств')}`,
        resTotal: 'Сумма к взысканию',
        resTotalNote: '+ оплата деятельности ЧСИ и расходы — их часто можно уменьшить',
        resActive: 'Активных',
        resBanStat: 'От 40 МРП',
        resNewStat: 'Новых за 30 дней',
        resBanTitle: 'Возможен запрет на выезд',
        resBanText: (n, threshold) => `По ${n} ${plural(n, 'производству', 'производствам', 'производствам')} сумма от 40 МРП (${threshold}). По закону исполнитель обязан ограничить выезд — проверьте статус перед поездкой.`,
        resAlimonyText: 'Алименты: при долге больше трёх месяцев выезд ограничивают.',
        resBanLink: 'Проверить статус в реестре Минюста',
        resWaAll: 'Разобрать все производства в WhatsApp',
        resWaNote: 'Отправим список специалисту — первичный разбор бесплатно, ответ в течение 10 минут.',
        resToCollect: 'к взысканию',
        resChipActive: 'Активно',
        resChipClosed: 'Окончено',
        resChipBan: 'от 40 МРП · возможен запрет на выезд',
        resChipNew: (d) => d === 0 ? 'Новое · сегодня' : `Новое · ${d} ${plural(d, 'день', 'дня', 'дней')} назад`,
        resCaseNo: 'Номер производства',
        resStarted: 'Возбуждено',
        resIssuer: 'Кто выдал документ',
        resExecutor: 'Исполнитель',
        resOffice: 'Исполнительный округ',
        resAddress: 'Адрес исполнителя',
        resCopy: 'Копировать',
        resCopied: 'Скопировано',
        resFeeLink: 'Уменьшить оплату ЧСИ',
        resFindExecutor: 'Контакты исполнителя',
        resMap: 'Адрес в 2ГИС',
        resWaOne: 'Разобрать в WhatsApp',
        resEmptyWhy: 'Если счёт всё равно заблокирован, арест мог наложить не ЧСИ, а налоговый орган или следствие — таких арестов нет в реестре исполнительных производств.',
        resEmptyBan: 'Запрет на выезд проверяйте в реестре Минюста',
        resSource: 'Источник: реестр должников АИС ОИП Министерства юстиции через data.egov.kz, данные на момент проверки.',
        resBasisLabels: { notary: 'Исполнительная надпись нотариуса', court: 'Решение суда', alimony: 'Алименты', fine: 'Штраф', other: 'Исполнительный документ' },
        resNext: { notary: 'Можно ли отменить надпись', court: 'Как обжаловать решение суда', alimony: 'Алименты и аресты', fine: 'Штраф у ЧСИ: что делать', other: 'Как снять арест' }
    };
    const kzText = {
        iinInvalid: 'ЖСН 12 саннан тұруы керек',
        loadingCheck: 'Борышкерлер тізіліміндегі деректер тексерілуде...',
        invalidFormat: 'Қате формат немесе деректер жоқ',
        genericErrorShort: 'Тексеру кезінде қате орын алды. Қайталап көріңіз.',
        genericErrorLong: 'Деректерді алу кезінде қате орын алды. ЖСН-ды тексеріп, кейінірек қайталап көріңіз. Қате қайталанса — WhatsApp арқылы жазыңыз.',
        serverError: 'Сервер қатесі',
        serverCheckError: 'Тексеру кезінде сервер қатесі',
        apiNoData: 'API жауабынан деректерді алу мүмкін болмады',
        statusAnalysis: 'Құқықтық талдау қажет',
        statusReview: 'Негіздерді тексеру қажет',
        statusDocs: 'Құжаттарды тексеру қажет',
        statusSettle: 'Реттеу нұсқалары мүмкін',
        btnResolve: 'Талдау',
        details: 'Толығырақ',
        yes: 'Бар',
        no: 'Жоқ',
        complete: 'Жүктеу аяқталды!',
        loading: 'Жүктеу...',
        loadingRegistry: 'Тізілімдердегі деректер тексерілуде',
        interfaceError: 'Интерфейс қатесі: нәтижелерді көрсету мүмкін болмады.',
        tableNotFound: 'Нәтижелерді көрсету үшін элементтер табылмады.',
        noDetails: 'Бұл өндіріс бойынша толық деректер жоқ.',
        detailsLoadError: 'Қате: толық мәліметтерді жүктеу мүмкін болмады.',
        waPrefix: 'Сәлеметсіз бе! Атқарушылық өндіріс бойынша жағдайды талдауды сұраймын.',
        errorLabel: 'Қате:',
        waWrite: 'WhatsApp-қа жазу',
        helpMany: 'Осы іс жүргізулер бойынша көмек керек пе?',
        helpOne: 'Осы іс жүргізу бойынша көмек керек пе?',
        helpText: 'WhatsApp-қа жазыңыз — әр іс жүргізуді талдап, құқықтарыңызды тегін түсіндіреміз',
        noArrestsTitle: 'Атқарушылық іс жүргізу табылмады',
        noArrestsText: 'Бұл ЖСН бойынша борышкерлер тізілімінде сот орындаушыларында ашық іс жүргізу жоқ.',
        noArrestsNote: 'Жағдай түсініксіз болса — бізге жазыңыз, тегін талдаймыз.',
        waNoArrest: 'Сәлеметсіз бе! ЖСН бойынша тексердім — арест табылмады, бірақ қарыз бойынша сұрағым бар.',
        chsiFee: 'ЖСО қызметі',
        chsiFeeLink: '— ЖСО пайыздарын алып тастау →',
        resKicker: 'ЖСН бойынша тексеру нәтижесі',
        resTitle: (n) => `${n} атқарушылық іс жүргізу табылды`,
        resTotal: 'Өндірілетін сома',
        resTotalNote: '+ ЖСО қызметіне ақы және шығыстар — оларды жиі азайтуға болады',
        resActive: 'Белсенді',
        resBanStat: '40 АЕК-тен',
        resNewStat: 'Соңғы 30 күнде',
        resBanTitle: 'Шетелге шығуға тыйым салынуы мүмкін',
        resBanText: (n, threshold) => `${n} іс жүргізу бойынша сома 40 АЕК-тен асады (${threshold}). Заң бойынша орындаушы шетелге шығуды шектеуге міндетті — сапар алдында мәртебені тексеріңіз.`,
        resAlimonyText: 'Алимент: 3 айдан артық қарыз болса, шетелге шығу шектеледі.',
        resBanLink: 'Әділет министрлігінің тізілімінде тексеру',
        resWaAll: 'Барлық іс жүргізуді WhatsApp-та талдау',
        resWaNote: 'Тізімді маманға жібереміз — алғашқы талдау тегін, жауап 10 минут ішінде.',
        resToCollect: 'өндіріледі',
        resChipActive: 'Белсенді',
        resChipClosed: 'Аяқталған',
        resChipBan: '40 АЕК-тен · шетелге шығуға тыйым мүмкін',
        resChipNew: (d) => d === 0 ? 'Жаңа · бүгін' : `Жаңа · ${d} күн бұрын`,
        resCaseNo: 'Іс жүргізу нөмірі',
        resStarted: 'Қозғалған күні',
        resIssuer: 'Құжатты берген',
        resExecutor: 'Орындаушы',
        resOffice: 'Атқару округі',
        resAddress: 'Орындаушының мекенжайы',
        resCopy: 'Көшіру',
        resCopied: 'Көшірілді',
        resFeeLink: 'ЖСО ақысын азайту',
        resFindExecutor: 'Орындаушының байланысы',
        resMap: '2ГИС-тегі мекенжай',
        resWaOne: 'WhatsApp-та талдау',
        resEmptyWhy: 'Шот бәрібір бұғатталса, арестті ЖСО емес, салық органы немесе тергеу салуы мүмкін — мұндай арестер атқарушылық іс жүргізу тізілімінде жоқ.',
        resEmptyBan: 'Шетелге шығуға тыйымды Әділет министрлігінің тізілімінен тексеріңіз',
        resSource: 'Дереккөз: Әділет министрлігінің АІЖ АЖ борышкерлер тізілімі (data.egov.kz), тексеру сәтіндегі деректер.',
        resBasisLabels: { notary: 'Нотариустың атқарушылық жазбасы', court: 'Сот шешімі', alimony: 'Алимент', fine: 'Айыппұл', other: 'Атқарушылық құжат' },
        resNext: { notary: 'Жазбаны жоюға бола ма', court: 'Сот шешіміне шағым', alimony: 'Алимент және арест', fine: 'ЖСО-дағы айыппұл', other: 'Арестті қалай алу' }
    };
    const kzLabels = {
        debtorNum: 'АІЖ нөмірі',
        date: 'Күні',
        amount: 'Өндіру сомасы',
        creditor: 'Өндіріп алушы',
        organ: 'Орган',
        executor: 'Орындаушы',
        status: 'Ұсыным',
        action: 'Іс-әрекет',
        restrictionType: 'Шектеу түрі'
    };
    const T = {
        ...(isKz ? kzText : baseText),
        labels: isKz ? kzLabels : baseLabels
    };

    // Registry (eGov) values are untrusted text: escape them before they reach innerHTML.
    function escapeHtml(value) {
        return String(value == null ? '' : value).replace(/[&<>"']/g, (c) => (
            { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
        ));
    }


    // Вспомогательная функция для ограничения времени выполнения промиса
    function promiseWithTimeout(promise, timeoutMs) {
        let timeoutId;
        const timeoutPromise = new Promise((_, reject) => {
            timeoutId = setTimeout(() => {
                reject(new Error(`Операция отменена по таймауту (${timeoutMs} мс)`));
            }, timeoutMs);
        });

        return Promise.race([
            promise,
            timeoutPromise
        ]).finally(() => {
            clearTimeout(timeoutId);
        });
    }

    /**
     * Проверка и загрузка Bootstrap, если он не загружен
     */
    function ensureBootstrapLoaded() {
        return new Promise((resolve, reject) => {
            if (typeof bootstrap !== 'undefined') {
                resolve();
                return;
            }

            const script = document.createElement('script');
            script.src = 'https://cdn.jsdelivr.net/npm/bootstrap@5.2.3/dist/js/bootstrap.bundle.min.js';
            script.integrity = 'sha384-kenU1KFdBIe4zVF0s0G1M5b4hcpxyD9F7jL+jjXkk+Q2h455rYXK/7HAuoJl+0I4';
            script.crossOrigin = 'anonymous';
            script.onload = resolve;
            script.onerror = reject;
            document.head.appendChild(script);
        });
    }

    /**
     * Форматирование даты в формат DD.MM.YYYY
     */
    function formatDate(dateString) {
        if (!dateString) return '-';
        try {
            // Проверяем формат DD.MM.YYYY HH:mm:ss
            const ruFormat = /^(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}):(\d{2}):(\d{2})$/;
            const ruMatch = dateString.match(ruFormat);
            
            if (ruMatch) {
                const [_, day, month, year] = ruMatch;
                return `${day}.${month}.${year}`;
            }
            
            // Пробуем создать дату из строки
            const date = new Date(dateString);
            if (isNaN(date)) return dateString;
            
            return date.toLocaleDateString(locale, {
                day: '2-digit',
                month: '2-digit',
                year: 'numeric'
            });
        } catch (e) {
            return dateString;
        }
    }

    /**
     * Форматирование суммы с разделителями тысяч
     */
    function formatAmount(amount) {
        if (!amount) return '-';
        
        return parseFloat(amount)
            .toLocaleString(locale, {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2
            }) + ' ₸';
    }

    /**
     * Обработка отправки формы
     */
    if (searchForm && iinInput) {
        searchForm.addEventListener('submit', async function(e) {
            e.preventDefault();

            const iin = iinInput.value.trim();

            if (iinConsent && !iinConsent.checked) {
                iinConsent.reportValidity();
                return;
            }

            // Проверка формата ИИН
            if (!/^\d{12}$/.test(iin)) {
                if (iinValidation) {
                    iinValidation.textContent = T.iinInvalid;
                    iinValidation.style.display = 'block';
                }
                return;
            } else {
                if (iinValidation) {
                    iinValidation.style.display = 'none';
                }
            }

            if (window.ZE_trackEvent) window.ZE_trackEvent('submit_iin', 'checker');

            await checkDebtor(iin);
        });
    }

    /**
     * Основная функция проверки должника
     */
    async function checkDebtor(iin) {
        try {
            toggleLoading(true, T.loadingCheck);
            resetResults();

            // Get data structure { debtors: [...], restrictions: [...] }
            // where each debtor object already contains its details.
            const data = await checkDebtorData(iin);

            if (data && typeof data === 'object') {
                displayResults(data);
            } else {
                throw new Error(T.invalidFormat);
            }

        } catch (error) {
            showErrorMessage(error.message || T.genericErrorShort);
        } finally {
            toggleLoading(false);
        }
    }

    /**
     * Отправляет запрос на сервер для проверки данных должника
     * @param {string} iin - ИИН для проверки
     * @returns {Promise<Object>} - Промис с данными или ошибкой
     */
    async function checkDebtorData(iin) {
        try {
            const response = await fetch('/check', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ iin, consent: Boolean(iinConsent && iinConsent.checked) })
            });

            // Важно: сначала проверяем response.ok
            if (!response.ok) {
                // Пытаемся прочитать тело ошибки как JSON
                let errorData = { message: `${T.serverError}: ${response.status} ${response.statusText}` }; // Сообщение по умолчанию
                try {
                    errorData = await response.json();
                } catch (jsonError) {
                    try {
                        errorData.message = await response.text();
                    } catch (_) { /* ignore */ }
                }
                // Используем details из JSON ошибки, если есть, иначе message
                throw new Error(errorData.details || errorData.message || T.serverCheckError);
            }

            // Если response.ok, читаем тело как JSON
            const data = await response.json();

            // Проверяем наличие ошибки в теле успешного ответа (на всякий случай)
            if (!data || data.error) {
                throw new Error(data.error || T.apiNoData);
            }

            // --- ИЗМЕНЕНО: Обрабатываем НОВЫЙ формат ответа И ОБЕ СПЕЦИФИКИ API --- 
            // Ожидаемый формат data: { debtorInfo: { status: ..., details: [...] ИЛИ {...} ИЛИ null }, restrictions: [] }
            const details = data.debtorInfo?.details;
            let debtorsArray = []; // Массив по умолчанию

            if (details) { // Проверяем, что details вообще есть
                if (Array.isArray(details)) {
                    debtorsArray = details; // Если это уже массив, используем его
                } else if (typeof details === 'object') {
                    // Если это один объект (не null), оборачиваем его в массив
                    debtorsArray = [details]; 
                }
                // Если details не массив и не объект (что маловероятно), debtorsArray останется пустым
            }
            
            const restrictionsArray = data.restrictions || [];

            // Возвращаем объект в формате, ожидаемом displayResults
            return {
                debtors: debtorsArray,
                restrictions: restrictionsArray
            };
            // --- КОНЕЦ ИЗМЕНЕНИЙ ---

        } catch (error) {
            throw error;
        }
    }

    // 40 МРП: from this unpaid amount the bailiff must restrict travel abroad
    // (Law «Об исполнительном производстве и статусе судебных исполнителей», art. 33).
    // МРП comes from the republican budget law; add next year's value in January —
    // for an unknown year the travel-ban hint is simply not shown.
    const MRP_BY_YEAR = { 2026: 4325 };
    const CURRENT_MRP = MRP_BY_YEAR[new Date().getFullYear()];
    const BAN_THRESHOLD = CURRENT_MRP ? CURRENT_MRP * 40 : null;

    const NEXT_STEPS = {
        notary: { href: '/otmena-ispolnitelnoi-nadpisi', label: T.resNext.notary },
        court: { href: '/otmena-resheniya-suda', label: T.resNext.court },
        alimony: { href: '/alimenty-i-aresty', label: T.resNext.alimony },
        fine: { href: '/shtrafy-i-aresty', label: T.resNext.fine },
        other: { href: '/snyatie-aresta-so-scheta', label: T.resNext.other },
    };

    const ICONS = {
        doc: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Zm0 0v5h5M9 13h6M9 17h4"/></svg>',
        plane: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2Z"/></svg>',
        copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
        check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12.5 4.2 4.2L19 7"/></svg>',
        wa: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" class="zx-res-wa"><path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2.05 22l5.25-1.38a9.9 9.9 0 0 0 4.74 1.21c5.46 0 9.91-4.45 9.91-9.91C21.95 6.45 17.5 2 12.04 2Zm5.8 14.06c-.24.68-1.41 1.32-1.95 1.37-.5.05-1.13.07-1.83-.11-.42-.13-.96-.31-1.65-.61-2.9-1.25-4.79-4.17-4.94-4.36-.14-.2-1.18-1.57-1.18-3s.75-2.13 1.02-2.42c.26-.29.57-.36.76-.36h.55c.18 0 .42-.07.65.5.24.57.82 1.99.89 2.13.07.15.12.32.02.51-.1.2-.15.32-.29.49-.15.17-.31.38-.44.51-.15.15-.3.31-.13.6.17.29.76 1.25 1.63 2.03 1.12 1 2.06 1.31 2.35 1.45.29.15.46.12.63-.07.17-.2.73-.85.92-1.14.2-.29.39-.24.65-.15.27.1 1.7.8 1.99.95.29.15.48.22.55.34.07.12.07.7-.17 1.38Z"/></svg>',
    };

    // Registry fields arrive as strings, one-element arrays (xml2js) or empty objects for nil values.
    function pickText(value) {
        if (Array.isArray(value)) return pickText(value[0]);
        if (value == null || typeof value === 'object') return '';
        return String(value).trim();
    }

    function parseRegistryDate(value) {
        if (!value) return null;
        const ru = value.match(/^(\d{2})\.(\d{2})\.(\d{4})/);
        const date = ru ? new Date(Number(ru[3]), Number(ru[2]) - 1, Number(ru[1])) : new Date(value);
        return isNaN(date) ? null : date;
    }

    function classifyBasis(debtor) {
        const organ = pickText(debtor.ilOrganRu).toLowerCase();
        const category = pickText(debtor.categoryRu).toLowerCase();
        if (category.includes('алимент')) return 'alimony';
        if (category.includes('штраф') || category.includes('административ')) return 'fine';
        if (organ.includes('нотари')) return 'notary';
        if (organ.includes('суд')) return 'court';
        return 'other';
    }

    function describeDebtor(debtor) {
        const amount = parseFloat(pickText(debtor.recoveryAmount).replace(/[^\d.,-]/g, '').replace(',', '.')) || 0;
        const ipEnd = pickText(debtor.ipEndDate);
        const startText = pickText(debtor.ipStartDate);
        const startDate = parseRegistryDate(startText);
        const ageDays = startDate ? Math.max(0, Math.floor((Date.now() - startDate.getTime()) / 86400000)) : null;
        const executorParts = [debtor.officerSurname, debtor.officerName, debtor.officerSecondname].map(pickText).filter(Boolean);
        const basis = classifyBasis(debtor);
        return {
            number: pickText(debtor.execProcNum) || '-',
            amount,
            isActive: !ipEnd || ipEnd.includes('nil="true"'),
            ageDays,
            started: startText ? formatDate(startText) : '',
            creditor: pickText(debtor.recovererTitle) || '-',
            organ: pickText(debtor.ilOrganRu),
            office: pickText(debtor.disaNameRu),
            address: pickText(debtor.disaDepartmentAddress),
            executor: executorParts.join(' '),
            executorQuery: executorParts.slice(0, 2).join(' '),
            basis,
            basisLabel: T.resBasisLabels[basis],
            overBanThreshold: BAN_THRESHOLD != null && amount >= BAN_THRESHOLD,
        };
    }

    /**
     * Отображение результатов поиска
     * @param {Object} data - Объект с результатами { debtors: [], restrictions: [] }
     */
    function displayResults(data) {
        resetResults();

        const { debtors, restrictions } = data; // debtors - это массив объектов rows из API

        // --- НОВОЕ: Сохраняем данные для модального окна --- 
        // Сохраняем именно массив debtors (rows)
        window.currentDebtorsData = debtors; 
        // ---------------------------------------------------

        const debtorsContainer = document.getElementById('debtors-table');
        const restrictionsTableBody = document.querySelector('#restrictions-table tbody');
        const debtorsSection = document.getElementById('debtors-section');
        const restrictionsSection = document.getElementById('restrictions-section');

        if (!debtorsContainer || !restrictionsTableBody || !debtorsSection || !restrictionsSection) {
            showErrorMessage(T.interfaceError);
            return;
        }

        debtorsContainer.innerHTML = '';
        restrictionsTableBody.innerHTML = '';

        // --- Отображение карточек исполнительных производств (2026-10-09: сводка + карточки) ---
        debtorsSection.querySelectorAll('.zx-res-summary, .wa-all-block').forEach(el => el.remove());

        if (debtors && debtors.length > 0) {
            debtorsSection.style.display = 'block';

            const iinVal = document.getElementById('iin')?.value || '';
            const items = debtors.map(describeDebtor);
            const active = items.filter(item => item.isActive);
            const counted = active.length ? active : items;
            const total = counted.reduce((sum, item) => sum + item.amount, 0);
            const banCount = items.filter(item => item.isActive && item.overBanThreshold).length;
            const alimonyCount = items.filter(item => item.isActive && item.basis === 'alimony').length;
            const newCount = items.filter(item => item.ageDays != null && item.ageDays <= 30).length;

            // One WhatsApp message with every proceeding, so the specialist sees the whole picture.
            let waAllText = 'Здравствуйте! Прошу разобрать ситуацию по исполнительным производствам.\n';
            if (iinVal) waAllText += `ИИН: ${iinVal}\n`;
            waAllText += `\nНайдено производств: ${debtors.length}\n\n`;
            items.forEach((item, index) => {
                waAllText += `${index + 1}. № ${item.number}\n`;
                waAllText += `   Взыскатель: ${item.creditor}\n`;
                waAllText += `   Сумма: ${formatAmount(item.amount)}\n`;
                waAllText += `   Основание: ${item.basisLabel}\n`;
                if (item.executor) waAllText += `   Исполнитель: ${item.executor}\n`;
                waAllText += '\n';
            });
            const waAllUrl = `https://wa.me/77003097566?text=${encodeURIComponent(waAllText)}`;

            const summary = document.createElement('div');
            summary.className = 'zx-res-summary';
            summary.innerHTML = `
                <div class="zx-res-summary__head">
                    <span class="zx-res-summary__icon" aria-hidden="true">${ICONS.doc}</span>
                    <div>
                        <p class="zx-res-summary__kicker">${T.resKicker}</p>
                        <h3 class="zx-res-summary__title">${T.resTitle(debtors.length)}</h3>
                    </div>
                </div>
                <div class="zx-res-stats">
                    <div class="zx-res-stat zx-res-stat--total">
                        <span>${T.resTotal}</span>
                        <strong>${formatAmount(total)}</strong>
                        <small>${T.resTotalNote}</small>
                    </div>
                    <div class="zx-res-stat"><span>${T.resActive}</span><strong>${active.length}</strong></div>
                    <div class="zx-res-stat${banCount ? ' zx-res-stat--warn' : ''}"><span>${T.resBanStat}</span><strong>${banCount}</strong></div>
                    <div class="zx-res-stat"><span>${T.resNewStat}</span><strong>${newCount}</strong></div>
                </div>
                ${banCount || alimonyCount ? `
                <div class="zx-res-alert" role="note">
                    <span class="zx-res-alert__icon" aria-hidden="true">${ICONS.plane}</span>
                    <div>
                        <strong>${T.resBanTitle}</strong>
                        ${banCount ? `<p>${T.resBanText(banCount, formatAmount(BAN_THRESHOLD))}</p>` : ''}
                        ${alimonyCount ? `<p>${T.resAlimonyText}</p>` : ''}
                        <a href="https://aisoip.adilet.gov.kz/debtors" target="_blank" rel="noopener">${T.resBanLink} →</a>
                    </div>
                </div>` : ''}
                <div class="zx-res-summary__cta">
                    <a href="${waAllUrl}" target="_blank" rel="noopener" class="zx-res-btn zx-res-btn--wa">${ICONS.wa} ${T.resWaAll}</a>
                    <p>${T.resWaNote}</p>
                </div>`;
            debtorsContainer.insertAdjacentElement('beforebegin', summary);

            items.forEach((item, index) => {
                const waOne = `https://wa.me/77003097566?text=${encodeURIComponent(
                    `Здравствуйте! Прошу разобрать производство № ${item.number}.\nВзыскатель: ${item.creditor}\nСумма: ${formatAmount(item.amount)}\nОснование: ${item.basisLabel}`
                )}`;
                const next = NEXT_STEPS[item.basis] || NEXT_STEPS.other;
                const chips = [
                    item.isActive ? `<span class="zx-chip zx-chip--active">${T.resChipActive}</span>` : `<span class="zx-chip">${T.resChipClosed}</span>`,
                    item.isActive && item.overBanThreshold ? `<span class="zx-chip zx-chip--warn">${ICONS.plane} ${T.resChipBan}</span>` : '',
                    item.ageDays != null && item.ageDays <= 30 ? `<span class="zx-chip zx-chip--new">${T.resChipNew(item.ageDays)}</span>` : '',
                ].join('');
                const rows = [
                    [T.resStarted, item.started],
                    [T.resIssuer, item.organ],
                    [T.resExecutor, item.executor],
                    [T.resOffice, item.office],
                    [T.resAddress, item.address],
                ].filter(([, value]) => value && value !== '-');

                const card = document.createElement('article');
                card.className = `zx-res-card${item.isActive && item.overBanThreshold ? ' zx-res-card--warn' : ''}`;
                card.style.setProperty('--i', String(index));
                card.innerHTML = `
                    <header class="zx-res-card__head">
                        <div class="zx-res-card__who">
                            <span class="zx-res-card__basis zx-res-card__basis--${item.basis}">${escapeHtml(item.basisLabel)}</span>
                            <h4 class="zx-res-card__creditor">${escapeHtml(item.creditor)}</h4>
                        </div>
                        <div class="zx-res-card__sum">
                            <strong>${formatAmount(item.amount)}</strong>
                            <span>${T.resToCollect}</span>
                        </div>
                    </header>
                    <div class="zx-res-card__chips">${chips}</div>
                    <dl class="zx-res-card__grid">
                        <div class="zx-res-card__field zx-res-card__field--num">
                            <dt>${T.resCaseNo}</dt>
                            <dd><span class="zx-res-mono">${escapeHtml(item.number)}</span>
                                <button type="button" class="zx-res-copy" data-copy="${escapeHtml(item.number)}" aria-label="${T.resCopy}">${ICONS.copy}<span>${T.resCopy}</span></button></dd>
                        </div>
                        ${rows.map(([label, value]) => `<div class="zx-res-card__field"><dt>${label}</dt><dd>${escapeHtml(value)}</dd></div>`).join('')}
                    </dl>
                    <div class="zx-res-card__links">
                        <a href="${next.href}">${next.label} →</a>
                        ${item.amount > 0 ? `<a href="/ubrat-procenty-i-rashody-chsi">${T.resFeeLink} →</a>` : ''}
                        ${item.executorQuery ? `<a href="/bailiff-search?q=${encodeURIComponent(item.executorQuery)}">${T.resFindExecutor} →</a>` : ''}
                        ${item.address ? `<a href="https://2gis.kz/search/${encodeURIComponent(item.address)}" target="_blank" rel="noopener">${T.resMap} →</a>` : ''}
                    </div>
                    <footer class="zx-res-card__actions">
                        <button class="zx-res-btn zx-res-btn--ghost btn-details-card view-details-btn"
                            data-bs-toggle="modal" data-bs-target="#debtorDetailsModal" data-debtor-index="${index}">${T.details}</button>
                        <a href="${waOne}" target="_blank" rel="noopener" class="zx-res-btn zx-res-btn--wa">${ICONS.wa} ${T.resWaOne}</a>
                    </footer>`;
                debtorsContainer.appendChild(card);
            });

            const waBlock = document.createElement('div');
            waBlock.className = 'wa-all-block zx-res-bottom';
            waBlock.innerHTML = `
                <div>
                    <strong>${debtors.length > 1 ? T.helpMany : T.helpOne}</strong>
                    <p>${T.helpText}</p>
                </div>
                <a href="${waAllUrl}" target="_blank" rel="noopener" class="zx-res-btn zx-res-btn--wa">${ICONS.wa} ${T.waWrite}</a>
                <p class="zx-res-source">${T.resSource}</p>`;
            debtorsSection.appendChild(waBlock);

        } else {
            debtorsSection.style.display = 'block';
            const waNoArrestUrl = `https://wa.me/77003097566?text=${encodeURIComponent(T.waNoArrest)}`;
            debtorsContainer.innerHTML = `
                <div class="zx-res-empty">
                    <span class="zx-res-empty__icon" aria-hidden="true">${ICONS.check}</span>
                    <h3>${T.noArrestsTitle}</h3>
                    <p>${T.noArrestsText}</p>
                    <ul class="zx-res-empty__notes">
                        <li>${T.resEmptyWhy}</li>
                        <li>${T.resEmptyBan} — <a href="https://aisoip.adilet.gov.kz/debtors" target="_blank" rel="noopener">aisoip.adilet.gov.kz</a></li>
                    </ul>
                    <p class="no-arrests-note">${T.noArrestsNote}</p>
                    <a href="${waNoArrestUrl}" target="_blank" rel="noopener" class="zx-res-btn zx-res-btn--wa">${ICONS.wa} ${T.waWrite}</a>
                    <p class="zx-res-source">${T.resSource}</p>
                </div>`;
        }

        // --- Отображение таблицы ограничений (остается без изменений, т.к. restrictions пуст) ---
        if (restrictions && restrictions.length > 0) {
            restrictionsSection.style.display = 'block';
            restrictions.forEach(restriction => {
                const row = document.createElement('tr');
                // Предполагаем, что объект restriction имеет поля type, authority, date, status
                const type = restriction.type || '-';
                const authority = restriction.authority || '-';
                const date = formatDate(restriction.date) || '-'; // Форматируем дату
                let status = restriction.status || '-';
                let statusClass = '';
                 // Проверяем на содержание ключевых слов для статуса
                if (typeof status === 'string') {
                    if (status.toLowerCase().includes('да') || status.toLowerCase().includes('есть')) {
                         statusClass = 'status-danger'; // Красный для T.yes
                         status = T.yes; // Нормализуем текст
                    } else if (status.toLowerCase().includes('нет')) {
                         statusClass = 'status-success'; // Зеленый для T.no
                         status = T.no; // Нормализуем текст
                    }
                    // Добавляем обработку для кнопки "Детали"
                    if (status.toLowerCase().includes('детали')) {
                        // Здесь можно добавить кнопку или ссылку, если нужно
                        // Пока просто отображаем текст
                         status = T.details; // Нормализуем текст, оставляем стандартный стиль
                    }
                 }


                row.innerHTML = `
                    <td data-label="${T.labels.restrictionType}">${escapeHtml(type)}</td>
                    <td data-label="${T.labels.status}"><span class="status ${statusClass}">${escapeHtml(status)}</span></td>
                    <td data-label="${T.labels.organ}">${escapeHtml(authority)}</td>
                    <td data-label="${T.labels.date}">${escapeHtml(date)}</td>
                    <!-- <td data-label="Детали"> ${status.toLowerCase().includes('детали') ? '<button class="btn btn-sm btn-outline-secondary">Детали</button>' : '-'} </td> -->
                `;
                restrictionsTableBody.appendChild(row);
            });
             // Скрываем заголовок "Детали", так как кнопки пока нет
            const detailsHeader = restrictionsTableBody.closest('table').querySelector('th:last-child');
            if (detailsHeader) {
                 // detailsHeader.style.display = 'none'; // Скрыть заголовок
            }
        } else {
            restrictionsSection.style.display = 'none';
        }

        results.style.display = 'block';
    }

    /**
     * Отображение сообщения об ошибке с CTA в WhatsApp
     */
    function showErrorMessage(message) {
        const msg = message || T.genericErrorLong;
        const waUrl = `https://wa.me/77003097566?text=${encodeURIComponent(T.waPrefix)}`;
        errorMessage.innerHTML = `
            <i class="bi bi-exclamation-triangle me-2"></i>
            <strong>${T.errorLabel}</strong> <span>${escapeHtml(msg)}</span>
            <div class="mt-3">
                <a href="${waUrl}" target="_blank" rel="noopener" class="btn-wa-error">
                    <i class="bi bi-whatsapp me-1"></i> ${T.waWrite}
                </a>
            </div>`;
        errorMessage.classList.remove('d-none');
    }

    /**
     * Сброс результатов поиска
     */
    function resetResults() {
        // Находим элементы один раз
        const resultsContainer = document.getElementById('results');
        const errorContainer = document.getElementById('error-message');
        const debtorsSection = document.getElementById('debtors-section');
        const restrictionsSection = document.getElementById('restrictions-section');
        const debtorsContainer = document.getElementById('debtors-table');
        const restrictionsTableBody = document.querySelector('#restrictions-table tbody');

        if (resultsContainer) {
            resultsContainer.style.display = 'none';
        }
        if (errorContainer) {
            errorContainer.classList.add('d-none');
        }
        if (debtorsSection) {
            debtorsSection.style.display = 'none';
        }
        if (restrictionsSection) {
            restrictionsSection.style.display = 'none';
        }
        if (debtorsContainer) {
            debtorsContainer.innerHTML = '';
        }
        if (debtorsSection) {
            debtorsSection.querySelectorAll('.wa-all-block, .zx-res-summary').forEach(el => el.remove());
        }
        if (restrictionsTableBody) {
            restrictionsTableBody.innerHTML = '';
        }
    }

    /**
     * Переключение индикатора загрузки
     */
    function toggleLoading(isLoading, message = T.loading) {
        if (!loadingContainer || !loadingMessage || !progressBar || !searchButton) return;

        const messageSpan = loadingMessage.querySelector('span');
        
        if (isLoading) {
            // Показываем индикатор загрузки
            loadingContainer.style.display = 'block';
            // Используем переданное сообщение или стандартное "Проверка данных"
            const currentMessage = message || T.loadingRegistry; 
            messageSpan.innerHTML = `${currentMessage}<span class="loading-dots"></span>`;
            searchButton.disabled = true;
            progressBar.style.width = '0%'; // Сбрасываем прогресс бар
            progressBar.classList.add('progress-bar-animated'); // Добавляем анимацию
            progressBar.classList.remove('bg-success'); // Убираем зеленый фон, если был
            
            // Анимация прогресс-бара (симуляция)
            let progress = 0;
            const maxProgress = 95; // Не доводим до 100%
            const intervalTime = 300; // Немного медленнее
            // Сохраняем ID интервала, чтобы его можно было очистить
            loadingContainer.intervalId = setInterval(() => {
                // Проверяем, виден ли еще индикатор
                if (loadingContainer.style.display === 'none') {
                    clearInterval(loadingContainer.intervalId);
                    return;
                }
                
                // Увеличиваем прогресс случайно, но нелинейно
                progress += Math.random() * (100 - progress) * 0.1;
                if (progress > maxProgress) {
                    progress = maxProgress; 
                    // Не очищаем интервал здесь, пусть он продолжает работать до вызова toggleLoading(false)
                }
                
                progressBar.style.width = `${progress.toFixed(2)}%`;
            }, intervalTime);

        } else {
            // Очищаем интервал анимации, если он был запущен
            if (loadingContainer.intervalId) {
                clearInterval(loadingContainer.intervalId);
                loadingContainer.intervalId = null;
            }
            
            // Завершаем анимацию
            progressBar.style.width = '100%';
            progressBar.classList.remove('progress-bar-animated'); // Убираем анимацию
            progressBar.classList.add('bg-success'); // Делаем зеленым при завершении
            messageSpan.textContent = T.complete;
            loadingContainer.classList.add('fade-out');
            
            setTimeout(() => {
                loadingContainer.style.display = 'none';
                loadingContainer.classList.remove('fade-out');
                // Сбрасываем прогресс бар для следующего запуска
                progressBar.style.width = '0%'; 
                progressBar.classList.remove('bg-success');
                searchButton.disabled = false;
            }, 800); // Увеличил задержку скрытия
        }
    }

    // Загрузка тестовых данных
    function loadTestData() {
        const testIIN = '123456789012';
        iinInput.value = testIIN;
        checkDebtor(testIIN);
    }

    // Добавляем обработчики событий
    if (testDataButton && iinInput) {
        testDataButton.addEventListener('click', loadTestData);
    }

    // Валидация ввода ИИН (только цифры)
    if (iinInput) {
        iinInput.addEventListener('input', function() {
            this.value = this.value.replace(/[^\d]/g, '');

            if (this.value.length > 12) {
                this.value = this.value.slice(0, 12);
            }

            if (this.value.length === 12 && iinValidation) {
                iinValidation.style.display = 'none';
            }
        });
    }

    if (results) {
        results.addEventListener('click', function(event) {
            const copyButton = event.target.closest('.zx-res-copy');
            if (!copyButton || !navigator.clipboard) return;
            navigator.clipboard.writeText(copyButton.getAttribute('data-copy') || '').then(() => {
                const label = copyButton.querySelector('span');
                if (!label) return;
                label.textContent = T.resCopied;
                copyButton.classList.add('is-done');
                setTimeout(() => { label.textContent = T.resCopy; copyButton.classList.remove('is-done'); }, 1600);
            }).catch(() => {});
        });
    }

    // ---- РАСКОММЕНТИРОВАН КОД МОДАЛЬНОГО ОКНА ----
    
    const resultsContainer = document.getElementById('results');
    const debtorDetailsModalElement = document.getElementById('debtorDetailsModal');

    if (resultsContainer && debtorDetailsContent && debtorDetailsModalElement) {
        resultsContainer.addEventListener('click', function(event) {
            const button = event.target.closest('.view-details-btn');
            
            if (button) {
                const debtorIndex = button.getAttribute('data-debtor-index');
                
                if (window.currentDebtorsData && window.currentDebtorsData[debtorIndex]) {
                    const debtor = window.currentDebtorsData[debtorIndex];

                    // Формируем HTML для деталей — три блока: Должник, Взыскатель, Производство
                    let detailsHtml = '';
                    if (debtor && Object.keys(debtor).length > 0) {
                        // ФИО должника (объединяем три поля)
                        const dSurname = debtor.debtorSurname || '';
                        const dName    = debtor.debtorName    || '';
                        let dSecond = '';
                        if (Array.isArray(debtor.debtorSecondname)) dSecond = debtor.debtorSecondname[0] || '';
                        else if (typeof debtor.debtorSecondname === 'string') dSecond = debtor.debtorSecondname;
                        const dFio = [dSurname, dName, dSecond].filter(Boolean).join(' ');

                        // ФИО исполнителя (объединяем три поля)
                        const exSurname = debtor.officerSurname || '';
                        const exName    = debtor.officerName    || '';
                        let exSecond = '';
                        if (Array.isArray(debtor.officerSecondname)) exSecond = debtor.officerSecondname[0] || '';
                        else if (typeof debtor.officerSecondname === 'string') exSecond = debtor.officerSecondname;
                        const exFio = [exSurname, exName, exSecond].filter(Boolean).join(' ');

                        function miRow(label, value) {
                            if (!value || value === '') return '';
                            return `<div class="mi-row"><span class="mi-label">${label}</span><span class="mi-value">${escapeHtml(value)}</span></div>`;
                        }

                        const blockDebtor = `<div class="mi-block">
                            <div class="mi-block-title">${isKz ? 'Борышкер' : 'Должник'}</div>
                            ${miRow(isKz ? 'ТАӘ' : 'ФИО', dFio)}
                            ${miRow(isKz ? 'ЖСН' : 'ИИН', debtor.debtorIin)}
                            ${miRow(isKz ? 'БСН' : 'БИН', debtor.debtorBin)}
                            ${miRow(isKz ? 'Атауы' : 'Наименование', debtor.debtorTitle)}
                        </div>`;

                        const blockCreditor = `<div class="mi-block">
                            <div class="mi-block-title">${isKz ? 'Өндіріп алушы' : 'Взыскатель'}</div>
                            ${miRow(isKz ? 'Атауы' : 'Наименование', debtor.recovererTitle)}
                            ${miRow(isKz ? 'БСН' : 'БИН', debtor.recovererBin)}
                        </div>`;

                        const blockCase = `<div class="mi-block">
                            <div class="mi-block-title">${isKz ? 'Атқарушылық іс жүргізу' : 'Производство'}</div>
                            ${miRow(isKz ? 'АІЖ нөмірі' : 'Номер ИП', debtor.execProcNum)}
                            ${miRow(isKz ? 'Басталған күні' : 'Дата возбуждения', debtor.ipStartDate ? formatDate(debtor.ipStartDate) : '')}
                            ${miRow(isKz ? 'ИД күні' : 'Дата ИД', debtor.ilDate ? formatDate(debtor.ilDate) : '')}
                            ${miRow(isKz ? 'Өндіру сомасы' : 'Сумма взыскания', debtor.recoveryAmount ? formatAmount(debtor.recoveryAmount) : '')}
                            ${miRow(isKz ? 'Құжатты берген орган' : 'Орган, выдавший ИД', debtor.ilOrganRu)}
                            ${miRow(isKz ? 'Атқарушылық іс жүргізу органы' : 'Орган исп. пр-ва', debtor.disaNameRu)}
                            ${miRow(isKz ? 'Орындаушы' : 'Исполнитель', exFio)}
                            ${miRow(isKz ? 'Мекенжайы' : 'Адрес', debtor.disaDepartmentAddress)}
                        </div>`;

                        detailsHtml = blockDebtor + blockCreditor + blockCase;
                    } else {
                        detailsHtml = `<p class="text-muted">${T.noDetails}</p>`;
                    }
                    
                    // Обновляем содержимое модального окна
                    debtorDetailsContent.innerHTML = detailsHtml;

                } else {
                    debtorDetailsContent.innerHTML = `<p class="text-danger">${T.detailsLoadError}</p>`;
                }
            }
        });
    }
    
    // ---- КОНЕЦ КОДА МОДАЛЬНОГО ОКНА ----

    // --- ДОБАВЛЕНО: Анимация при прокрутке --- 
    const animateOnScrollObserver = new IntersectionObserver((entries, observer) => {
        entries.forEach(entry => {
            // Если элемент пересекает viewport (становится видимым)
            if (entry.isIntersecting) {
                entry.target.classList.add('visible');
                // Можно перестать наблюдать за элементом после того, как он стал видимым (опционально)
                // observer.unobserve(entry.target);
            }
            // Можно добавить логику для скрытия, если элемент уходит с экрана
            // else {
            //    entry.target.classList.remove('visible');
            // }
        });
    }, {
        threshold: 0.1 // Запускать, когда хотя бы 10% элемента видно
        // rootMargin: '0px 0px -50px 0px' // Можно настроить отступы, чтобы анимация начиналась раньше/позже
    });

    // Находим все элементы, которые должны анимироваться при прокрутке
    const elementsToAnimate = document.querySelectorAll('.fade-in-section, .why-us-section .col-md-4, .why-us-section .process-card'); 
    elementsToAnimate.forEach(el => {
        animateOnScrollObserver.observe(el);
    });
    // --- КОНЕЦ ДОБАВЛЕННОЙ АНИМАЦИИ ---

});
