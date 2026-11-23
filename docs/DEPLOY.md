# Публікація Bounty Hunter: GitHub + Docker + постійна SQLite

**Статус:** проєкт зібраний і протестований локально. Публічний URL, репозиторій одногруппника і обліковий запис хостингу на момент оформлення відсутні, тому це інструкція, а не підтвердження публічного деплою.

## Крок 1. GitHub

Увійдіть у **власний обліковий запис одногруппника** на GitHub, створіть порожній репозиторій `bounty-hunter-lab5` (без додаткового README). У локальній папці проєкту:

```bash
git init
git add .
git commit -m "Lab 5: Node.js REST API, SQLite, CRUD, tests and docs"
git branch -M main
git remote add origin https://github.com/USERNAME/bounty-hunter-lab5.git
git push -u origin main
```

Замініть `USERNAME` на реальний логін. **Не завантажуйте:** `.env`, `data/*.sqlite`, `data/*.sqlite-wal`, `data/*.sqlite-shm`, cookies, реальні персональні дані. Їх ігнорує `.gitignore`.

## Крок 2. Railway з Dockerfile та Volume

1. У Railway створіть проєкт → розгортання з GitHub-репозиторію.
2. Сервіс має збиратися з кореневого `Dockerfile` (автовиявлення або налаштування build).
3. Приєднайте **Volume** з абсолютним шляхом монтування `/data`. Railway монтує Volume від root. Оскільки Dockerfile запускає застосунок від `node` (UID 1000), для Railway за офіційною інструкцією встановіть також `RAILWAY_RUN_UID=0` **або** самостійно налаштуйте права тому. Запуск від root має нижчу ізоляцію, тож для реального публічного продукту доречніше застосувати зовнішню БД або налаштувати непривілейованого користувача з потрібними правами.
4. У Variables задайте:

   ```text
   HOST=0.0.0.0
   DB_PATH=/data/bounty-hunter.sqlite
   NODE_ENV=production
   DEMO_SEED=0
   APP_ORIGIN=https://<фактичний-публічний-домен>
   RAILWAY_RUN_UID=0  # лише Railway з root-mounted Volume
   ```

   `PORT` задається платформою або за замовчуванням 3000. Не використовувати `COOKIE_SECURE=0` у production.
5. Увімкніть публічний HTTPS-домен, вкажіть точний origin у `APP_ORIGIN` (без кінцевого `/`). Зробіть Redeploy.
6. Перевірте `https://<домен>/api/health` → `status: ok`, `database: connected`; увійдіть, створіть вакансію, оновіть сторінку, перезапустіть контейнер та переконайтеся в збереженні даних.

Офіційні матеріали: https://docs.railway.com/builds/dockerfiles ; https://docs.railway.com/variables ; https://docs.railway.com/volumes ; https://docs.railway.com/volumes/reference .

**Критично:** без Volume SQLite збережеться тільки до наступного перескладання/перезапуску контейнера. З Volume застосунок розрахований на **один екземпляр**; для масштабування потрібна зовнішня серверна СУБД (PostgreSQL).

## Альтернатива: Render

Створіть Docker Web Service із GitHub. Додайте **постійний диск із mount path `/data`** та змінні з попереднього кроку. Render надає persistent disks для відповідних **платних** сервісів, а не для безоплатного сервісу; не демонструйте запис у SQLite на ефемерному диску як надійне постійне збереження.

Документація: https://render.com/docs/docker ; https://render.com/docs/disks .

## Крок 3. Докази для звіту

У файлі Word заповніть рядки:

- `Репозиторій GitHub: __________________`
- `Публічна адреса застосунку: __________________`
- `Стан GET /api/health: __________________ (дата / час)`

Зробіть **фактичні** скріншоти публічного застосунку на десктопі та смартфоні. Скриншоти в `docs/screenshots/` отримані з локальної DOM-симуляції (див. `docs/dom-results.json`), вони не є доказом публічного розгортання.
