# REST API · Bounty Hunter

Всі відповіді JSON. Для змінних запитів передайте `Content-Type: application/json` та використовуйте same-origin `fetch` (або `X-Requested-With: XMLHttpRequest`). Параметри зберігаються в SQLite. Сесія в `bh_session` (HttpOnly).

| Метод і маршрут | Доступ | Призначення |
|---|---|---|
| GET `/api/health` | усі | перевірка доступності сервера і SQLite |
| POST `/api/auth/register` | усі | реєстрація `{username,email,password,role}` |
| POST `/api/auth/login` | усі | вхід `{username,password}` |
| POST `/api/auth/logout` | усі | вихід та відкликання сесії |
| GET `/api/auth/me` | усі | `{user:null}` або `{user:{id,username,role}}` |
| GET `/api/freelancers` | усі | список, `category`, `level`, `rating`, `availability`, `search` |
| GET `/api/freelancers/:id` | усі | деталі профілю |
| GET `/api/profile/me` | freelancer | власний профіль |
| PATCH `/api/profile/me` | freelancer | зміна `name,category,level,availability,hourly_rate,location,bio,stack` |
| GET `/api/jobs` | усі | список; `category`, `level`, `search` та `mine=1` для авторизованого |
| GET `/api/jobs/:id` | усі | деталі вакансії |
| POST `/api/jobs` | client | створити вакансію |
| PATCH `/api/jobs/:id` | client-власник | оновити власну вакансію |
| DELETE `/api/jobs/:id` | client-власник | видалити власну вакансію (каскадно з заявками) |
| POST `/api/jobs/:id/applications` | freelancer | відгук `{letter,expected_rate}` |
| GET `/api/applications/me` | авторизований | власні/отримані заявки |
| GET `/api/applications/:id` | заявник або власник вакансії | деталі заявки |
| PATCH `/api/applications/:id` | власник вакансії | статус `pending,accepted,rejected` |
| GET `/api/contacts` | авторизований | публічно видимі співрозмовники |
| GET `/api/messages?with=ID` | авторизований | власні повідомлення з ID |
| POST `/api/messages` | авторизований | `{recipient_id,content}` |
| POST `/api/support` | усі | `{body}`: зберегти тестове звернення |

## Відповідність CRUD і SQL

| Операція | API | SQL |
|---|---|---|
| Create | POST `/api/jobs` | INSERT INTO jobs |
| Read | GET `/api/jobs` і GET `/api/jobs/:id` | SELECT FROM jobs |
| Update | PATCH `/api/jobs/:id` | UPDATE jobs |
| Delete | DELETE `/api/jobs/:id` | DELETE FROM jobs |

Усі SQL-запити до даних користувачів параметризовані `?`. Код повернення: 200 успіх, 201 створено, 400 невалідний JSON/ID/фільтр, 401 неавторизований, 403 заборонено, 404 не знайдено, 409 дубль, 413 завеликий JSON, 415 невірний формат, 422 некоректні значення, 429 багато спроб, 500 помилка сервера.

## Таблиці БД

```
users(id, username UNIQUE, email UNIQUE, password_salt, password_hash, role)
  ├── sessions(token_hash PK, user_id FK, expires_at)
  ├── profiles(user_id PK/FK, name, category, level, rating, availability, hourly_rate, location, bio, stack JSON)
  ├── jobs(id PK, owner_id FK, title, company, category, level, budget, deadline, work_format, description)
  │     └── applications(id PK, job_id FK, applicant_id FK, letter, expected_rate, status)
  ├── messages(id PK, sender_id FK, recipient_id FK, content)
  └── support_tickets(id PK, user_id NULL/FK, body)
```

Зовнішні ключі та обмеження унікальності застосовуються на рівні SQLite (`PRAGMA foreign_keys=ON`). Секрети й пароль відкритим текстом не зберігаються. Demo-пароль є лише у прикладі README для локальної ініціалізації.

## Приклади curl (PowerShell: `curl.exe`)

```bash
curl http://localhost:3000/api/health
curl 'http://localhost:3000/api/jobs?category=backend'
curl -X POST http://localhost:3000/api/auth/login -H 'X-Requested-With: XMLHttpRequest' -H 'Content-Type: application/json' -c cookie.txt -d '{"username":"technova","password":"DemoPass123!"}'
curl http://localhost:3000/api/auth/me -b cookie.txt
```

> Файл cookie.txt зберігайте локально і не комітьте у Git. `POST/PATCH/DELETE` через браузер виконуються із захистом Origin.
