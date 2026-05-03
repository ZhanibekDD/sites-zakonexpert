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
        amount: 'Сумма долга',
        csiCost: 'Услуги ЧСИ',
        cancelCost: 'Стоимость отмены',
        savings: 'Возможная экономия',
        creditor: 'Взыскатель',
        organ: 'Орган',
        executor: 'Исполнитель',
        status: 'Статус',
        restrictionType: 'Тип ограничения'
    };
    const baseText = {
        iinInvalid: 'ИИН должен содержать 12 цифр',
        loadingCheck: 'Проверка данных в реестре должников...',
        invalidFormat: 'Некорректный формат или отсутствуют данные',
        genericErrorShort: 'Произошла ошибка при проверке данных. Пожалуйста, попробуйте позже.',
        genericErrorLong: 'Произошла ошибка при получении данных. Пожалуйста, проверьте ИИН и попробуйте позже. Если ошибка повторяется, возможно, сервис adilet.gov.kz временно недоступен или находится под высокой нагрузкой.',
        serverError: 'Ошибка сервера',
        serverCheckError: 'Ошибка сервера при проверке должника',
        apiNoData: 'Не удалось получить данные должника из ответа API',
        canCancel: 'Можно отменить',
        details: 'Подробнее',
        yes: 'Да',
        no: 'Нет',
        complete: 'Загрузка завершена!',
        loading: 'Загрузка...',
        loadingRegistry: 'Проверка данных в реестрах',
        interfaceError: 'Ошибка интерфейса: не удалось отобразить результаты.',
        tableNotFound: 'Не найдены элементы таблиц или секций для отображения результатов.',
        noDetails: 'Подробные детали для этого производства отсутствуют.',
        detailsLoadError: 'Ошибка: Не удалось загрузить детали.'
    };
    const kzText = {
        iinInvalid: 'ЖСН 12 саннан тұруы керек',
        loadingCheck: 'Борышкерлер тізіліміндегі деректер тексерілуде...',
        invalidFormat: 'Қате формат немесе деректер жоқ',
        genericErrorShort: 'Тексеру кезінде қате орын алды. Қайталап көріңіз.',
        genericErrorLong: 'Деректерді алу кезінде қате орын алды. ЖСН-ды тексеріп, кейінірек қайталап көріңіз. Егер қате қайталанса, adilet.gov.kz сайты уақытша қолжетімсіз немесе жүктемеде болуы мүмкін.',
        serverError: 'Сервер қатесі',
        serverCheckError: 'Борышкерді тексеру кезінде сервер қатесі',
        apiNoData: 'API жауабынан деректерді алу мүмкін болмады',
        canCancel: 'Күшін жоюға болады',
        details: 'Толығырақ',
        yes: 'Бар',
        no: 'Жоқ',
        complete: 'Жүктеу аяқталды!',
        loading: 'Жүктеу...',
        loadingRegistry: 'Тізілімдердегі деректер тексерілуде',
        interfaceError: 'Интерфейс қатесі: нәтижелерді көрсету мүмкін болмады.',
        tableNotFound: 'Нәтижелерді көрсету үшін кесте немесе бөлім элементтері табылмады.',
        noDetails: 'Бұл өндіріс бойынша толық деректер жоқ.',
        detailsLoadError: 'Қате: толық мәліметтерді жүктеу мүмкін болмады.'
    };
    const kzLabels = {
        debtorNum: 'АІЖ нөмірі',
        date: 'Күні',
        amount: 'Борыш сомасы',
        csiCost: 'ЖСО қызметтері',
        cancelCost: 'Күшін жою құны',
        savings: 'Мүмкін үнемдеу',
        creditor: 'Өндіріп алушы',
        organ: 'Орган',
        executor: 'Орындаушы',
        status: 'Мәртебесі',
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
            console.error('Ошибка форматирования даты:', e);
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
        
        await checkDebtor(iin);
    });

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
            console.log("Data prepared by checkDebtorData:", JSON.stringify(data, null, 2)); // Log processed data

            // Check if data object exists
            if (data && typeof data === 'object') {
                 // Pass the entire data object (debtors + restrictions) to displayResults
                 console.log("Passing data to displayResults:", JSON.stringify(data, null, 2));
                 displayResults(data); // Pass the whole data object
            } else {
                console.error("Received invalid data structure:", data);
                throw new Error(T.invalidFormat);
            }

        } catch (error) {
            console.error('Ошибка при проверке должника:', error);
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
                    console.warn("Не удалось разобрать тело ошибки как JSON:", jsonError);
                    // Если тело не JSON, можно попробовать прочитать как текст
                    try {
                         errorData.message = await response.text();
                    } catch (textError) {
                         console.warn("Не удалось разобрать тело ошибки как текст:", textError);
                    }
                }
                // Используем details из JSON ошибки, если есть, иначе message
                throw new Error(errorData.details || errorData.message || T.serverCheckError);
            }

            // Если response.ok, читаем тело как JSON
            const data = await response.json();
            console.log("Raw data received from fetch:", JSON.stringify(data, null, 2)); // Оставляем для отладки

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
            console.error('API error:', error);
            // Перебрасываем ошибку дальше, чтобы ее обработал checkDebtor
            throw error; 
        }
    }

    /**
     * Расчет стоимости услуг ЧСИ
     * @param {number} amount - Сумма долга
     * @param {string} organ - Орган, выдавший документ
     * @param {string} type - Тип документа
     * @returns {number} - Стоимость услуг ЧСИ
     */
    function calculateServiceCost(amount, organ, type = 'имущественный') {
        const MRP = 3692; // МРП на 2024 год
        let cost = 0;

        // Для исполнительных документов имущественного (денежного) характера
        if (type === 'имущественный') {
            if (amount <= 60 * MRP) { // до 60 МРП
                cost = amount * 0.25;
            } else if (amount <= 300 * MRP) { // от 60 до 300 МРП
                cost = amount * 0.20;
            } else if (amount <= 1000 * MRP) { // от 300 до 1000 МРП
                cost = amount * 0.15;
            } else if (amount <= 5000 * MRP) { // от 1000 до 5000 МРП
                cost = amount * 0.10;
            } else if (amount <= 10000 * MRP) { // от 5000 до 10000 МРП
                cost = amount * 0.08;
            } else if (amount <= 20000 * MRP) { // от 10000 до 20000 МРП
                cost = amount * 0.05;
            } else { // свыше 20000 МРП
                cost = amount * 0.03;
            }
        }
        // Для исполнительных документов неимущественного характера
        else if (type === 'неимущественный') {
            if (organ.toLowerCase().includes('выселени') || 
                organ.toLowerCase().includes('вселени') || 
                organ.toLowerCase().includes('обязани')) {
                cost = 50 * MRP; // для физических лиц
            } else if (organ.toLowerCase().includes('обеспечени') || 
                       organ.toLowerCase().includes('освобождени')) {
                cost = 10 * MRP; // для физических лиц
            } else if (organ.toLowerCase().includes('общени') && 
                       organ.toLowerCase().includes('ребенк')) {
                cost = 20 * MRP; // ежемесячно
            }
        }
        // Для исполнительных документов о взыскании периодических платежей
        else if (type === 'периодический') {
            if (organ.toLowerCase().includes('алимент') || 
                organ.toLowerCase().includes('возмещени') || 
                organ.toLowerCase().includes('увечь')) {
                cost = 1 * MRP; // ежеквартально
            }
        }

        return Math.round(cost);
    }

    /**
     * НОВАЯ ФУНКЦИЯ: Расчет стоимости НАШЕЙ услуги по отмене
     * @param {number} amount - Сумма долга
     * @param {string} organ - Орган, выдавший документ
     * @param {boolean} canCancel - Возможность отмены (определенная ранее)
     * @returns {number} - Стоимость нашей услуги
     */
    function calculateOurServiceCost(amount, organ, canCancel) {
        // Услуга предоставляется только если canCancel === true
        if (!canCancel) {
            return 0;
        }

        let cost = 0;
        const organLower = organ.toLowerCase();

        // Расчет для нотариальной палаты
        if (organLower.includes('нотариальная палата')) {
            if (amount <= 50000) {
                cost = 2500;
            } else if (amount <= 200000) {
                cost = 5000;
            } else if (amount <= 500000) {
                cost = 10000;
            } else if (amount <= 1000000) {
                cost = 20000;
            } else if (amount <= 2000000) {
                cost = 40000;
            } else {
                cost = 60000;
            }
        } else {
            // Можно добавить логику для других органов, если нужно
            // Например, базовая стоимость или другой расчет
            // Пока оставим 0 для не-нотариальных
            cost = 0; // Или установите базовую ставку для других случаев?
        }

        // Увеличение на 50% если орган - суд
        if (organLower.includes('суд')) {
            cost *= 1.5;
        }

        return Math.round(cost);
    }

    /**
     * Проверка возможности отмены (теперь учитывает и статус, УГАДАННЫЙ по ipEndDate)
     * @param {Object} debtorData - Данные производства (объект из массива rows API)
     * @returns {boolean} - Можно ли отменить (на основе предположений)
     */
    function canBeCancelled(debtorData) {
        if (!debtorData) return false;

        // --- НАЧАЛО: Логика угадывания статуса и проверки --- 

        // 1. Проверяем ipEndDate. Если дата есть, точно НЕ "На исполнении" (по нашей логике).
        const ipEndDate = debtorData.ipEndDate;
        if (ipEndDate && String(ipEndDate).trim() !== '' && !ipEndDate.includes('nil="true"')) { // Проверяем, что не null, не пустая строка и не содержит nil=true (на всякий случай)
            // console.log(`Отмена невозможна: ipEndDate (${ipEndDate}) не пуста.`);
            return false;
        }
        // Если ipEndDate пуста, ПРЕДПОЛАГАЕМ, что статус "На исполнении". Идем дальше.

        // 2. Проверяем на исключения: гос. взыскатель, штраф, алименты
        const creditor = (debtorData.recovererTitle || '').toLowerCase(); // Взыскатель
        const category = (debtorData.categoryRu || '').toLowerCase(); // Категория
        // const organ = (debtorData.ilOrganRu || '').toLowerCase(); // Орган, выдавший ИД (менее надежно для штрафов/алиментов)

        const isStateCreditor = 
               creditor.includes('государств') || 
               creditor.includes('прокурор') ||
               creditor.includes('министерство') ||
               creditor.includes('акимат') ||
               creditor.includes('департамент государственных доходов') || 
               creditor.includes('дгд');
               
        const isFineOrAlimony = 
               category.includes('штраф') || 
               category.includes('алимент') ||
               category.includes('административном правонарушении'); // Добавим проверку категории АП
               // organ.includes('штраф') || organ.includes('алимент') || organ.includes('администрат');

        if (isStateCreditor || isFineOrAlimony) {
            // console.log(`Отмена невозможна: Гос. взыскатель (${isStateCreditor}) или Штраф/Алименты (${isFineOrAlimony}).`);
            return false;
        }
        
        // 3. Если дошли сюда (ipEndDate пуст И не было исключений) - считаем, что отменить МОЖНО.
        // console.log('Отмена ВОЗМОЖНА (на основе предположений).');
        return true;
        // --- КОНЕЦ: Логика угадывания статуса и проверки --- 
    }

    /**
     * Отображение результатов поиска
     * @param {Object} data - Объект с результатами { debtors: [], restrictions: [] }
     */
    function displayResults(data) {
        console.log("Displaying results for:", JSON.stringify(data, null, 2));
        resetResults(); // Очищаем предыдущие результаты

        const { debtors, restrictions } = data; // debtors - это массив объектов rows из API

        // --- НОВОЕ: Сохраняем данные для модального окна --- 
        // Сохраняем именно массив debtors (rows)
        window.currentDebtorsData = debtors; 
        // ---------------------------------------------------

        const debtorsTableBody = document.querySelector('#debtors-table tbody');
        const restrictionsTableBody = document.querySelector('#restrictions-table tbody');
        const debtorsSection = document.getElementById('debtors-section');
        const restrictionsSection = document.getElementById('restrictions-section');

        if (!debtorsTableBody || !restrictionsTableBody || !debtorsSection || !restrictionsSection) {
            console.error(T.tableNotFound);
            showErrorMessage(T.interfaceError);
            return;
        }

        debtorsTableBody.innerHTML = ''; // Очищаем тело таблицы должников
        restrictionsTableBody.innerHTML = ''; // Очищаем тело таблицы ограничений

        // --- Отображение таблицы должников --- 
        if (debtors && debtors.length > 0) {
            debtorsSection.style.display = 'block'; // Показываем секцию должников
            debtors.forEach((debtor, index) => { // debtor - это объект строки (row) из API
                
                // --- ИЗМЕНЕНО: Извлекаем данные напрямую из объекта debtor (row) ---
                const debtorNum = debtor.execProcNum || '-';
                const debtorDate = formatDate(debtor.ipStartDate); // Используем дату начала ИП
                const debtorAmountStr = debtor.recoveryAmount || '0'; // Сумма взыскания
                const debtorAmount = parseFloat(String(debtorAmountStr).replace(/[^\d.,-]/g, '').replace(',', '.')) || 0;
                const authority = debtor.ilOrganRu || '-'; // Орган, выдавший ИД
                // Собираем ФИО исполнителя
                const executorSurname = debtor.officerSurname || '';
                const executorName = debtor.officerName || '';
                // officerSecondname может быть массивом или строкой, берем первый элемент если массив
                const executorSecondnameRaw = debtor.officerSecondname;
                let executorSecondname = '';
                if (Array.isArray(executorSecondnameRaw) && executorSecondnameRaw.length > 0) {
                    executorSecondname = executorSecondnameRaw[0] || ''; // Берем только ФИО
                } else if (typeof executorSecondnameRaw === 'string') {
                    executorSecondname = executorSecondnameRaw;
                }
                const executor = `${executorSurname} ${executorName} ${executorSecondname}`.trim() || '-';
                const creditor = debtor.recovererTitle || '-'; // Взыскатель
                // const statusText = debtor.???; // В API нет прямого статуса типа "На исполнении"

                const csiCost = calculateServiceCost(debtorAmount, authority); // Расчет стоимости ЧСИ
                
                // --- ИЗМЕНЕНО: Форсируем статус "Можно отменить" для отображения и расчетов ---
                const canCancel = true; // Всегда считаем, что отменить можно
                // let actualCanCancel = canBeCancelled(debtor); // Можно сохранить реальную проверку для других целей, если нужно
                const cancellationStatusText = T.canCancel; // Всегда этот текст
                // Используем authority (ilOrganRu) для расчета нашей услуги
                // Передаем canCancel (который всегда true) как индикатор статуса
                const ourServiceCost = calculateOurServiceCost(debtorAmount, authority, canCancel); 
                const potentialSavings = canCancel ? csiCost : 0; // Рассчитываем экономию
                // --- КОНЕЦ ИЗМЕНЕНИЙ ---

                const row = document.createElement('tr');
                row.innerHTML = `
                    <td data-label="${T.labels.debtorNum}">${debtorNum}</td>
                    <td data-label="${T.labels.date}">${debtorDate}</td>
                    <td data-label="${T.labels.amount}">${formatAmount(debtorAmount)}</td>
                    <td data-label="${T.labels.csiCost}">${formatAmount(csiCost)}</td>
                    <td data-label="${T.labels.cancelCost}">${ourServiceCost > 0 ? formatAmount(ourServiceCost) : '0 ₸'}</td> 
                    <td data-label="${T.labels.savings}">${potentialSavings > 0 ? formatAmount(potentialSavings) : '0 ₸'}</td>
                    <td data-label="${T.labels.creditor}">${creditor}</td>
                    <td data-label="${T.labels.organ}">${authority}</td>
                    <td data-label="${T.labels.executor}">${executor}</td>
                    <!-- ИЗМЕНЕНО: Всегда зеленый статус -->
                    <td data-label="${T.labels.status}"><span class="status status-success">${cancellationStatusText}</span></td>
                    <td data-label="${T.details}">
                        <button 
                            class="btn btn-sm btn-info view-details-btn" 
                            data-bs-toggle="modal" 
                            data-bs-target="#debtorDetailsModal" 
                            data-debtor-index="${index}">
                            Подробнее
                        </button>
                    </td>
                `;
                debtorsTableBody.appendChild(row);
            });
            addTableDataLabels(); // Добавляем data-label для адаптивности
        } else {
            debtorsSection.style.display = 'none';
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

        // Показываем блок результатов только если есть хотя бы одна таблица
        results.style.display = (debtors && debtors.length > 0) || (restrictions && restrictions.length > 0) ? 'block' : 'none';
    }

    // НОВАЯ ФУНКЦИЯ для добавления data-label для мобильных
    function addTableDataLabels() {
        const table = document.querySelector('#results table');
        if (!table) return;

        const headers = Array.from(table.querySelectorAll('thead th')).map(th => th.textContent.trim());
        
        table.querySelectorAll('tbody tr').forEach(row => {
            // Пропускаем итоговую строку
            if (row.classList.contains('table-info')) return;

            Array.from(row.querySelectorAll('td')).forEach((td, index) => {
                if (headers[index]) { // Проверяем, есть ли заголовок для этой колонки
                    td.setAttribute('data-label', headers[index]);
                }
            });
        });
    }

    /**
     * Отображение сообщения об ошибке
     */
    function showErrorMessage(message) {
        // Более подробное сообщение по умолчанию
        const defaultError = T.genericErrorLong;
        errorText.textContent = message || defaultError;
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
        const debtorsTableBody = document.querySelector('#debtors-table tbody');
        const restrictionsTableBody = document.querySelector('#restrictions-table tbody');

        // Скрываем контейнер результатов
        if (resultsContainer) {
            resultsContainer.style.display = 'none';
        }
        // Скрываем сообщение об ошибке
        if (errorContainer) {
            errorContainer.classList.add('d-none');
        }
        // Скрываем секции
        if (debtorsSection) {
            debtorsSection.style.display = 'none';
        }
        if (restrictionsSection) {
            restrictionsSection.style.display = 'none';
        }
        // Очищаем ТОЛЬКО тела таблиц
        if (debtorsTableBody) {
            debtorsTableBody.innerHTML = '';
        }
        if (restrictionsTableBody) {
            restrictionsTableBody.innerHTML = '';
        }
    }

    /**
     * Переключение индикатора загрузки
     */
    function toggleLoading(isLoading, message = T.loading) {
        if (!loadingContainer || !loadingMessage || !progressBar || !searchButton) {
            console.error('Не найдены элементы индикатора загрузки');
            return;
        }

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
    if (testDataButton) {
        testDataButton.addEventListener('click', loadTestData);
    }

    // Валидация ввода ИИН (только цифры)
    iinInput.addEventListener('input', function() {
        this.value = this.value.replace(/[^\d]/g, '');
        
        if (this.value.length > 12) {
            this.value = this.value.slice(0, 12);
        }
        
        if (this.value.length === 12 && iinValidation) {
            iinValidation.style.display = 'none';
        }
    });

    // ---- РАСКОММЕНТИРОВАН КОД МОДАЛЬНОГО ОКНА ----
    
    const resultsContainer = document.getElementById('results');
    const debtorDetailsModalElement = document.getElementById('debtorDetailsModal');

    if (resultsContainer && debtorDetailsContent && debtorDetailsModalElement) {
        // Используем делегирование событий для обработки кликов на кнопках
        resultsContainer.addEventListener('click', function(event) {
            // Находим ближайшую кнопку с классом view-details-btn
            const button = event.target.closest('.view-details-btn');
            
            if (button) {
                const debtorIndex = button.getAttribute('data-debtor-index');
                
                // Проверяем наличие данных и индекса
                if (window.currentDebtorsData && window.currentDebtorsData[debtorIndex]) {
                    const debtor = window.currentDebtorsData[debtorIndex]; // debtor - это объект row из API
                    console.log("Loading details for debtor index:", debtorIndex, JSON.stringify(debtor, null, 2)); // Debug

                    // Формируем HTML для деталей (используем dl для лучшей структуры)
                    let detailsHtml = '';
                    // Проверяем, что debtor не пустой объект
                    if (debtor && Object.keys(debtor).length > 0) {
                        detailsHtml = '<dl class="row">';
                        
                        // --- ИЗМЕНЕНО: Определяем порядок и названия полей на основе ключей API ---
                        const fieldsMap = isKz ? {
                            'execProcNum': 'АІЖ нөмірі',
                            'ipStartDate': 'Іс жүргізу басталған күні',
                            'ilDate': 'Атқарушылық құжат күні',
                            'debtorIin': 'Борышкердің ЖСН',
                            'debtorName': 'Борышкердің аты',
                            'debtorSurname': 'Борышкердің тегі',
                            'debtorSecondname': 'Борышкердің әкесінің аты',
                            'debtorBin': 'Борышкердің БСН',
                            'debtorTitle': 'Борышкер атауы (заңды тұлға)',
                            'recovererTitle': 'Өндіріп алушы',
                            'recovererBin': 'Өндіріп алушының БСН',
                            'recovererTypeRu': 'Өндіріп алушы түрі',
                            'ilOrganRu': 'Құжатты берген орган',
                            'categoryRu': 'Санат',
                            'recoveryAmount': 'Өндірілетін сома',
                            'officerSurname': 'Орындаушының тегі',
                            'officerName': 'Орындаушының аты',
                            'officerSecondname': 'Орындаушының әкесінің аты',
                            'disaNameRu': 'Атқарушылық іс жүргізу органы',
                            'disaDepartmentNameRu': 'Атқарушылық іс жүргізу бөлімі',
                            'disaDepartmentAddress': 'Бөлім мекенжайы'
                        } : {
                            'execProcNum': 'Номер ИП',
                            'ipStartDate': 'Дата возбуждения',
                            'ilDate': 'Дата ИД',
                            'debtorIin': 'ИИН Должника',
                            'debtorName': 'Имя Должника',
                            'debtorSurname': 'Фамилия Должника',
                            'debtorSecondname': 'Отчество Должника',
                            'debtorBin': 'БИН Должника',
                            'debtorTitle': 'Наименование Должника (юр.лицо)',
                            'recovererTitle': 'Взыскатель',
                            'recovererBin': 'БИН Взыскателя',
                            'recovererTypeRu': 'Тип взыскателя',
                            'ilOrganRu': 'Орган, выдавший ИД',
                            'categoryRu': 'Категория',
                            'recoveryAmount': 'Сумма взыскания',
                            'officerSurname': 'Фамилия исполнителя',
                            'officerName': 'Имя исполнителя',
                            'officerSecondname': 'Отчество исполнителя',
                            'disaNameRu': 'Орган исполнит. пр-ва',
                            'disaDepartmentNameRu': 'Подразделение исполнит. пр-ва',
                            'disaDepartmentAddress': 'Адрес подразделения'
                        };

                        // Проходим по всем ключам из карты полей
                        for (const key in fieldsMap) {
                            if (debtor.hasOwnProperty(key) && debtor[key] != null && debtor[key] !== '') {
                                let value = debtor[key];
                                let displayKey = fieldsMap[key]; // Название поля

                                // Особая обработка для дат и сумм
                                if (key === 'ipStartDate' || key === 'ilDate' || key === 'banStartDate' || key === 'banEndDate') {
                                    value = formatDate(value);
                                } else if (key === 'recoveryAmount') {
                                    value = formatAmount(value);
                                } else if (key === 'officerSecondname' && Array.isArray(value)) {
                                     // Если Отчество - массив, берем первый элемент (ФИО)
                                     value = value[0] || '-';
                                } else if (typeof value === 'object') {
                                     // Пропускаем вложенные объекты типа ds:Signature
                                     continue;
                                }

                                // Добавляем строку в dl список
                                detailsHtml += `
                                    <dt class="col-sm-4">${displayKey}</dt>
                                    <dd class="col-sm-8">${value || '-'}</dd>
                                `;
                            }
                        }
                        detailsHtml += '</dl>';

                    } else {
                        detailsHtml = '<p class="text-muted">Подробные детали для этого производства отсутствуют.</p>';
                    }
                    
                    // Обновляем содержимое модального окна
                    debtorDetailsContent.innerHTML = detailsHtml;

                } else {
                    console.error('Не удалось найти данные для должника с индексом:', debtorIndex);
                    debtorDetailsContent.innerHTML = '<p class="text-danger">Ошибка: Не удалось загрузить детали.</p>';
                }
            }
        });
    } else {
        console.error('Не найдены элементы resultsContainer, debtorDetailsContent или debtorDetailsModalElement');
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