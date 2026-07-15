# URL для переобхода — Этап 4 (Метрика + технический SEO)

Только реально изменённые индексируемые URL. Отправлять после реального деплоя на сервер, не сразу после мержа PR.

## Высокий приоритет

Страницы с новыми 301-редиректами — важно, чтобы поисковики как можно быстрее переиндексировали новую каноническую цель вместо старого дубля:

- `/otmena-ispolnitelnoi-nadpisi` (принимает редирект с `/ispolnitelnaya-nadpis`)
- `/vozrazhenie-na-ispolnitelnuyu-nadpis` (принимает редирект с `/spornost-dolga`)
- `/snyatie-ogranichenii-chsi` (принимает редирект с `/chsi-arest-schetov`)
- `/snyatie-zapreta-registracionnyh-deistvii` (принимает редирект с `/zapret-registracionnyh-deystviy`)
- `/grafik-oplaty-zadolzhennosti` (принимает редирект с `/grafik-platezhey`)
- `/snyatie-aresta-so-scheta` (Яндекс ранее индексировал `.html`-дубль на позиции 16 — после редиректа должна консолидироваться каноника)
- `/zakony` (изменён контент — новые внутренние ссылки на денежные страницы)
- `/dokumenty` (новый CTA + tracking)
- `/spornost-dolga` — **не отправлять как самостоятельную страницу**, это теперь редирект

Денежные страницы с исправленным WhatsApp-текстом:
- `/alimenty-i-aresty`
- `/grafik-oplaty-zadolzhennosti`
- `/otmena-ispolnitelnoi-nadpisi`
- `/otmena-resheniya-suda`
- `/shtrafy-i-aresty`
- `/vozrazhenie-na-ispolnitelnuyu-nadpis`
- `/snyatie-zapreta-registracionnyh-deistvii`

## Средний приоритет

- `/arest-kaspi` (кандидат на доработку title/description по данным `docs/GSC-OPPORTUNITIES-SUMMARY.md`, но контент в этой сессии не менялся — переобход не обязателен сейчас)
- `/bailiffs` (каталог — крупный источник трафика, стоит следить за индексацией)
- Карточки ЧСИ/нотариусов с обновлённым CTA — не отправлять поштучно (их тысячи), переобход произойдёт естественным образом через sitemap

## НЕ отправлять

- `/privacy`, `/admin/*`, любые `/api/*` — не индексируемый или служебный контент
- Старые алиасы (`/ispolnitelnaya-nadpis`, `/spornost-dolga`, `/chsi-arest-schetov`, `/zapret-registracionnyh-deystviy`, `/grafik-platezhey`) и любые `.html`-URL — они теперь редиректят, отправлять на переобход саму редирект-цель незачем, поисковик сам обработает 301
- Sitemap/robots.txt — не «страницы», отправлять не нужно, они уже актуальны

## Как отправить (Google Search Console)

Инструмент проверки URL → вставить URL → «Запросить индексирование». Не более 10-15 URL вручную в день — у GSC есть лимит.

## Как отправить (Яндекс Вебмастер)

Индексирование → Переобход страниц → вставить URL по одному или списком.
