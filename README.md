# Alfa Global CBDC Hub

Личный кабинет юридического лица для сопровождения внешнеэкономических сделок
от начала до завершения: финансовая сторона, документооборот, регуляторные
проверки, статус исполнения.

Этот репозиторий (`IVR-CBDC/Frontend`) — фронтенд-часть системы: BFF (Node.js)
и SPA (React). Бэкенд — отдельный репозиторий (`IVR-CBDC/Backend`, локально
`/home/legors/Documents/IVR`): три сервиса на C++/Drogon и Python/FastAPI за
Traefik, каждый со своей Postgres, плюс общий Redis. BFF — единственная дверь
из SPA в этот бэкенд: держит сессию пользователя в HttpOnly-cookie, ходит в
сервисы с его JWT и раздаёт события сделок через WebSocket.

## Структура репозитория

```
alfa-cbdc-hub/
├── bff/         BFF-слой (Node.js + Express + WebSocket)
└── frontend/    Клиентское SPA (React + TypeScript + Vite, с поддержкой PWA)
```

## BFF

Агрегирует данные, реализует бизнес-логику для UI, кеширование и сервис
уведомлений в реальном времени через WebSocket. Реализация — поверх реальных
сервисов Backend-репозитория (auth/core/commission), моков не осталось.

### Локальный запуск против стенда Backend

Сначала подними стенд Backend (`docker compose ... up -d --wait`, см. README
того репозитория) — BFF ничего не эмулирует и падает при старте, если не
может достучаться до обязательных переменных окружения:

```bash
cd bff
pnpm install
AUTH_URL=http://127.0.0.1:18080 \
CORE_URL=http://127.0.0.1:18081 \
COMMISSION_URL=http://127.0.0.1:<host-порт commission, если он проброшен> \
REDIS_URL=redis://127.0.0.1:<host-порт redis, если он проброшен> \
ALLOWED_ORIGINS=http://localhost:5173 \
pnpm dev         # http://localhost:4000, WS: ws://localhost:4000/ws
```

`service-commission` и `redis` в dev-оверлее Backend порт наружу не
публикуют (см. README Backend-репозитория) — если он нужен с хоста, это
отдельная правка того репозитория, не этой задачи. Внутри общего
docker-сетевого стенда (см. ниже, Task 5 плана 05) BFF обращается к ним по
именам сервисов (`http://service-commission:8000`, `redis://redis:6379`),
не по host-портам.

Обязательные переменные (без них процесс падает при старте с понятным
сообщением, см. `bff/src/config.ts`):

| Переменная | Назначение |
|---|---|
| `AUTH_URL` | адрес service-auth (регистрация/логин/JWKS) |
| `CORE_URL` | адрес service-core (сделки, документы, трекинг) |
| `COMMISSION_URL` | адрес service-commission (котировки сценариев) |
| `REDIS_URL` | адрес Redis (подписка на события сделок) |
| `ALLOWED_ORIGINS` | список Origin через запятую — проверка CSRF на мутирующих запросах |

Необязательные: `PORT` (по умолчанию 4000), `COOKIE_SECURE` (`true`/`false`,
по умолчанию `false` — включай в проде за HTTPS), `UPSTREAM_TIMEOUT_MS`
(по умолчанию 5000).

```bash
pnpm test        # vitest, без поднятого стенда — upstream'ы подменены
pnpm typecheck
pnpm build       # -> bff/dist
```

### Продовый образ

```bash
docker build -t bff:local -f bff/Dockerfile bff
```

Многостадийная сборка (`node:22-alpine`): зависимости → `tsc` → рантайм
только с `dist/`, прод-зависимостями и непривилегированным пользователем.
`HEALTHCHECK` в образе не задан — он определяется в compose Backend-репозитория
(так принято в этом стенде, см. `docker-compose.yml` там же), который умеет
поднимать `bff` либо из готового образа, либо собрать его отсюда через
`docker-compose.override.yml.example`.

## Frontend (SPA)

React-приложение на TypeScript, собирается в статические файлы (HTML/JS/CSS),
поддерживает установку как PWA и push-уведомления через service worker.

```bash
cd frontend
npm install
npm run dev      # http://localhost:5173, проксирует /api и /ws на backend
```

Экраны (см. `src/components`):

1. **Dashboard** — список активных сделок, этапы, индикаторы проблемных мест.
2. **CreateDeal** — многошаговый мастер: страна → тип операции → сумма/валюта → контрагент.
3. **ScenarioSelection** — карточки сценариев расчёта (ЦВЦБ / банковский перевод / смарт-контракт / торговое финансирование).
4. **Documents** — статус каждого документа с пояснением, зачем он нужен.
5. **Tracking** — ключевой экран: полный таймлайн, участники, статус, причины задержек.

## Сборка для продакшена

```bash
cd frontend && npm run build   # -> frontend/dist (статика для раздачи любым сервером)
cd bff && pnpm build           # -> bff/dist (node dist/index.js)
```
