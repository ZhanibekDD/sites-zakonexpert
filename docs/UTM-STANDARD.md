# UTM-стандарт ZakonExpert

Единые правила разметки ссылок для внешних публикаций, чтобы трафик от аутрич-кампаний был измерим. С Этапа 3 сайт умеет ловить `utm_source` на любой странице (см. `public/js/analytics-events.js`, событие `external_campaign_visit`) и сохранять его в `sessionStorage` на время визита — без сторонней аналитики (GA/GTM на проекте не установлены).

## Параметры

| Параметр | Обязательный | Значения | Пример |
|---|---|---|---|
| `utm_source` | да | домен или имя площадки, нижний регистр, без пробелов | `2gis`, `zakon-kz`, `instagram`, `newspaper-almaty` |
| `utm_medium` | да | тип канала из фиксированного списка ниже | `directory`, `guest-post`, `social`, `press`, `partner`, `referral` |
| `utm_campaign` | да | краткое имя кампании/темы, kebab-case | `arest-kaspi-guide`, `press-launch-2026`, `bailiff-directory` |
| `utm_content` | нет, но желательно если ссылок несколько на одной площадке | что именно кликнули | `hero-link`, `footer-link`, `logo` |
| `utm_term` | нет | только для платных/поисковых кампаний, обычно не нужен для белого продвижения | — |

### Фиксированный список `utm_medium`
- `directory` — бизнес/юридические/финансовые каталоги
- `maps` — 2ГИС, Google Business, Яндекс Карты
- `guest-post` — гостевые статьи
- `press` — публикации СМИ, экспертные комментарии
- `partner` — партнёрские материалы
- `social` — Instagram/TikTok/YouTube/Telegram
- `referral` — прочие обратные ссылки без более точной категории

## Формула ссылки

```
https://zakonexpertt.kz/<целевая-страница>?utm_source=<площадка>&utm_medium=<канал>&utm_campaign=<кампания>&utm_content=<опц.>
```

### Примеры

Гостевая статья на юридическом блоге про арест Kaspi, ссылка в теле статьи на `/arest-kaspi`:
```
https://zakonexpertt.kz/arest-kaspi?utm_source=blog-name&utm_medium=guest-post&utm_campaign=arest-kaspi-guide&utm_content=body-link
```

Карточка в 2ГИС, ссылка на сайт:
```
https://zakonexpertt.kz/?utm_source=2gis&utm_medium=maps&utm_campaign=nap-listing
```

Комментарий эксперта в региональном СМИ:
```
https://zakonexpertt.kz/press?utm_source=inbusiness-kz&utm_medium=press&utm_campaign=chsi-comment-2026-07
```

## Правила
1. **Всегда** вести на конкретную релевантную страницу, не на главную (см. `docs/LINK-DESTINATION-MAP.md`) — исключение: карты/каталоги, где технически можно указать только один URL профиля.
2. `utm_campaign` — по-английски или транслитом, kebab-case, без пробелов и кириллицы (чтобы ссылка не ломалась при копировании в мессенджеры).
3. Не переиспользовать один `utm_campaign` для разных площадок — иначе нельзя будет отличить источник в `data/outreach-tracker.csv`.
4. Каждая отправленная UTM-ссылка обязательно фиксируется в `data/outreach-tracker.csv` (колонка `utm_url`) **до** отправки на площадку — не постфактум.

## Как проверить, что сработало
1. Открыть готовую ссылку в браузере (в режиме инкогнито).
2. В консоли браузера (F12) → Network → найти POST-запрос на `/api/track-event` с `type: "external_campaign_visit"`.
3. Через несколько дней сверить рост посещений целевой страницы в серверных логах / будущей интеграции с Search Console (переход по брендовому запросу вырастет так же, если публикация сработала на узнаваемость).
