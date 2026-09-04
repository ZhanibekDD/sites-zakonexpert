'use strict';

const path = require('path');
const fs = require('fs');
const { BANK_ARREST_HUB_PATH, BANK_ARREST_PAGES, findBankRecord, getRelatedBankArrestPages } = require('../../modules/bank-arrest-pages');
const { LEGAL_INTENT_PAGES, getLegalIntentPage } = require('../../modules/legal-intent-pages');
const { ROOT_DIR } = require('../paths');

function registerMarketingRoutes(app, dependencies) {
  const { notariesDb, bailiffsDb, asyncHandler, getBanksData } = dependencies;

  // ===== REGIONAL LANDING PAGES =====
  const REGIONAL_CITIES = {
    'almaty': {
      slug: 'almaty', name: 'Алматы', prepIn: 'Алматы', caseIn: 'Алматы', caseByCity: 'Алматы',
      bailiffRegion: 'город Алматы', bailiffPath: '/bailiffs/almaty', notaryRegion: 'город Алматы', notaryPath: '/notaries/almaty',
      intro: 'Алматы — крупнейший город Казахстана и лидер по количеству исполнительных производств. Здесь работает больше всего ЧСИ и нотариусов в стране, поэтому и арестов счетов Kaspi, Halyk и Freedom Bank больше, чем в любом другом регионе.',
      faq: [
        { q: 'Нужно ли приезжать в офис в Алматы?', a: 'Нет. Мы работаем дистанционно по всему Казахстану, включая Алматы — документы передаются через WhatsApp, личный визит не обязателен.' },
        { q: 'Почему в Алматы так много ЧСИ?', a: 'Алматы — самый населённый город страны с наибольшим числом исполнительных производств, поэтому здесь работает больше частных судебных исполнителей, чем в других регионах.' },
        { q: 'Как узнать, какой ЧСИ в Алматы ведёт моё производство?', a: 'Проверьте по ИИН на нашем сайте — покажем все открытые производства и исполнителя, который их ведёт.' },
      ],
    },
    'astana': {
      slug: 'astana', name: 'Астана', prepIn: 'Астане', caseIn: 'Астане', caseByCity: 'Астане',
      bailiffRegion: 'город Астана', bailiffPath: '/bailiffs/astana', notaryRegion: 'город Астана', notaryPath: '/notaries/astana',
      intro: 'Астана — столица Казахстана с активно растущим количеством исполнительных производств. Клиенты Kaspi, Halyk и Freedom Bank в Астане часто сталкиваются с арестом счёта из-за исполнительной надписи нотариуса или постановления ЧСИ.',
      faq: [
        { q: 'Работаете ли вы с клиентами в Астане дистанционно?', a: 'Да, мы ведём дела по всей Астане удалённо — присылаете документы в WhatsApp, мы готовим и подаём всё сами.' },
        { q: 'Какой банк чаще арестовывает счета в Астане?', a: 'Чаще всего к нам обращаются клиенты Kaspi и Halyk Bank — банк лишь исполняет постановление, а не принимает решение об аресте самостоятельно.' },
        { q: 'Сколько времени занимает снятие ареста в Астане?', a: 'Зависит от основания: при исполнительной надписи — от нескольких дней до 2–3 недель после подачи возражения. Точный срок скажем после анализа документов.' },
      ],
    },
    'shymkent': {
      slug: 'shymkent', name: 'Шымкент', prepIn: 'Шымкенте', caseIn: 'Шымкенте', caseByCity: 'Шымкенту',
      bailiffRegion: 'город Шымкент', bailiffPath: '/bailiffs/shymkent', notaryRegion: 'город Шымкент', notaryPath: '/notaries/shymkent',
      intro: 'Шымкент — третий по величине город Казахстана со своим отдельным реестром ЧСИ и нотариусов. Арест счёта в Шымкенте чаще всего связан с исполнительной надписью нотариуса по кредиту или МФО.',
      faq: [
        { q: 'Есть ли у ZakonExpert офис в Шымкенте?', a: 'Мы работаем по Шымкенту дистанционно — весь процесс, от разбора документов до подачи возражения, ведётся удалённо через WhatsApp.' },
        { q: 'ЧСИ в Шымкенте наложил арест — что делать?', a: 'Проверьте по ИИН, какое производство открыто и на каком основании. Затем можно подготовить возражение или жалобу в зависимости от ситуации.' },
        { q: 'Можно ли оспорить исполнительную надпись нотариуса в Шымкенте?', a: 'Да, если долг спорный или нарушена процедура уведомления — на возражение есть 10 рабочих дней с момента, когда вы узнали о надписи.' },
      ],
    },
    'taldykorgan': {
      slug: 'taldykorgan', name: 'Талдыкорган', prepIn: 'Талдыкоргане', caseIn: 'Талдыкоргане', caseByCity: 'Талдыкоргану',
      bailiffRegion: 'область Жетысу', bailiffPath: '/bailiffs/zhetisu', notaryRegion: 'область Жетісу', notaryPath: '/notaries/zhetisu',
      intro: 'Талдыкорган — административный центр области Жетысу. Исполнительные производства и исполнительные надписи по клиентам региона ведутся ЧСИ и нотариусами, зарегистрированными в области Жетысу.',
      faq: [
        { q: 'Талдыкорган относится к какой области по реестру ЧСИ?', a: 'К области Жетысу — административным центром которой является Талдыкорган. Все ЧСИ и нотариусы региона зарегистрированы именно там.' },
        { q: 'Можно ли решить вопрос без визита в Талдыкорган?', a: 'Да, мы работаем дистанционно — документы принимаем через WhatsApp, ехать в Талдыкорган не нужно.' },
        { q: 'Что делать, если арестовали зарплатную карту в Талдыкоргане?', a: 'Проверьте по ИИН основание ареста. Если удержания превышают установленный законом лимит — это повод для жалобы на ЧСИ.' },
      ],
    },
    'karaganda': {
      slug: 'karaganda', name: 'Караганда', prepIn: 'Караганде', caseIn: 'Караганде', caseByCity: 'Караганде',
      bailiffRegion: 'Карагандинская область', bailiffPath: '/bailiffs/karagandinskaya-oblast', notaryRegion: 'Карагандинская область', notaryPath: '/notaries/karagandinskaya-oblast',
      intro: 'Караганда — крупный промышленный центр и административный центр Карагандинской области. Исполнительные производства должников региона ведут ЧСИ, зарегистрированные в Карагандинской области.',
      faq: [
        { q: 'Работает ли ZakonExpert с должниками в Караганде?', a: 'Да, мы ведём дела по всей Карагандинской области дистанционно — от первичной проверки по ИИН до подачи документов.' },
        { q: 'Как узнать сумму долга и взыскателя в Караганде?', a: 'Проверьте по ИИН на нашем сайте — покажем все открытые исполнительные производства, взыскателя и сумму задолженности.' },
        { q: 'Можно ли договориться о рассрочке в Караганде?', a: 'Да, при определённых условиях можно оформить график платежей или отсрочку исполнения — разберём вашу ситуацию бесплатно.' },
      ],
    },
  };
  const REGIONAL_CITY_LIST = Object.values(REGIONAL_CITIES).map(c => ({ slug: c.slug, name: c.name }));

  app.get('/snyatie-aresta-:city', asyncHandler(async (req, res, next) => {
    const city = REGIONAL_CITIES[req.params.city];
    if (!city) return next();
    let bailiffCount = 0, notaryCount = 0;
    if (bailiffsDb) {
      const regions = await bailiffsDb.getRegions();
      const found = regions.find(r => r.region === city.bailiffRegion);
      bailiffCount = found ? found.count : 0;
    }
    if (notariesDb) {
      const regions = await notariesDb.getRegions();
      const found = regions.find(r => r.region === city.notaryRegion);
      notaryCount = found ? found.count : 0;
    }
    const otherCities = REGIONAL_CITY_LIST.filter(c => c.slug !== city.slug);
    res.render('regional/page', { city, bailiffCount, notaryCount, otherCities });
  }));

  app.get(BANK_ARREST_HUB_PATH, (req, res) => {
    res.render('bank-arrest/hub', {
      pages: BANK_ARREST_PAGES,
      legalPages: LEGAL_INTENT_PAGES,
      reviewedAt: BANK_ARREST_PAGES[0]?.reviewedAt || '2026-08-24',
    });
  });

  BANK_ARREST_PAGES.filter(page => !page.legacyStatic).forEach(page => {
    app.get(page.path, (req, res) => {
      const bank = findBankRecord(page, getBanksData());
      res.render('bank-arrest/page', {
        page,
        bank,
        relatedPages: getRelatedBankArrestPages(page),
      });
    });
  });

  const RELATED_GROWTH_LABELS = Object.freeze({
    '/snyatie-aresta-so-scheta': 'Как снять арест со счёта или карты',
    '/snyatie-ogranichenii-chsi': 'Что делать с ограничениями ЧСИ',
    '/chsi-ne-snimaet-arest-posle-oplaty': 'ЧСИ не снимает арест после оплаты',
    '/arest-zarplatnoy-karty': 'Арест зарплатной карты',
    '/otmena-ispolnitelnoi-nadpisi': 'Как отменить исполнительную надпись',
    '/arest-scheta-v-bankah-kazahstana': 'Аресты счетов по банкам Казахстана',
  });

  LEGAL_INTENT_PAGES.forEach(page => {
    app.get(page.path, (req, res) => {
      const relatedPages = (page.related || []).map(relatedPath => {
        const configured = getLegalIntentPage(relatedPath);
        return configured || {
          path: relatedPath,
          h1: RELATED_GROWTH_LABELS[relatedPath] || 'Связанный правовой маршрут',
        };
      });
      res.render('legal-intent/page', { page, relatedPages });
    });
  });

  // Gallery page
  app.get('/gallery', (req, res) => res.sendFile(path.join(ROOT_DIR, 'public', 'gallery.html')));

  // ===== SERVICE PAGE CLEAN URLS =====
  const servicePages = {
    '/snyatie-aresta-so-scheta':        'snyatie-aresta-so-scheta.html',
    '/otmena-ispolnitelnoi-nadpisi':     'ispolnitelnaya-nadpis.html',
    '/vozrazhenie-na-ispolnitelnuyu-nadpis': 'spornost-dolga.html',
    '/snyatie-ogranichenii-chsi':        'chsi-arest-schetov.html',
    '/snyatie-zapreta-na-avto':          'snyatie-zapreta-na-avto.html',
    '/snyatie-ogranicheniya-na-imushchestvo': 'snyatie-ogranicheniya-na-imushchestvo.html',
    '/snyatie-zapreta-registracionnyh-deistvii': 'zapret-registracionnyh-deystviy.html',
    '/snyatie-ogranichenii-u-notariusa': 'snyatie-ogranichenii-u-notariusa.html',
    '/grafik-oplaty-zadolzhennosti':     'grafik-platezhey.html',
    '/ubrat-procenty-i-rashody-chsi':    'ubrat-procenty-i-rashody-chsi.html',
    '/arest-kaspi':                      'arest-kaspi.html',
    '/arest-halyk-bank':                 'arest-halyk-bank.html',
    '/arest-freedom-bank':               'arest-freedom-bank.html',
    '/zakony':                           'zakony.html',
    '/besspornost-dolga':                'besspornost-dolga.html',
    '/alimenty-i-aresty':                'alimenty-i-aresty.html',
    '/shtrafy-i-aresty':                 'shtrafy-i-aresty.html',
    '/chsi-refinansirovanie':            'chsi-refinansirovanie.html',
    '/otmena-resheniya-suda':            'otmena-resheniya-suda.html',
    '/dokumenty':                        'dokumenty.html',
    '/rezultaty':                        'rezultaty.html',
    '/mediator':                         'mediator.html',
    '/privacy':                          'privacy.html',
    '/services':                         'services.html',
    '/contact':                          'contact.html',
    '/sms-1414':                         'sms-1414.html',
    '/zapret-na-vyezd-iz-kazahstana':    'zapret-na-vyezd-iz-kazahstana.html',
    '/zhaloba-na-chsi':                  'zhaloba-na-chsi.html',
    '/chsi-ne-snimaet-arest-posle-oplaty': 'chsi-ne-snimaet-arest-posle-oplaty.html',
    '/arest-zarplatnoy-karty':           'arest-zarplatnoy-karty.html',
    '/snyat-arest-s-nedvizhimosti':      'snyat-arest-s-nedvizhimosti.html',
    '/nadpis-ili-list':                  'nadpis-ili-list.html',
  };

  app.get(['/otzyvy', '/otzyvy.html'], (req, res) => {
    res.redirect(301, '/reviews');
  });

  for (const [route, file] of Object.entries(servicePages)) {
    app.get(route, (req, res) => {
      const filePath = path.join(ROOT_DIR, 'public', file);
      if (fs.existsSync(filePath)) {
        res.sendFile(filePath);
      } else {
        res.status(404).sendFile(path.join(ROOT_DIR, 'public', 'index.html'));
      }
    });
  }

}

module.exports = { registerMarketingRoutes };
