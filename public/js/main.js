/**
 * Скрипт для проверки данных должников и арестов по ИИН
 */
document.addEventListener('DOMContentLoaded', function() {
    // Проверка загрузки Bootstrap
    ensureBootstrapLoaded();
    
    // DOM элементы
    const searchForm = document.getElementById('search-form');
    const iinInput = document.getElementById('iin');
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
    const locale = isKz ? 'kk-KZ' : 'ru-RU';
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
        waPrefix: 'Здравствуйте! Прошу разобрать ситуацию по исполнительному производству.'
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
        waPrefix: 'Сәлеметсіз бе! Атқарушылық өндіріс бойынша жағдайды талдауды сұраймын.'
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
                body: JSON.stringify({ iin })
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

    /**
     * Определяет статус-рекомендацию для производства (без ложных обещаний)
     * @param {Object} debtorData - Данные производства
     * @returns {{ text: string, cls: string }} - текст и CSS-класс статуса
     */
    function getStatusRecommendation(debtorData) {
        if (!debtorData) return { text: T.statusAnalysis, cls: 'status-neutral' };

        const ipEndDate = debtorData.ipEndDate;
        const isActive = !ipEndDate || String(ipEndDate).trim() === '' || String(ipEndDate).includes('nil="true"');
        const creditor = (debtorData.recovererTitle || '').toLowerCase();
        const category = (debtorData.categoryRu || '').toLowerCase();
        const organ = (debtorData.ilOrganRu || '').toLowerCase();

        const isNotarial = organ.includes('нотариальн');
        const isAlimony = category.includes('алимент');
        const isFine = category.includes('штраф') || category.includes('административ');
        const isStateCreditor = creditor.includes('государств') || creditor.includes('министерство') || creditor.includes('акимат') || creditor.includes('дгд');

        if (!isActive) {
            return { text: T.statusSettle, cls: 'status-neutral' };
        }
        if (isAlimony || (isFine && isStateCreditor)) {
            return { text: T.statusDocs, cls: 'status-neutral' };
        }
        if (isNotarial) {
            return { text: T.statusReview, cls: 'status-info' };
        }
        return { text: T.statusAnalysis, cls: 'status-info' };
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

        // --- Отображение карточек исполнительных производств ---
        if (debtors && debtors.length > 0) {
            debtorsSection.style.display = 'block';

            // Build single WhatsApp message with ALL arrests
            const iinVal = document.getElementById('iin')?.value || '';
            const waIcon = `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>`;
            let waAllText = 'Здравствуйте! Прошу разобрать ситуацию по исполнительным производствам.\n';
            if (iinVal) waAllText += `ИИН: ${iinVal}\n`;
            waAllText += `\nНайдено производств: ${debtors.length}\n\n`;

            debtors.forEach((debtor, index) => {
                const debtorNum = debtor.execProcNum || '-';
                const debtorDate = formatDate(debtor.ipStartDate);
                const debtorAmountStr = debtor.recoveryAmount || '0';
                const debtorAmount = parseFloat(String(debtorAmountStr).replace(/[^\d.,-]/g, '').replace(',', '.')) || 0;
                const authority = debtor.ilOrganRu || '-';
                const executorSurname = debtor.officerSurname || '';
                const executorName = debtor.officerName || '';
                const executorSecondnameRaw = debtor.officerSecondname;
                let executorSecondname = '';
                if (Array.isArray(executorSecondnameRaw) && executorSecondnameRaw.length > 0) {
                    executorSecondname = executorSecondnameRaw[0] || '';
                } else if (typeof executorSecondnameRaw === 'string') {
                    executorSecondname = executorSecondnameRaw;
                }
                const executor = `${executorSurname} ${executorName} ${executorSecondname}`.trim() || '-';
                const creditor = debtor.recovererTitle || '-';
                const { text: statusText, cls: statusCls } = getStatusRecommendation(debtor);

                // Accumulate into WhatsApp message
                waAllText += `${index + 1}. № ${debtorNum}\n`;
                waAllText += `   Взыскатель: ${creditor}\n`;
                waAllText += `   Сумма: ${formatAmount(debtorAmount)}\n`;
                waAllText += `   Орган: ${authority}\n`;
                if (executor !== '-') waAllText += `   ЧСИ: ${executor}\n`;
                waAllText += '\n';

                const card = document.createElement('div');
                card.className = 'ip-list-item';
                card.innerHTML = `
                    <div class="ip-list-num">${index + 1}</div>
                    <div class="ip-list-body">
                        <div class="ip-list-header">
                            <span class="ip-list-docnum">№ ${debtorNum}</span>
                            <span class="status ${statusCls}">${statusText}</span>
                        </div>
                        <div class="ip-list-meta">
                            <span><b>${T.labels.creditor}:</b> ${creditor}</span>
                            <span><b>${T.labels.amount}:</b> <span class="ip-amount">${formatAmount(debtorAmount)}</span></span>
                            ${debtorAmount > 0 ? `<span class="ip-chsi-fee"><b>Услуга ЧСИ</b> <a href="https://wa.me/77479957635?text=${encodeURIComponent('Здравствуйте! Хочу убрать проценты ЧСИ, прошу помочь.')}" target="_blank" rel="noopener" class="ip-save-link">— убрать проценты ЧСИ →</a></span>` : ''}
                            <span><b>${T.labels.date}:</b> ${debtorDate}</span>
                            <span><b>${T.labels.organ}:</b> ${authority}</span>
                            ${executor !== '-' ? `<span><b>${T.labels.executor}:</b> ${executor}</span>` : ''}
                        </div>
                    </div>
                    <div class="ip-list-action">
                        <button class="btn-details-card view-details-btn"
                            data-bs-toggle="modal"
                            data-bs-target="#debtorDetailsModal"
                            data-debtor-index="${index}">
                            ${T.details}
                        </button>
                    </div>
                `;
                debtorsContainer.appendChild(card);
            });

            // Single WhatsApp button after all cards
            const waAllUrl = `https://wa.me/77479957635?text=${encodeURIComponent(waAllText)}`;
            const waBlock = document.createElement('div');
            waBlock.className = 'wa-all-block';
            waBlock.innerHTML = `
                <div class="wa-all-inner">
                    <div class="wa-all-text">
                        <strong>Нужна помощь по ${debtors.length > 1 ? 'этим производствам' : 'этому производству'}?</strong>
                        <p>Напишем в WhatsApp — разберём каждое производство и объясним ваши права бесплатно</p>
                    </div>
                    <a href="${waAllUrl}" target="_blank" rel="noopener" class="wa-btn-single">
                        ${waIcon} Написать в WhatsApp
                    </a>
                </div>
            `;
            debtorsSection.appendChild(waBlock);

        } else {
            // No arrests found
            debtorsSection.style.display = 'block';
            const waNoArrestUrl = `https://wa.me/77479957635?text=${encodeURIComponent('Здравствуйте! Проверил(а) по ИИН — арестов не найдено, но у меня есть вопрос по задолженности.')}`;
            debtorsContainer.innerHTML = `
                <div class="no-arrests-block">
                    <div class="no-arrests-icon">✅</div>
                    <h3>У вас нет активных арестов</h3>
                    <p>По данному ИИН исполнительных производств не найдено.</p>
                    <p class="no-arrests-note">Если у вас непонятная ситуация — напишите нам, разберёмся бесплатно.</p>
                    <a href="${waNoArrestUrl}" target="_blank" rel="noopener" class="wa-btn-single">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
                        Написать в WhatsApp
                    </a>
                </div>
            `;
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
                    <td data-label="${T.labels.restrictionType}">${type}</td>
                    <td data-label="${T.labels.status}"><span class="status ${statusClass}">${status}</span></td>
                    <td data-label="${T.labels.organ}">${authority}</td>
                    <td data-label="${T.labels.date}">${date}</td>
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
        const waUrl = `https://wa.me/77479957635?text=${encodeURIComponent(T.waPrefix)}`;
        errorMessage.innerHTML = `
            <i class="bi bi-exclamation-triangle me-2"></i>
            <strong>Ошибка:</strong> <span>${msg}</span>
            <div class="mt-3">
                <a href="${waUrl}" target="_blank" rel="noopener" class="btn-wa-error">
                    <i class="bi bi-whatsapp me-1"></i> Написать в WhatsApp
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
            debtorsSection.querySelectorAll('.wa-all-block').forEach(el => el.remove());
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
                            return `<div class="mi-row"><span class="mi-label">${label}</span><span class="mi-value">${value}</span></div>`;
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
