# ZakonExpert — Снятие арестов и ограничений по исполнительным производствам

Сайт юридического сервиса [zakonexpertt.kz](https://zakonexpertt.kz) по снятию арестов с банковских счетов, карт, авто и имущества в Казахстане. Работа с ЧСИ, нотариальными исполнительными документами, исполнительными производствами.

## Страницы

| Страница | Описание |
|---|---|
| `public/index.html` | Главная (RU) — hero, проблемы, процесс, IIN-чекер, FAQ |
| `public/index_kz.html` | Главная (KZ/Казахский) |
| `public/services.html` | Услуги (RU) — карточки 15 услуг |
| `public/services_kz.html` | Услуги (KZ) |
| `public/contact.html` | Контакты (RU) — форма → WhatsApp |
| `public/contact_kz.html` | Контакты (KZ) |

## Технологии

- **Node.js / Express** — сервер, API `/check`
- **Bootstrap 5.3** — базовая сетка и модальное окно
- **Vanilla JS** — клиентская логика (`main.js`, `site.js`)
- **Winston** — логирование на сервере
- **eGov SOAP API** — проверка ИИН по реестру АИСОИП

## Установка и запуск

```bash
npm install
```

Скопируйте `.env.example` в `.env` и задайте переменные:

```bash
cp .env.example .env
# Заполните EGOV_API_KEY в .env
```

Запуск в режиме разработки:

```bash
npm run dev
```

Запуск в production:

```bash
npm start
```

Сервер доступен по адресу: `http://localhost:3000`

## Переменные окружения

| Переменная | Описание | Обязательна |
|---|---|---|
| `EGOV_API_KEY` | API-ключ для data.egov.kz (АИСОИП) | ДА |
| `PORT` | Порт сервера (по умолчанию 3000) | нет |
| `CORS_ORIGIN` | Домен для CORS в production | нет |
| `NODE_ENV` | `development` / `production` | нет |

**Важно:** никогда не коммитьте `.env` с реальными ключами.

## API

### POST `/check`

Проверяет наличие исполнительных производств по ИИН через eGov SOAP API.

**Тело запроса:**
```json
{ "iin": "123456789012" }
```

**Ответ (200):**
```json
{
  "debtorInfo": {
    "isDebtor": true,
    "details": [ /* массив строк из АИСОИП */ ]
  },
  "restrictions": []
}
```

**Ошибки:**
- `400` — ИИН не предоставлен
- `500` — ошибка eGov API или внутренняя ошибка

## Что нельзя трогать

- ID элементов: `search-form`, `iin`, `search-button`, `loading-container`, `error-message`, `results`, `debtors-table`, `restrictions-table`, `debtorDetailsModal`
- Маршрут `POST /check` и его API-контракт
- Статическая раздача `public/`
- Функции `checkDebtorViaApi`, `asyncHandler` в `server.js`

## Деплой

Сервер запускается командой `npm start` (Node.js 16+). На хостинге Plesk — через менеджер Node.js приложений. Убедитесь, что переменная `EGOV_API_KEY` задана в настройках окружения хостинга (не в коде).

## Безопасность и приватность

- ИИН в логах маскируются: показываются только первые 4 цифры
- API-ключ хранится в переменной окружения (не в коде)
- Персональные данные не сохраняются сервером
- helmet, compression, CORS ограничение в production
