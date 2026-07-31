# Deployment: единая база организаций

## До обновления

1. Скачать `data/companies.sqlite` с Plesk на локальный диск.
2. Удалить с Plesk старые ZIP/RAR, временные JSON, старые deployment-копии и
   ненужные backup-файлы. Не удалять рабочие файлы из `data/`.
3. Обновить приложение из `main`.
4. Выбрать Node.js 22 в Plesk.
5. Выполнить:

```bash
npm ci --omit=dev --ignore-scripts
npm run storage:audit
npm run organization-storage-plan
```

Продолжать только при `"safe": true`.

## Импорт

1. Остановить Node.js/Passenger.
2. Запустить:

```bash
npm run import-directory-contacts -- --confirm-offline
```

3. Сохранить выведенный `runId`.
4. Запустить Node.js/Passenger.

Команда рассчитана на повторный запуск после обрыва. Не удалять чекпоинты и не
использовать `--force`, пока не выяснена причина остановки.

## Проверка

```bash
npm run audit:live
```

Вручную проверить:

- `/companies`;
- поиск по БИН;
- поиск по названию кириллицей и латиницей;
- поиск по телефону и email;
- одну официальную карточку с БИН;
- одну дополнительную карточку без БИН;
- `/kk/companies`, `/en/companies`, `/zh/companies`, `/tr/companies`;
- `sitemap-index.xml`, `robots.txt` и `ads.txt`.

## Критерии успеха

- импорт обработал 457 324 строки и 0 invalid;
- повторный запуск сообщает `alreadyCompleted`;
- официальные поля не заменены справочником;
- карточки без БИН имеют `noindex` и отсутствуют в company sitemap;
- нет 500/502 и пустых ответов;
- размер `data/companies.sqlite` остаётся ниже заданного бюджета;
- поиск по телефону, email и латинской транслитерации возвращает карточку.

## Откат

Остановить приложение и выполнить:

```bash
npm run rollback-organization-import -- \
  --confirm-offline \
  --run-id=RUN_ID
```

Если откат заблокирован из-за более нового запуска, сначала откатывается
более новый запуск. Если база повреждена или квота заполнена, восстановить
скачанную до deployment копию `companies.sqlite`.
