'use strict';

const REVIEWED_AT = '2026-08-23';
const BANK_ARREST_HUB_PATH = '/arest-scheta-v-bankah-kazahstana';

const BANK_ARREST_PAGES = Object.freeze([
  {
    path: '/arest-kaspi', bankSlug: 'kaspi-bank', bin: '971240001315', brand: 'Kaspi Bank',
    aliases: ['Kaspi', 'Каспи', 'Kaspi Gold'], segment: 'retail', legacyStatic: true, priority: 100,
    context: 'В приложении Kaspi ограничение может выглядеть как недоступность карты, счёта или отдельной суммы. Сначала запросите точное основание и реквизиты документа: одинаковый результат в приложении может быть связан как с исполнительным производством, так и с внутренней проверкой банка.',
    officialSite: 'https://kaspi.kz',
  },
  {
    path: '/arest-halyk-bank', bankSlug: 'halyk-bank', bin: '940140000385', brand: 'Halyk Bank',
    aliases: ['Халык Банк', 'Народный банк', 'Homebank'], segment: 'retail', legacyStatic: true, priority: 99,
    context: 'Проверьте не только карту, но и все счета в Halyk/Homebank: ограничение может относиться к конкретному счёту, сумме либо ко всем счетам, указанным в постановлении. Для правовой оценки нужен сам документ, а не только сообщение приложения.',
    officialSite: 'https://halykbank.kz',
  },
  {
    path: '/arest-freedom-bank', bankSlug: 'freedom-bank', bin: '090740019001', brand: 'Freedom Bank',
    aliases: ['Фридом Банк', 'Freedom SuperApp', 'Банк Фридом Финанс'], segment: 'retail', legacyStatic: true, priority: 96,
    context: 'У Freedom Bank важно отличить арест по внешнему постановлению от ограничений, связанных с проверкой операции, безопасностью или комплаенсом. Попросите банк назвать инициатора, дату и номер документа либо прямо подтвердить, что ограничение внутреннее.',
    officialSite: 'https://bankffin.kz',
  },
  {
    path: '/arest-bank-centercredit', bankSlug: 'bank-centercredit', bin: '980640000093', brand: 'Bank CenterCredit',
    aliases: ['Банк ЦентрКредит', 'БЦК', 'BCC'], segment: 'retail', priority: 98,
    context: 'В приложении BCC.KZ запросите сведения по конкретному счёту и документу, на основании которого ограничены расходные операции. Наличие кредита в БЦК само по себе не доказывает, что именно банк инициировал арест.',
    officialSite: 'https://bcc.kz',
  },
  {
    path: '/arest-fortebank', bankSlug: 'fortebank', bin: '990740000683', brand: 'ForteBank',
    aliases: ['Форте Банк', 'Forte'], segment: 'retail', priority: 95,
    context: 'При ограничении в Forte уточните вид операции: арест остатка, инкассовое списание, приостановление расходных операций либо внутренняя проверка. От этого зависит, кому направлять заявление и какие документы запрашивать.',
    officialSite: 'https://forte.kz',
  },
  {
    path: '/arest-evraziyskiy-bank', bankSlug: 'eurasian-bank', bin: '950240000112', brand: 'Евразийский Банк',
    aliases: ['Eurasian Bank', 'Евразийский банк'], segment: 'retail', priority: 94,
    context: 'Если в Smartbank недоступны деньги, сначала получите реквизиты инициатора ограничения. Не смешивайте арест счёта с удержанием по кредитному договору или технической блокировкой карты: юридические маршруты у этих ситуаций разные.',
    officialSite: 'https://eubank.kz',
  },
  {
    path: '/arest-bereke-bank', bankSlug: 'bereke-bank', bin: '930740000137', brand: 'Bereke Bank',
    aliases: ['Береке Банк', 'бывший Сбербанк Казахстан'], segment: 'retail', priority: 94,
    context: 'Для старых обязательств и счетов учитывайте переименование бывшего Сбербанка Казахстан в Bereke Bank. В документах взыскателя или ЧСИ может встречаться прежнее название — сверяйте БИН и реквизиты банка.',
    officialSite: 'https://berekebank.kz',
  },
  {
    path: '/arest-alatau-city-bank', bankSlug: 'alatau-city-bank', bin: '920140000084', brand: 'Alatau City Bank',
    aliases: ['Jusan Bank', 'Жусан Банк', 'АТФБанк'], segment: 'retail', priority: 93,
    context: 'В старых постановлениях может быть указано прежнее название Jusan Bank или АТФБанк. Для проверки сопоставьте БИН, номер счёта и дату документа, а не ориентируйтесь только на бренд в уведомлении.',
    officialSite: 'https://alataucitybank.kz',
  },
  {
    path: '/arest-bank-rbk', bankSlug: 'bank-rbk', bin: '920440001102', brand: 'Bank RBK',
    aliases: ['РБК Банк', 'RBK'], segment: 'retail', priority: 92,
    context: 'Запрашивайте в Bank RBK не общий ответ «наложен арест», а номер, дату, орган или исполнителя и сумму ограничения. Эти реквизиты позволяют понять, оспаривать ли основание, действия исполнителя или обращаться по другому маршруту.',
    officialSite: 'https://bankrbk.kz',
  },
  {
    path: '/arest-home-credit-bank', bankSlug: 'home-credit-bank', bin: '930540000147', brand: 'Home Credit Bank',
    aliases: ['Хоум Кредит Банк', 'Home Bank'], segment: 'retail', priority: 92,
    context: 'Отдельно проверьте, заблокирована ли банковская карта, текущий счёт или только операция по кредитному продукту. Внешний арест и договорное списание по кредиту требуют разных документов и возражений.',
    officialSite: 'https://home.kz',
  },
  {
    path: '/arest-nurbank', bankSlug: 'nurbank', bin: '930940000164', brand: 'Нурбанк',
    aliases: ['Nurbank', 'Нур Банк'], segment: 'retail', priority: 90,
    context: 'Попросите Нурбанк письменно указать правовое основание ограничения и канал получения документа. Устного ответа колл-центра недостаточно, если предстоит жалоба или обращение в суд.',
    officialSite: 'https://nurbank.kz',
  },
  {
    path: '/arest-otbasy-bank', bankSlug: 'otbasy-bank', bin: '030740001404', brand: 'Отбасы банк',
    aliases: ['Otbasy Bank', 'Жилстройсбербанк', 'ЖССБ'], segment: 'retail', priority: 89,
    context: 'В Отбасы банке важно установить назначение каждого счёта и происхождение средств. Жилищные накопления, текущие счета и специальные выплаты нельзя оценивать одинаково — сначала нужны договор счёта, выписка и постановление.',
    officialSite: 'https://hcsbk.kz',
  },
  {
    path: '/arest-altyn-bank', bankSlug: 'altyn-bank', bin: '980740000057', brand: 'Altyn Bank',
    aliases: ['Алтын Банк'], segment: 'retail', priority: 88,
    context: 'Уточните, ограничена карта, текущий счёт либо конкретный перевод. Если банк ссылается на постановление, запросите его реквизиты; если на проверку операции — попросите перечень документов для комплаенса.',
    officialSite: 'https://altynbank.kz',
  },
  {
    path: '/arest-vtb-bank', bankSlug: 'vtb-bank', bin: '080940010300', brand: 'ВТБ (Казахстан)',
    aliases: ['VTB Bank', 'Банк ВТБ Казахстан'], segment: 'retail', priority: 86,
    context: 'По счетам ВТБ Казахстан проверяйте именно казахстанское юридическое лицо и реквизиты исполнительного документа. Сведения о другом банке группы или ограничениях в иной юрисдикции не заменяют документы по счёту в Казахстане.',
    officialSite: 'https://vtb-bank.kz',
  },
  {
    path: '/arest-kzi-bank', bankSlug: 'kzi-bank', bin: '930140000323', brand: 'KZI Bank',
    aliases: ['Казахстан-Зираат Интернешнл Банк', 'Ziraat Kazakhstan'], segment: 'mixed', priority: 82,
    context: 'KZI Bank обслуживает физических лиц и бизнес. Для корпоративного счёта дополнительно установите, относится ли мера к самой компании, её налоговым обязательствам либо к исполнительному производству; для личного счёта проверьте владельца и назначение поступлений.',
    officialSite: 'https://kzibank.kz',
    fallback: { name: 'АО ДБ «Казахстан-Зираат Интернешнл Банк»', shortName: 'KZI Bank', web: 'kzibank.kz', bin: '930140000323' },
  },
  {
    path: '/arest-bnk-bank', bankSlug: 'bnk-commercial-bank', bin: '180640000680', brand: 'BNK Commercial Bank',
    aliases: ['БиЭнКей', 'BNK Bank'], segment: 'mixed', priority: 81,
    context: 'BNK — сравнительно новый банк на рынке Казахстана. При ограничении счёта фиксируйте дату, канал уведомления и точное наименование инициатора: это особенно важно, если документы оформлялись ещё до преобразования организации в банк.',
    officialSite: 'https://bnkcommercialbank.kz',
    fallback: { name: 'АО «Коммерческий Банк БиЭнКей»', shortName: 'BNK Commercial Bank', web: 'bnkcommercialbank.kz', bin: '180640000680' },
  },
  {
    path: '/arest-kmf-bank', bankSlug: 'kmf-bank', bin: '061240001583', brand: 'KMF Банк',
    aliases: ['КМФ Банк', 'бывшая МФО KMF'], segment: 'mixed', priority: 80,
    context: 'Если обязательство возникло ещё в период работы KMF как МФО, разграничьте кредитора по договору, текущего владельца требования и банк, в котором открыт счёт. Совпадение бренда не означает совпадение ролей в взыскании.',
    officialSite: 'https://kmf.kz',
  },
  {
    path: '/arest-shinhan-bank', bankSlug: 'shinhan-bank', bin: '080240019735', brand: 'Shinhan Bank Kazakhstan',
    aliases: ['Шинхан Банк Казахстан'], segment: 'business', priority: 74,
    context: 'Для бизнес-счёта в Shinhan Bank запросите документ, сумму и охват ограничения, а также проверьте полномочия лица, получившего уведомление от имени компании. Внутренняя комплаенс-проверка не равна исполнительному аресту.',
    officialSite: 'https://shinhan.kz',
  },
  {
    path: '/arest-bank-of-china-kazakhstan', bankSlug: 'bank-of-china', bin: '930440000156', brand: 'Bank of China Kazakhstan',
    aliases: ['Банк Китая в Казахстане'], segment: 'business', priority: 72,
    context: 'При международных и корпоративных операциях отдельно проверьте, не связано ли ограничение с валютным контролем, санкционной или комплаенс-проверкой. Для исполнительного ареста банк должен назвать внешний документ и инициатора.',
    officialSite: 'https://boc.kz',
  },
  {
    path: '/arest-icbc-kazakhstan', bankSlug: 'icbc-kazakhstan', bin: '930340001235', brand: 'ICBC Kazakhstan',
    aliases: ['Торгово-промышленный Банк Китая в Алматы', 'ICBC'], segment: 'business', priority: 72,
    context: 'По корпоративным счетам ICBC нужно разделить исполнительное ограничение, налоговое приостановление и банковский комплаенс. Запросите официальный ответ с видом меры и реквизитами документа.',
    officialSite: 'https://kz.icbc.com.cn',
  },
  {
    path: '/arest-citibank-kazakhstan', bankSlug: 'citibank-kazakhstan', bin: '980540003232', brand: 'Citibank Kazakhstan',
    aliases: ['Ситибанк Казахстан', 'Citi Kazakhstan'], segment: 'business', priority: 71,
    context: 'Citibank в Казахстане ориентирован прежде всего на корпоративное обслуживание. Для счёта компании проверьте исполнительный, налоговый, валютный и комплаенс-контуры отдельно — один общий запрос «почему заблокирован счёт» не даст достаточной правовой основы.',
    officialSite: 'https://www.citigroup.com/citi/about/countrypresence/kazakhstan.html',
  },
  {
    path: '/arest-adcb-kazakhstan', bankSlug: 'adcb-kazakhstan', bin: '100140011772', brand: 'ADCB Islamic Bank Kazakhstan',
    aliases: ['Исламский Банк ADCB', 'Al Hilal Bank Kazakhstan'], segment: 'islamic', priority: 70,
    context: 'Принципы исламского финансирования влияют на договор продукта, но внешнее ограничение счёта всё равно нужно проверять по инициатору и документу. Не смешивайте спор по финансированию с действиями банка по исполнению внешней меры.',
    officialSite: 'https://www.adcb.com/en/kazakhstan',
  },
  {
    path: '/arest-zaman-bank', bankSlug: 'zaman-bank', bin: '910640000060', brand: 'Zaman Bank',
    aliases: ['Заман-Банк', 'Исламский банк Заман'], segment: 'islamic', priority: 70,
    context: 'Для счёта в Zaman Bank сначала выясните вид продукта и источник ограничения. Условия исламского договора важны для спора о задолженности, но сам факт ареста подтверждается постановлением либо другим официальным документом.',
    officialSite: 'https://zamanbank.kz',
  },
].map(page => Object.freeze({ ...page, reviewedAt: REVIEWED_AT })));

const BANK_ARREST_PATH_SET = new Set(BANK_ARREST_PAGES.map(page => page.path));

function normalize(value) {
  return String(value || '').toLocaleLowerCase('ru-RU').replace(/[^a-zа-яё0-9]+/gi, ' ').trim();
}

function getBankArrestPageByPath(pathname) {
  return BANK_ARREST_PAGES.find(page => page.path === pathname) || null;
}

function findBankRecord(page, banks) {
  const records = Array.isArray(banks) ? banks : [];
  const match = records.find(bank =>
    (page.bin && bank.bin === page.bin)
    || (page.bankSlug && bank.slug === page.bankSlug)
    || normalize(bank.shortName || bank.name) === normalize(page.brand)
  );
  return match || { ...(page.fallback || {}), slug: page.bankSlug, shortName: page.brand, name: page.brand, bin: page.bin, web: page.officialSite };
}

function getRelatedBankArrestPages(page, limit = 6) {
  return BANK_ARREST_PAGES
    .filter(item => item.path !== page.path)
    .sort((a, b) => {
      const aSame = a.segment === page.segment ? 1 : 0;
      const bSame = b.segment === page.segment ? 1 : 0;
      return (bSame - aSame) || (b.priority - a.priority);
    })
    .slice(0, limit);
}

function getBankArrestPathForBank(bank) {
  if (!bank) return BANK_ARREST_HUB_PATH;
  const match = BANK_ARREST_PAGES.find(page =>
    (bank.bin && page.bin === bank.bin)
    || (bank.slug && page.bankSlug === bank.slug)
    || normalize(bank.shortName || bank.name) === normalize(page.brand)
  );
  return match ? match.path : BANK_ARREST_HUB_PATH;
}

module.exports = {
  REVIEWED_AT,
  BANK_ARREST_HUB_PATH,
  BANK_ARREST_PAGES,
  BANK_ARREST_PATH_SET,
  getBankArrestPageByPath,
  findBankRecord,
  getRelatedBankArrestPages,
  getBankArrestPathForBank,
};
