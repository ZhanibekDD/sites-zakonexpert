'use strict';

const path = require('path');
const fs = require('fs');
const { applyRegistryPrivacyOverride } = require('../modules/registry-privacy');
const { ROOT_DIR } = require('./paths');

function createCatalogData() {
  // ===== SLUGIFY =====
  function slugify(s) {
    const cyr = {
      'а':'a','б':'b','в':'v','г':'g','д':'d','е':'e','ё':'yo','ж':'zh','з':'z',
      'и':'i','й':'y','к':'k','л':'l','м':'m','н':'n','о':'o','п':'p','р':'r',
      'с':'s','т':'t','у':'u','ф':'f','х':'kh','ц':'ts','ч':'ch','ш':'sh',
      'щ':'shch','ъ':'','ы':'y','ь':'','э':'e','ю':'yu','я':'ya',
      'қ':'k','ң':'n','ғ':'g','ү':'u','ұ':'u','ө':'o','һ':'h','і':'i','ә':'a',
    };
    return String(s).toLowerCase()
      .replace(/./g, ch => (cyr[ch] !== undefined ? cyr[ch] : ch))
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .substring(0, 80);
  }

  // ===== BANKS DATA =====
  const BANKS_DATA = [
    { slug:'halyk-bank', name:'Народный Банк Казахстана', shortName:'Halyk Bank', tag:'', city:'г. Алматы', address:'пр. Аль-Фараби, 40', phone:'+7 (727) 259-07-77', phoneRaw:'+77272590777', phoneShort:'7111 (физ.) · 9595 (юр.)', email:'info@halykbank.kz', web:'halykbank.kz', bin:'940140000385', chairman:'Шаяхметова Умут Болатовна', note:'Крупнейший частный банк Казахстана' },
    { slug:'kaspi-bank', name:'Kaspi Bank', shortName:'Kaspi Bank', tag:'', city:'г. Алматы', address:'ул. Наурызбай батыра, 154А', phone:'+7 (727) 258-59-55', phoneRaw:'+77272585955', phoneShort:'9999 (моб.) · 8-800-080-18-00', email:'office@kaspi.kz', web:'kaspibank.kz', bin:'971240001315', chairman:'Миронов Павел Владимирович', note:'Онлайн-банкинг, рассрочка, кредиты, e-commerce' },
    { slug:'bank-centercredit', name:'Банк ЦентрКредит', shortName:'Bank CenterCredit (БЦК)', tag:'', city:'г. Алматы', address:'пр. Аль-Фараби, 38', phone:'505 (физ.) · 605 (бизнес)', phoneRaw:'', phoneShort:'', email:'info@bcc.kz', web:'bcc.kz', bin:'980640000093', chairman:'Владимиров Руслан Владимирович', note:'Универсальный банк, кредиты и депозиты' },
    { slug:'otbasy-bank', name:'Отбасы банк', shortName:'Otbasy Bank', tag:'Государственный', city:'г. Астана', address:'пр. Мәңгілік Ел, 55А', phone:'+7 (727) 330-93-00', phoneRaw:'+77273309300', phoneShort:'300 (моб.) · 8-8000-801-880', email:'mail@hcsbk.kz', web:'hcsbk.kz', bin:'030740001404', chairman:'Ибрагимова Ляззат Еркеновна', note:'Жилищный строительный сберегательный банк (ЖССБ)' },
    { slug:'fortebank', name:'ForteBank', shortName:'ForteBank', tag:'', city:'г. Астана', address:'ул. Достык, 8/1', phone:'+7 (727) 258-40-40', phoneRaw:'+77272584040', phoneShort:'7575 (физ.) · 55575 (бизнес)', email:'info@fortebank.com', web:'forte.kz', bin:'990740000683', chairman:'Куанышев Талгат Жуманович', note:'Кредиты и банковское обслуживание' },
    { slug:'bank-razvitiya-kazakhstana', name:'Банк Развития Казахстана', shortName:'БРК', tag:'Банк развития', city:'г. Астана', address:'пр. Мәңгілік Ел, 55А', phone:'+7 (7172) 79-26-00', phoneRaw:'+77172792600', phoneShort:'1408', email:'info@kdb.kz', web:'kdb.kz', bin:'010540001007', chairman:'Елибаев Марат Талгатович', note:'Государственный банк развития. Финансирует инфраструктуру и индустрию. Физических лиц не обслуживает.' },
    { slug:'eurasian-bank', name:'Евразийский Банк', shortName:'Eurasian Bank', tag:'', city:'г. Алматы', address:'ул. Кунаева, 56', phone:'+7 (727) 332-77-22', phoneRaw:'+77273327722', phoneShort:'+7 (771) 000-77-22', email:'info@eubank.kz', web:'eubank.kz', bin:'950240000112', chairman:'Сатиева Ляззат Адыловна', note:'Универсальный банк, потребительское кредитование' },
    { slug:'alatau-city-bank', name:'Alatau City Bank', shortName:'Alatau City Bank', tag:'', city:'г. Алматы', address:'пр. Нурсултан Назарбаев, 242', phone:'+7 (727) 258-77-11', phoneRaw:'+77272587711', phoneShort:'7711', email:'info@alataucitybank.kz', web:'alataucitybank.kz', bin:'920140000084', chairman:'Куандыков Ануар', note:'Бывший Jusan Bank (ранее АТФ Банк). Переименован 16.06.2025' },
    { slug:'bank-rbk', name:'Bank RBK', shortName:'Bank RBK', tag:'', city:'г. Алматы', address:'пл. Республики, 15', phone:'+7 (727) 330-90-30', phoneRaw:'+77273309030', phoneShort:'7888 (физ.) · 7222 (юр.)', email:'info@bankrbk.kz', web:'bankrbk.kz', bin:'920440001102', chairman:'Акентьева Наталья Евгеньевна', note:'Корпоративное и розничное обслуживание' },
    { slug:'bereke-bank', name:'Bereke Bank', shortName:'Bereke Bank', tag:'', city:'г. Алматы', address:'пр. Аль-Фараби, 13/1', phone:'5030 (физ.) · 7744 (бизнес)', phoneRaw:'', phoneShort:'8-8000-80-60-60', email:'post@berekebank.kz', web:'berekebank.kz', bin:'930740000137', chairman:'Тимченко Андрей Игоревич', note:'Бывший Сбербанк Казахстан' },
    { slug:'freedom-bank', name:'Freedom Bank Kazakhstan', shortName:'Freedom Bank', tag:'', city:'г. Алматы', address:'ул. Курмангазы, 61А', phone:'595 (короткий)', phoneRaw:'', phoneShort:'WhatsApp: +7 (776) 159-55-95', email:'', web:'bankffin.kz', bin:'090740019001', chairman:'Ахметова Гульфайруз', note:'Бывший Bank Kassa Nova / Банк Фридом Финанс. Переименован 20.05.2024' },
    { slug:'altyn-bank', name:'Altyn Bank', shortName:'Altyn Bank', tag:'Иностранный', city:'г. Алматы', address:'пр. Абая, 109В', phone:'+7 (727) 356-57-77', phoneRaw:'+77273565777', phoneShort:'+7 (727) 259-69-22 (юр.)', email:'info@altynbank.kz', web:'altynbank.kz', bin:'980740000057', chairman:'Байсынов Мурат', note:'Дочерний банк China CITIC Bank Corporation' },
    { slug:'home-credit-bank', name:'Home Credit Bank', shortName:'Home Credit Bank', tag:'', city:'г. Алматы', address:'ул. Зеина Шашкина, 1/1', phone:'+7 (727) 244-54-84', phoneRaw:'+77272445484', phoneShort:'7979', email:'info@homecredit.kz', web:'home.kz', bin:'930540000147', chairman:'Нурумбет Шолпан', note:'Потребительские кредиты и рассрочка. Дочерний банк ForteBank' },
    { slug:'nurbank', name:'Нурбанк', shortName:'Nurbank', tag:'', city:'г. Алматы', address:'пр. Абая, 10В', phone:'+7 (727) 244-44-44', phoneRaw:'+77272444444', phoneShort:'2552', email:'info_nur@nurbank.kz', web:'nurbank.kz', bin:'930940000164', chairman:'Мажуга Алексей Николаевич', note:'Кредиты и вклады для физических и юридических лиц' },
    { slug:'shinhan-bank', name:'Shinhan Bank Казахстан', shortName:'Shinhan Bank', tag:'Иностранный', city:'г. Алматы', address:'пр. Достык, 38', phone:'+7 (727) 356-96-00', phoneRaw:'+77273569600', phoneShort:'', email:'infokz@shinhan.com', web:'shinhan.kz', bin:'080240019735', chairman:'Чжо Ёнг Ын', note:'Дочерний банк Shinhan Financial Group (Республика Корея)' },
    { slug:'bank-of-china', name:'Банк Китая в Казахстане', shortName:'Bank of China', tag:'Иностранный', city:'г. Алматы', address:'мкр-н Жетысу-2, 71Б', phone:'+7 (727) 258-55-10', phoneRaw:'+77272585510', phoneShort:'', email:'', web:'boc.kz', bin:'930440000156', chairman:'Хоу Юаньмин', note:'Дочерний банк Bank of China Limited' },
    { slug:'icbc-kazakhstan', name:'ICBC Казахстан', shortName:'ICBC Kazakhstan', tag:'Иностранный', city:'г. Алматы', address:'пр. Абая, 150/230', phone:'+7 (727) 237-70-72', phoneRaw:'+77272377072', phoneShort:'+7 (727) 237-70-83 (юр.)', email:'office@kz.icbc.com.cn', web:'kz.icbc.com.cn', bin:'930340001235', chairman:'Люй Хунхай', note:'Торгово-промышленный банк Китая в г. Алматы' },
    { slug:'vtb-bank', name:'ВТБ (Казахстан)', shortName:'VTB Bank', tag:'Иностранный', city:'г. Алматы', address:'ул. Тимирязева, 26/29', phone:'+7 (727) 330-50-50', phoneRaw:'+77273305050', phoneShort:'5050', email:'info@vtb-bank.kz', web:'vtb-bank.kz', bin:'080940010300', chairman:'Забелло Дмитрий Александрович', note:'Дочерний банк ВТБ (Россия)' },
    { slug:'adcb-kazakhstan', name:'Исламский банк ADCB', shortName:'ADCB Kazakhstan', tag:'Исламский', city:'г. Алматы', address:'пр. Аль-Фараби, 77/7, БЦ Esentai Tower', phone:'+7 (727) 233-00-00', phoneRaw:'+77272330000', phoneShort:'', email:'adcbk.reception@adcb.com', web:'adcb.com/kazakhstan', bin:'100140011772', chairman:'Гордон Джеймс Хаскинс', note:'Исламский банкинг. Бывший Al Hilal Bank, переименован 21.10.2024' },
    { slug:'zaman-bank', name:'Заман-Банк', shortName:'Zaman Bank', tag:'Исламский', city:'г. Астана', address:'пр. Рақымжан Қошқарбаев, 1а', phone:'+7 (7172) 26-20-26', phoneRaw:'+77172262026', phoneShort:'+7 (727) 355-65-75 (Алматы) · 4077', email:'info@zamanbank.kz', web:'zamanbank.kz', bin:'910640000060', chairman:'Асаева Гульфайруз Ерлановна', note:'Исламский банк, работает по принципам шариата' },
    { slug:'kmf-bank', name:'KMF Банк', shortName:'KMF Bank', tag:'Специализированный', city:'г. Алматы', address:'пр. Нұрсұлтан Назарбаев, 50', phone:'+7 (727) 331-74-74', phoneRaw:'+77273317474', phoneShort:'', email:'info@kmf.kz', web:'kmf.kz', bin:'061240001583', chairman:'Жусупов Шалкар Амангосович', note:'Бывшая МФО KMF. Конвертирована в банк 12.08.2025. Кредитование МСБ и физлиц' },
    { slug:'kzi-bank', name:'Казахстан-Зираат Интернешнл Банк', shortName:'KZI Bank', tag:'Иностранный', city:'г. Алматы', address:'ул. Наурызбай батыра, 17А', phone:'+7 (727) 244-19-93', phoneRaw:'+77272441993', phoneShort:'9193 · +7 (727) 244-40-00', email:'kzibank@kzibank.kz', web:'kzibank.kz', bin:'930140000323', chairman:'', note:'Дочерний банк Ziraat Bankası. Обслуживает физических и юридических лиц' },
    { slug:'bnk-commercial-bank', name:'Коммерческий Банк БиЭнКей', shortName:'BNK Commercial Bank', tag:'Иностранный', city:'г. Алматы', address:'ул. Ауэзова, 60', phone:'5210', phoneRaw:'', phoneShort:'Бесплатный звонок по Казахстану', email:'info@bnkcommercialbank.kz', web:'bnkcommercialbank.kz', bin:'180640000680', chairman:'Ким Сонгхён', note:'Банковская лицензия № 1.1.118 от 25.06.2025' },
    { slug:'citibank-kazakhstan', name:'Ситибанк Казахстан', shortName:'Citibank Kazakhstan', tag:'Иностранный', city:'г. Алматы', address:'ул. Зенкова, 26/41', phone:'+7 (727) 332-14-00', phoneRaw:'+77273321400', phoneShort:'+7 (717) 255-76-00 (Астана)', email:'citibank.kazakhstan@citi.com', web:'citibank.com/kazakhstan', bin:'980540003232', chairman:'Жакаева Сауле', note:'Международный банк Citigroup, корпоративное обслуживание' },
  ];

  // ===== COURTS DATA =====
  const COURTS_DATA = [
    { slug:'verkhovny-sud', region:'г. Астана', level:'Верховный суд', name:'Верховный суд Республики Казахстан', address:'пр. Мангилик Ел, 55', phone:'+7 (7172) 75-31-97', phoneRaw:'+77172753197', email:'vsrk@sud.gov.kz', web:'sud.gov.kz' },
    { slug:'astana', region:'г. Астана', level:'Апелляционный', name:'Суд города Астана', address:'ул. Бейбітшілік, 6', phone:'+7 (7172) 22-00-00', phoneRaw:'+77172220000', email:'astana@sud.gov.kz', web:'sud.gov.kz' },
    { slug:'almaty', region:'г. Алматы', level:'Апелляционный', name:'Алматинский городской суд', address:'пр. Абая, 14', phone:'+7 (727) 261-88-00', phoneRaw:'+77272618800', email:'almaty@sud.gov.kz', web:'sud.gov.kz' },
    { slug:'shymkent', region:'г. Шымкент', level:'Апелляционный', name:'Шымкентский городской суд', address:'ул. Байтурсынова, 7', phone:'+7 (725) 253-12-00', phoneRaw:'+77252531200', email:'shymkent@sud.gov.kz', web:'sud.gov.kz' },
    { slug:'akmola', region:'Акмолинская область', level:'Апелляционный', name:'Акмолинский областной суд', address:'г. Кокшетау, ул. Абая, 83', phone:'+7 (716) 230-50-00', phoneRaw:'+77162305000', email:'akmola@sud.gov.kz', web:'sud.gov.kz' },
    { slug:'aktobe', region:'Актюбинская область', level:'Апелляционный', name:'Актюбинский областной суд', address:'г. Актобе, ул. Алтынсарина, 22', phone:'+7 (713) 215-50-00', phoneRaw:'+77132155000', email:'aktobe@sud.gov.kz', web:'sud.gov.kz' },
    { slug:'almaty-obl', region:'Алматинская область', level:'Апелляционный', name:'Алматинский областной суд', address:'г. Талдыкорган, ул. Тайманова, 58', phone:'+7 (728) 222-34-00', phoneRaw:'+77282223400', email:'almaty_obl@sud.gov.kz', web:'sud.gov.kz' },
    { slug:'atyrau', region:'Атырауская область', level:'Апелляционный', name:'Атырауский областной суд', address:'г. Атырау, ул. Есет Батыра, 11', phone:'+7 (712) 222-05-00', phoneRaw:'+77122220500', email:'atyrau@sud.gov.kz', web:'sud.gov.kz' },
    { slug:'vko', region:'Восточно-Казахстанская область', level:'Апелляционный', name:'ВКО областной суд', address:'г. Усть-Каменогорск, ул. Казахстан, 131', phone:'+7 (723) 222-46-00', phoneRaw:'+77232224600', email:'vko@sud.gov.kz', web:'sud.gov.kz' },
    { slug:'zhambyl', region:'Жамбылская область', level:'Апелляционный', name:'Жамбылский областной суд', address:'г. Тараз, ул. Толстого, 112', phone:'+7 (726) 243-70-00', phoneRaw:'+77262437000', email:'zhambyl@sud.gov.kz', web:'sud.gov.kz' },
    { slug:'zko', region:'ЗКО (Уральск)', level:'Апелляционный', name:'Западно-Казахстанский областной суд', address:'г. Уральск, ул. Дружбы, 177', phone:'+7 (711) 222-31-00', phoneRaw:'+77112223100', email:'zko@sud.gov.kz', web:'sud.gov.kz' },
    { slug:'karaganda', region:'Карагандинская область', level:'Апелляционный', name:'Карагандинский областной суд', address:'г. Каpаганда, ул. Ерубаева, 47', phone:'+7 (721) 242-53-00', phoneRaw:'+77212425300', email:'karaganda@sud.gov.kz', web:'sud.gov.kz' },
    { slug:'kostanay', region:'Костанайская область', level:'Апелляционный', name:'Костанайский областной суд', address:'г. Костанай, ул. Байтурсынова, 70', phone:'+7 (714) 254-07-00', phoneRaw:'+77142540700', email:'kostanay@sud.gov.kz', web:'sud.gov.kz' },
    { slug:'kyzylorda', region:'Кызылординская область', level:'Апелляционный', name:'Кызылординский областной суд', address:'г. Кызылорда, пр. Бейбарыса, 39', phone:'+7 (724) 226-40-00', phoneRaw:'+77242264000', email:'kyzylorda@sud.gov.kz', web:'sud.gov.kz' },
    { slug:'mangistau', region:'Мангистауская область', level:'Апелляционный', name:'Мангистауский областной суд', address:'г. Актау, 13-й мкр.', phone:'+7 (729) 232-32-00', phoneRaw:'+77292323200', email:'mangistau@sud.gov.kz', web:'sud.gov.kz' },
    { slug:'pavlodar', region:'Павлодарская область', level:'Апелляционный', name:'Павлодарский областной суд', address:'г. Павлодар, ул. Академика Сатпаева, 28', phone:'+7 (718) 232-62-00', phoneRaw:'+77182326200', email:'pavlodar@sud.gov.kz', web:'sud.gov.kz' },
    { slug:'sko', region:'СКО (Петропавловск)', level:'Апелляционный', name:'Северо-Казахстанский областной суд', address:'г. Петропавловск, ул. Конституции Казахстана, 25', phone:'+7 (715) 246-40-00', phoneRaw:'+77152464000', email:'sko@sud.gov.kz', web:'sud.gov.kz' },
    { slug:'turkestan', region:'Туркестанская область', level:'Апелляционный', name:'Туркестанский областной суд', address:'г. Туркестан, ул. Жибек жолы, 2', phone:'+7 (725) 333-22-00', phoneRaw:'+77253332200', email:'turkestan@sud.gov.kz', web:'sud.gov.kz' },
    { slug:'abay', region:'Абайская область', level:'Апелляционный', name:'Абайский областной суд', address:'г. Семей, ул. Дулатова, 57', phone:'+7 (722) 252-52-00', phoneRaw:'+77222525200', email:'abay@sud.gov.kz', web:'sud.gov.kz' },
    { slug:'zhetisu', region:'Жетысуская область', level:'Апелляционный', name:'Жетысуский областной суд', address:'г. Талдыкорган, ул. Жансугурова, 131', phone:'+7 (728) 225-09-00', phoneRaw:'+77282250900', email:'zhetisu@sud.gov.kz', web:'sud.gov.kz' },
    { slug:'ulytau', region:'Улытауская область', level:'Апелляционный', name:'Улытауский областной суд', address:'г. Жезказган, ул. Жангельдина, 1', phone:'+7 (710) 260-20-00', phoneRaw:'+77102602000', email:'ulytau@sud.gov.kz', web:'sud.gov.kz' },
  ];

  // ===== CSV-BACKED: BANKS =====
  let _banksCache = null;
  function getBanksData() {
    if (_banksCache) return _banksCache;
    const staticByBin = {};
    BANKS_DATA.forEach(b => { staticByBin[b.bin] = b; });
    const rows = parseSemicolonCSV(path.join(ROOT_DIR, 'Банки_Казахстана.csv'));
    _banksCache = rows.map(r => {
      const fullName = r['Банк (официальное название)'] || '';
      const bin = (r['БИН'] || '').trim();
      if (!bin) return null;
      const existing = staticByBin[bin] || {};
      // Extract shortName from trailing parentheses
      const parenM = fullName.match(/\(([^)]+)\)$/);
      let shortName = parenM ? parenM[1].trim() : '';
      if (/^бывш\.|^гос\.|^не бву/i.test(shortName)) shortName = '';
      if (!shortName) {
        const aoM = fullName.match(/(?:АО|ДБ АО|ДО АО|АО ДБ)\s+"([^"]+)"/);
        shortName = aoM ? aoM[1].trim() : fullName.replace(/^АО\s+/, '').replace(/^"|"$/g,'').trim();
      }
      const name = fullName.replace(/^(?:АО|ДБ АО|ДО АО|АО ДБ)\s+"/, '').replace(/"[^"]*$/, '').replace(/\s*\([^)]*\)$/, '').replace(/^"|"$/g,'').trim() || existing.name;
      const emailM = (r['Email'] || '').match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/);
      const phone = (r['Телефон'] || '').trim();
      const phoneRawM = phone.match(/\+7[\s\d\-\(\)]{8,}/);
      let phoneRaw = '';
      if (phoneRawM) {
        const raw = '+7' + phoneRawM[0].slice(2).replace(/[^\d]/g, '');
        if (raw.length === 12) phoneRaw = raw;
      }
      const address = (r['Адрес головного офиса'] || '').trim();
      const ci = address.indexOf(',');
      return {
        slug: existing.slug || slugify(shortName || name) || 'bank-' + bin,
        name, shortName: shortName || name,
        tag: existing.tag || '',
        city: ci > -1 ? address.substring(0, ci).trim() : address,
        address: ci > -1 ? address.substring(ci + 1).trim() : address,
        phone,
        phoneRaw: phoneRaw || existing.phoneRaw || '',
        email: emailM ? emailM[0] : '',
        web: (r['Сайт'] || existing.web || '').trim(),
        bin,
        chairman: (r['Председатель Правления (ФИО)'] || existing.chairman || '').trim(),
        note: cleanScrapedNote(r['Примечание']) || existing.note || '',
      };
    }).filter(Boolean);
    return _banksCache;
  }

  // ===== CSV-BACKED: COURTS =====
  let _courtsCache = null;
  function getCourtsData() {
    if (_courtsCache) return _courtsCache;
    const rows = parseSemicolonCSV(path.join(ROOT_DIR, 'Суды_Казахстана.csv'));
    const seen = {};
    _courtsCache = rows.map(r => {
      const name = (r['Название суда'] || '').trim();
      if (!name) return null;
      let base = slugify(name) || 'court';
      if (!seen[base]) { seen[base] = 1; } else { seen[base]++; base += '-' + seen[base]; }
      const phoneStr = (r['Телефоны'] || '').split(/[,;]/)[0].trim();
      const digits = phoneStr.replace(/[^\d]/g, '');
      let phoneRaw = '';
      if (digits.length === 11) phoneRaw = '+7' + digits.slice(1);
      else if (digits.length === 10) phoneRaw = '+7' + digits;
      return {
        slug: base, name,
        level: (r['Категория'] || '').trim(),
        region: (r['Регион'] || '').trim(),
        chairman: (r['Председатель/Руководитель'] || '').trim(),
        address: (r['Адрес'] || '').trim(),
        phone: phoneStr,
        phoneRaw,
        email: (r['E-mail'] || '').trim().replace(/,(?=[a-z])/, '.'),
        schedule: (r['Режим работы'] || '').trim(),
        web: 'sud.gov.kz',
      };
    }).filter(Boolean);
    return _courtsCache;
  }

  // ===== CHAMBERS DATA =====
  let _chambersCache = null;
  function getChambersData() {
    if (_chambersCache) return _chambersCache;

    const REGION_SLUG = {
      'Акмолинская область': 'akmola',
      'Актюбинская область': 'aktobe',
      'г. Алматы': 'almaty',
      'Алматинская область': 'almaty-obl',
      'г. Астана': 'astana',
      'Атырауская область': 'atyrau',
      'Область Абай': 'abay',
      'Восточно-Казахстанская область': 'vko',
      'Жамбылская область': 'zhambyl',
      'Западно-Казахстанская область': 'zko',
      'Карагандинская область': 'karaganda',
      'Костанайская область': 'kostanay',
      'Кызылординская область': 'kyzylorda',
      'Мангистауская область': 'mangistau',
      'Павлодарская область': 'pavlodar',
      'Северо-Казахстанская область': 'sko',
      'Туркестанская область': 'turkestan',
      'Область Ұлытау': 'ulytau',
      'г. Шымкент': 'shymkent',
      'Область Жетісу': 'zhetisu',
    };

    function chFirstPhoneRaw(str) {
      if (!str) return '';
      const m = str.match(/(?:\+7|8|\(\d)[\d\s\-\(\)]{6,}/);
      if (!m) return '';
      const d = m[0].replace(/\D/g, '').slice(0, 11);
      if (d.length === 11) return '+7' + d.slice(1);
      if (d.length === 10) return '+7' + d;
      return '';
    }

    function chFirstEmail(str) {
      if (!str || str.includes('не найдено')) return '';
      const m = str.match(/[\w._%+\-]+@[\w.\-]+\.[a-zA-Z]{2,}/);
      return m ? m[0] : '';
    }

    function chCleanLeader(str) {
      return (str || '').replace(/\s*\([^)]*\)/g, '').trim();
    }

    const notaryRows = parseSemicolonCSV(path.join(ROOT_DIR, 'Нотариальные_палаты_Казахстана.csv'));
    const chsiRows   = parseSemicolonCSV(path.join(ROOT_DIR, 'Палаты_ЧСИ_Казахстана.csv'));

    const chsiByRegion = {};
    chsiRows.forEach(r => {
      const region = (r['Регион'] || '').trim();
      if (region && !region.startsWith('Республиканская')) chsiByRegion[region] = r;
    });

    _chambersCache = notaryRows
      .filter(r => {
        const region = (r['Регион'] || '').trim();
        return region && !region.startsWith('Республика');
      })
      .map(r => {
        const region = r['Регион'].trim();
        const slug   = REGION_SLUG[region] || slugify(region);
        const chsi   = chsiByRegion[region] || {};
        return {
          slug, region,
          notary_name:     (r['Название палаты'] || '').trim(),
          notary_phone:    (r['Телефон'] || '').trim(),
          notary_phoneRaw: chFirstPhoneRaw(r['Телефон'] || ''),
          notary_email:    chFirstEmail(r['Email'] || ''),
          notary_web:      '',
          notary_address:  (r['Адрес'] || '').trim(),
          notary_leader:   chCleanLeader(r['Руководитель'] || ''),
          chsi_name:       (chsi['Название палаты'] || '').trim(),
          chsi_phone:      (chsi['Телефон'] || '').trim(),
          chsi_phoneRaw:   chFirstPhoneRaw(chsi['Телефон'] || ''),
          chsi_email:      chFirstEmail(chsi['Email'] || ''),
          chsi_web:        '',
          chsi_address:    (chsi['Адрес'] || '').trim(),
          chsi_leader:     chCleanLeader(chsi['Руководитель'] || ''),
        };
      });

    return _chambersCache;
  }

  // ===== CSV-BACKED: GSI (Государственные судебные исполнители) =====
  let _gsiCache = null;
  function getGsiData() {
    if (_gsiCache) return _gsiCache;
    const rows = parseSemicolonCSV(path.join(ROOT_DIR, 'Государственные_судебные_исполнители_Департаменты_юстиции.csv'));
    _gsiCache = rows.filter(r => (r['Регион'] || '').trim()).map(r => {
      const phone = (r['Телефон'] || '').replace('не найдено', '').trim();
      const m = phone.match(/(?:\+7|8|\(\d)[\d\s\-\(\)]{6,}/);
      const phoneRaw = m ? '+7' + m[0].replace(/\D/g, '').slice(1) : '';
      return {
        region:   r['Регион'].trim(),
        name:     (r['Название департамента'] || '').trim(),
        address:  (r['Адрес'] || '').trim(),
        phone,
        phoneRaw,
        email:    (r['Email'] || '').replace('не найдено', '').trim(),
        leader:   (r['Руководитель'] || '').replace('не найдено', '').trim(),
        slug:     slugify(r['Регион'].trim()),
      };
    });
    return _gsiCache;
  }

  // ===== CSV-BACKED: INSURANCE (Страховые компании) =====
  let _insuranceCache = null;
  function getInsuranceData() {
    if (_insuranceCache) return _insuranceCache;
    const rows = parseSemicolonCSV(path.join(ROOT_DIR, 'Страховые_компании_Казахстана.csv'));
    _insuranceCache = rows.filter(r => (r['Компания'] || '').trim()).map(r => {
      const phone = (r['Телефон'] || '').trim();
      const m = phone.match(/(?:\+7|8|\(\d)[\d\s\-\(\)]{6,}/);
      const phoneRaw = m ? '+7' + m[0].replace(/\D/g, '').slice(1) : '';
      const name = (r['Компания'] || '').trim();
      const parenMatches = name.match(/\(([^)]+)\)/g) || [];
      let shortName;
      if (parenMatches.length) {
        shortName = parenMatches[parenMatches.length - 1].replace(/[()]/g, '').trim();
      } else {
        // Many names use an unbalanced-quote convention, e.g. АО "Страховая компания "Amanat
        // — the real brand name is whatever follows the LAST quote character.
        const lastQuoteIdx = name.lastIndexOf('"');
        const afterQuote = lastQuoteIdx >= 0 ? name.slice(lastQuoteIdx + 1).trim() : '';
        shortName = afterQuote || name.replace(/^АО\s+"[^"]+"\s+/i, '').replace(/^«|»$/g, '').trim();
      }
      return {
        name, shortName,
        bin:     (r['БИН'] || '').trim(),
        web:     (r['Сайт'] || '').trim(),
        phone,   phoneRaw,
        email:   (r['Email'] || '').trim(),
        address: (r['Адрес'] || '').replace(/^\d+,\s*/, '').trim(),
        leader:  (r['Председатель Правления'] || '').trim(),
        slug:    slugify(shortName || name),
      };
    });
    return _insuranceCache;
  }

  // ===== CSV-BACKED CATALOGS: COLLECTORS / LOMBARDS =====
  // Some source CSVs were built by scrapers that, on failure, wrote the raw
  // error message into a data column (e.g. "ошибка при сборе: HTTP Error 404:
  // Not Found") instead of leaving it blank. Strip those out so visitors never
  // see internal scraper errors, and so pages don't accidentally read as a
  // soft-404 to crawlers.
  function cleanScrapedNote(note) {
    const s = (note || '').trim();
    if (/ошибка при сборе|HTTP Error|Not Found|404/i.test(s)) return '';
    return s;
  }

  function parseSemicolonCSV(filePath) {
    try {
      const raw = fs.readFileSync(filePath, 'utf-8');
      const lines = raw.split(/\r?\n/);
      const headers = lines[0].split(';').map(h => h.replace(/^"|"$/g, '').trim());
      const rows = [];
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        // Quoted-field parser for semicolon delimiter. A field only enters
        // "quoted mode" if it STARTS with a quote (right after a delimiter or
        // at line start) — quotes appearing mid-field (e.g. Компания "Name")
        // are treated as literal characters, not togglers. This matches how
        // real-world exports (Excel/Sheets) actually escape fields, where
        // company names often contain unescaped inner quotes.
        const fields = [];
        let cur = '', inQ = false, fieldStart = true;
        for (let c = 0; c < line.length; c++) {
          const ch = line[c];
          if (ch === '"' && fieldStart && cur === '') {
            inQ = true; fieldStart = false; continue;
          }
          if (ch === '"' && inQ) {
            if (line[c + 1] === '"') { cur += '"'; c++; continue; }
            if (line[c + 1] === ';' || c === line.length - 1) { inQ = false; continue; }
            cur += ch; continue;
          }
          if (ch === ';' && !inQ) {
            fields.push(cur.trim()); cur = ''; fieldStart = true; continue;
          }
          cur += ch; fieldStart = false;
        }
        fields.push(cur.trim());
        const obj = {};
        headers.forEach((h, idx) => { obj[h] = (fields[idx] || '').replace(/^"+|"+$/g, '').trim(); });
        rows.push(obj);
      }
      return rows;
    } catch (e) { return []; }
  }

  function parseContacts(raw) {
    const parts = raw.split(/[,;\s]+(?=[\w+])/);
    const phones = [], emails = [], sites = [];
    const rawTokens = raw.split(/,\s*|;\s*|\s{2,}/);
    rawTokens.forEach(t => {
      t = t.trim().replace(/^["]+|["]+$/g, '');
      if (!t) return;
      if (t.includes('@')) emails.push(t);
      else if (/^https?:\/\//i.test(t) || /^www\./i.test(t)) sites.push(t.replace(/^https?:\/\//i,'').replace(/^www\./i,'').split('/')[0]);
      else if (/[\d\-\(\)\+]/.test(t) && t.replace(/[^\d]/g,'').length >= 7) phones.push(t);
    });
    return { phones: [...new Set(phones)], emails: [...new Set(emails)], sites: [...new Set(sites)] };
  }

  let _collectorsCache = null;
  function getCollectors() {
    if (!_collectorsCache) {
      const rows = parseSemicolonCSV(path.join(ROOT_DIR, 'Коллекторские_агентства_Казахстана.csv'));
      const seen = {};
      _collectorsCache = rows
        .filter(r => (r['Статус'] || '').toLowerCase().includes('действу'))
        .map(r => {
          const contacts = parseContacts(r['Контакты (тел./email/сайт)'] || '');
          const bin = r['БИН'] || '';
          const name = (r['Название'] || '').replace(/^ТОО\s+"*|"*$/g, '').replace(/ТОО\s+/g,'').replace(/^"|"$/g,'').trim();
          let baseSlug = slugify(name) || 'kca-' + bin;
          if (!seen[baseSlug]) { seen[baseSlug] = 1; }
          else { seen[baseSlug]++; baseSlug = baseSlug + '-' + seen[baseSlug]; }
          return applyRegistryPrivacyOverride('collectors', {
            slug: baseSlug,
            bin, name,
            nameFull: r['Название'] || '',
            regNum: r['Рег. номер (лицензия)'] || '',
            leader: r['Руководитель (ФИО)'] || '',
            address: r['Адрес'] || '',
            phones: contacts.phones,
            emails: contacts.emails,
            sites: contacts.sites,
            dateAdded: r['Дата включения в реестр'] || '',
          });
        });
    }
    return _collectorsCache;
  }

  let _mfoCache = null;
  function getMfoData() {
    if (!_mfoCache) {
      const rows = parseSemicolonCSV(path.join(ROOT_DIR, 'МФО_Ломбарды_КредТоварищества_Казахстана.csv'));
      _mfoCache = { mfo: [], lombards: [], kredTov: [] };
      rows.forEach(r => {
        const cat = (r['Категория'] || '').trim();
        const entryName = (r['Название (реестр АРРФР)'] || '')
          .trim()
          .replace(/^[«»"'“”]+/, '')
          .replace(/^(товарищество с ограниченной ответственностью|тоо)\s+/i, '')
          .replace(/^[«»"'“”]+/, '')
          .replace(/[«»"'“”]+$/, '')
          .trim();
        const entry = {
          name: entryName,
          slug: slugify(entryName) || 'bin-' + (r['БИН'] || ''),
          nameFull: r['Полное название (гос. регистр)'] || '',
          bin: r['БИН'] || '',
          address: r['Юридический адрес'] || '',
          leader: r['Руководитель'] || '',
          note: cleanScrapedNote(r['Примечание']),
        };
        if (cat === 'МФО') _mfoCache.mfo.push(entry);
        else if (cat === 'Ломбард') _mfoCache.lombards.push(entry);
        else if (cat === 'Кредитное товарищество') _mfoCache.kredTov.push(entry);
      });
    }
    return _mfoCache;
  }

  return { slugify, parseSemicolonCSV, parseContacts, cleanScrapedNote, getBanksData, getCourtsData, getChambersData, getGsiData, getInsuranceData, getCollectors, getMfoData };
}

module.exports = { createCatalogData };
