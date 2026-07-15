# План отслеживания лидов (Lead Tracking Plan)

Этап 4 — коммерческая конверсия. Документ описывает систему аналитики сайта: какие события фиксируются, какие данные они несут и как их читать для оценки эффективности.

## 1. Два независимых канала

На сайте нет GA4/GTM — вместо них своя система на NeDB, два эндпоинта:

| Канал | Эндпоинт | Хранилище | Назначение |
|---|---|---|---|
| Высокоценные контакты | `POST /api/track-click` | `data/clicks.db` | Клик по телефону/WhatsApp — **шлёт уведомление в Telegram** сразу |
| Продуктовые события | `POST /api/track-event` | `data/clicks.db` (те же записи, другие `type`) | Частые UI-события — тихая запись, без уведомлений |

Оба пишут в одну и ту же коллекцию через `modules/clicks-db.js::recordClick()`, которая сохраняет произвольные дополнительные поля (`...extra`), поэтому оба канала совместимы для отчётности.

Клиентский helper: `public/js/analytics-events.js` — подключён почти на всех страницах (`public/*.html` и `views/news/layout.ejs`). Экспортирует `window.ZE_trackEvent(type, target, extra)`.

## 2. Типы событий (`ANALYTICS_EVENT_TYPES`, server.js)

| Событие | Когда срабатывает | Где в коде |
|---|---|---|
| `submit_iin` | Отправка ИИН в форму-проверку | форма на главной (`/#checker-section`) |
| `calculator_completed` | Завершение калькулятора | `/calculator` |
| `bin_search_completed` | Завершение поиска по БИН | `/bin-search` |
| `open_case` | Открытие карточки дела/производства | карточки ЧСИ/нотариус |
| `download_document` | Клик по `a[download]` или ссылке в `/downloads/` | автоматически, любая страница (delegated listener в analytics-events.js) |
| `copy_link` | Клик по `[data-copy-link]` | `/press`, карточки |
| `external_campaign_visit` | Заход с `?utm_source=...` | автоматически при загрузке любой страницы |
| `click_cta_bailiff` | Клик по CTA на карточке ЧСИ | `views/bailiff/page.ejs` — `cta: 'check-iin'` или `'whatsapp'` |
| `click_cta_notary` | Клик по CTA на карточке нотариуса | `views/notary/page.ejs` — аналогично |
| `send_document` | Пользователь подтвердил, что отправил документ на проверку (зарезервировано для будущей формы загрузки) | — |
| `click_document_review` | Клик по кнопке "Проверить документ в WhatsApp" на `/dokumenty` | `public/dokumenty.html`, `.dok-cta` |
| `click_whatsapp_after_download` | Клик по любой `wa.me`-ссылке **в той же сессии**, где ранее был `download_document` | автоматически, любая страница — `analytics-events.js` пишет флаг в `sessionStorage` при скачивании и проверяет его при клике на WhatsApp |

## 3. Payload

Каждое событие несёт:

```json
{
  "type": "click_cta_bailiff",
  "target": "ivanov-ivan-ivanovich",
  "page": "/bailiff/ivanov-ivan-ivanovich",
  "page_type": "bailiff_card",
  "cta_position": "whatsapp",
  "utm": "",
  "ts": 1752480000000,
  "ip": "...",
  "ua": "..."
}
```

`page_type` вычисляется автоматически на сервере (`classifyPageType()`, server.js) по `page`:

- `home`, `bailiff_card`, `notary_card`, `catalog`, `money_page` (страницы вида `/arest-*`, `/snyatie-*`, `/zapret-*`, `/otmena-*`, `/vozrazhenie-*`, `/grafik-*`), `documents`, `calculator`, `bin_search`, `other`.

Это позволяет группировать отчёты по типу страницы, не завися от полного списка URL.

## 4. Как читать данные

Данные лежат в `data/clicks.db` (NeDB, построчный JSON). Быстрый способ посмотреть — короткий Node-скрипт:

```js
const Datastore = require('nedb-promises');
const db = Datastore.create({ filename: 'data/clicks.db', autoload: true });

(async () => {
  const since = Date.now() - 28 * 24 * 60 * 60 * 1000; // последние 28 дней
  const rows = await db.find({ ts: { $gte: since } });

  // события по типу
  const byType = {};
  for (const r of rows) byType[r.type] = (byType[r.type] || 0) + 1;
  console.log(byType);

  // WhatsApp/телефон по типу страницы (page_type)
  const wa = rows.filter(r => r.type === 'whatsapp' || r.type === 'phone' || r.type === 'click_whatsapp_after_download');
  const byPageType = {};
  for (const r of wa) byPageType[r.page_type || 'unknown'] = (byPageType[r.page_type || 'unknown'] || 0) + 1;
  console.log(byPageType);
})();
```

Для сравнения "28 дней к 28 дням" (как просил пользователь) — запустить тот же запрос с `ts: { $gte: since - 28d, $lt: since }` для предыдущего периода и сравнить суммы по `type`/`page_type`.

## 5. Что уже отслеживалось до Этапа 4 vs что добавлено

**Было (Этап 3):** `submit_iin`, `calculator_completed`, `bin_search_completed`, `open_case`, `download_document`, `copy_link`, `external_campaign_visit`.

**Добавлено на Этапе 4:**
- `click_cta_bailiff` / `click_cta_notary` — раздельные CTA на карточках ЧСИ/нотариусов ("Проверить по ИИН" vs "Написать в WhatsApp"), с `cta_position` для сравнения, какая кнопка эффективнее.
- `send_document` — зарезервировано под будущий функционал.
- `click_document_review` — конкретно клик по кнопке проверки документа на `/dokumenty`.
- `click_whatsapp_after_download` — сквозная воронка "скачал → написал в WhatsApp" (работает на любой странице, не только `/dokumenty`, так как многие пользователи открывают документ в новой вкладке и возвращаются позже).

## 6. Ограничения

- Нет персональных данных в событиях (ИИН, ФИО клиента и т.п. НЕ передаются в `/api/track-event` — только идентификатор сущности вроде slug ЧСИ/нотариуса).
- `sessionStorage`-флаг для `click_whatsapp_after_download` не переживает закрытие вкладки — это осознанное ограничение (не хотим завязываться на cookies/долгоживущие идентификаторы без явного согласия пользователя).
- Нет валидации на дубли (двойной клик = два события) — при отчётности это не критично для относительных сравнений (period-over-period), но следует иметь в виду при абсолютных цифрах.
