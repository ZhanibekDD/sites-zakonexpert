'use strict';

const STATIC_SITE_PAGES = Object.freeze([
  { title: 'Компании Казахстана', description: 'Поиск организаций по названию, БИН, руководителю, адресу и виду деятельности.', url: '/companies', keywords: 'тоо ао ип организация контрагент юридическое лицо' },
  { title: 'Проверка контрагента по БИН', description: 'Сведения КГД, регистрационные данные и открытые источники по организации.', url: '/proverka-kontragenta', keywords: 'кгд бин налоги благонадежность компания' },
  { title: 'Нотариусы Казахстана', description: 'Каталог и поиск нотариусов по ФИО и региону.', url: '/notaries', keywords: 'нотариус лицензия палата' },
  { title: 'Поиск нотариуса', description: 'Быстрый поиск карточки нотариуса.', url: '/notary-search', keywords: 'фио адрес телефон лицензия' },
  { title: 'Частные судебные исполнители', description: 'Реестр ЧСИ Казахстана с поиском по ФИО и региону.', url: '/bailiffs', keywords: 'чси судебный исполнитель взыскание' },
  { title: 'Поиск ЧСИ', description: 'Быстрый поиск карточки частного судебного исполнителя.', url: '/bailiff-search', keywords: 'фио адрес телефон лицензия' },
  { title: 'Банки Казахстана', description: 'Каталог банков: БИН, адреса, телефоны и официальные сайты.', url: '/banks', keywords: 'банк бву кредит счет карта' },
  { title: 'МФО Казахстана', description: 'Реестр микрофинансовых организаций.', url: '/mfo', keywords: 'мфо мко микрокредит займ' },
  { title: 'Ломбарды Казахстана', description: 'Реестр ломбардов с регистрационными сведениями.', url: '/lombards', keywords: 'ломбард залог займ' },
  { title: 'Коллекторские агентства', description: 'Действующие коллекторские агентства Казахстана.', url: '/collectors', keywords: 'коллектор взыскание долг реестр' },
  { title: 'Суды Казахстана', description: 'Каталог судов по регионам и уровням.', url: '/courts', keywords: 'суд судья адрес канцелярия' },
  { title: 'Палаты нотариусов и ЧСИ', description: 'Региональные нотариальные палаты и палаты судебных исполнителей.', url: '/chambers', keywords: 'палата нотариальная чси регион' },
  { title: 'Государственные судебные исполнители', description: 'Департаменты юстиции и контакты ГСИ по регионам.', url: '/gsi', keywords: 'гси департамент юстиции исполнитель' },
  { title: 'Страховые компании Казахстана', description: 'Каталог страховых организаций.', url: '/insurance', keywords: 'страховая страховка компания' },
  { title: 'Законы Республики Казахстан', description: 'Поиск по статьям УК, УПК, КоАП, ГК, СК и ТК РК.', url: '/statyi', keywords: 'кодекс статья закон норма право' },
  { title: 'Новости', description: 'Новости законодательства, судов, банков, нотариусов и исполнительного производства.', url: '/news', keywords: 'новости изменения закон' },
  { title: 'Инструменты', description: 'Правовые калькуляторы, проверки и интерактивные помощники.', url: '/tools', keywords: 'калькулятор проверка расчет сервис' },
  { title: 'Открытые данные Казахстана', description: 'Официальные наборы data.egov.kz с поиском и просмотром записей.', url: '/otkrytye-dannye', keywords: 'егов данные реестр набор статистика' },
  { title: 'Проверка банкротства', description: 'Проверка сведений о внесудебном банкротстве.', url: '/proverka-bankrotstva', keywords: 'банкрот должник иин тазалау' },
  { title: 'Снятие ареста со счёта или карты', description: 'Порядок действий при аресте банковского счёта.', url: '/snyatie-aresta-so-scheta', keywords: 'арест счет карта банк чси' },
  { title: 'Ограничения ЧСИ', description: 'Что делать с арестами и ограничениями судебного исполнителя.', url: '/snyatie-ogranichenii-chsi', keywords: 'чси арест запрет ограничение' },
  { title: 'Отмена исполнительной надписи', description: 'Возражение и порядок отмены исполнительной надписи нотариуса.', url: '/otmena-ispolnitelnoi-nadpisi', keywords: 'нотариус надпись возражение долг' },
  { title: 'График оплаты задолженности', description: 'Варианты согласования графика погашения долга.', url: '/grafik-oplaty-zadolzhennosti', keywords: 'рассрочка платеж долг график' },
  { title: 'Маршрут должника', description: 'Пошаговый помощник по долгам, арестам и исполнительному производству.', url: '/marshrut-dolzhnika', keywords: 'долг должник инструкция помощник' },
  { title: 'Услуги ZakonExpert', description: 'Юридические услуги по исполнительному производству и ограничениям.', url: '/services', keywords: 'юрист помощь консультация' },
  { title: 'Адвокат', description: 'Информация об адвокате и направлениях работы.', url: '/advocate', keywords: 'адвокат защита уголовное гражданское дело' },
  { title: 'Медиатор', description: 'Медиация и внесудебное урегулирование споров.', url: '/mediator', keywords: 'медиация спор соглашение' },
  { title: 'Документы', description: 'Образцы и правовые документы.', url: '/dokumenty', keywords: 'документ заявление образец скачать' },
  { title: 'Результаты работы', description: 'Опубликованные результаты и документы по завершённым делам.', url: '/rezultaty', keywords: 'результат дело решение' },
]);

function normalizeSearchQuery(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, 120);
}

function normalizeText(value) {
  return String(value == null ? '' : value)
    .normalize('NFKC')
    .toLocaleLowerCase('ru-RU')
    .replace(/ё/g, 'е')
    .replace(/\s+/g, ' ')
    .trim();
}

function getValue(item, accessor) {
  if (typeof accessor === 'function') return accessor(item);
  return item?.[accessor];
}

function scoreItem(title, searchText, query) {
  const normalizedTitle = normalizeText(title);
  const normalizedSearchText = normalizeText(searchText);
  const normalizedQuery = normalizeText(query);
  if (!normalizedQuery) return 0;

  const terms = normalizedQuery.split(' ').filter(Boolean);
  if (!terms.every(term => normalizedSearchText.includes(term))) return 0;
  if (normalizedTitle === normalizedQuery) return 120;
  if (normalizedTitle.startsWith(normalizedQuery)) return 100;
  if (normalizedTitle.includes(normalizedQuery)) return 85;
  if (normalizedSearchText.includes(normalizedQuery)) return 65;
  return 40 + terms.filter(term => normalizedTitle.includes(term)).length * 8;
}

function searchItems(items, query, options = {}) {
  const cleanQuery = normalizeSearchQuery(query);
  if (cleanQuery.length < 2 || !Array.isArray(items)) return [];
  const limit = Math.max(1, Math.min(Number(options.limit) || 8, 30));
  const titleAccessor = options.title || 'title';
  const descriptionAccessor = options.description || 'description';
  const urlAccessor = options.url || 'url';
  const keywordsAccessor = options.keywords || 'keywords';

  return items.map(item => {
    const title = String(getValue(item, titleAccessor) || '').trim();
    const description = String(getValue(item, descriptionAccessor) || '').replace(/\s+/g, ' ').trim();
    const url = String(getValue(item, urlAccessor) || '').trim();
    const keywords = getValue(item, keywordsAccessor);
    const searchText = [title, description, Array.isArray(keywords) ? keywords.join(' ') : keywords]
      .filter(Boolean)
      .join(' ');
    return {
      score: scoreItem(title, searchText, cleanQuery),
      title,
      description,
      url,
    };
  }).filter(result => result.score > 0 && result.title && result.url)
    .sort((left, right) => right.score - left.score || left.title.localeCompare(right.title, 'ru'))
    .slice(0, limit)
    .map(({ score, ...result }) => result);
}

function searchStaticPages(query, limit = 10) {
  return searchItems(STATIC_SITE_PAGES, query, { limit });
}

module.exports = {
  STATIC_SITE_PAGES,
  normalizeSearchQuery,
  normalizeText,
  searchItems,
  searchStaticPages,
};
