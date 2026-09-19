# Alfa Global CBDC Hub

Личный кабинет юридического лица для сопровождения внешнеэкономических сделок
от начала до завершения: финансовая сторона, документооборот, регуляторные
проверки, статус исполнения.

## Структура репозитория

```
alfa-cbdc-hub/
├── bff/         BFF-слой (Node.js + Express + WebSocket)
└── frontend/    Клиентское SPA (React + TypeScript + Vite, с поддержкой PWA)
```

## BFF

Агрегирует данные, реализует бизнес-логику для UI, кеширование и сервис
уведомлений в реальном времени через WebSocket.

```bash
cd bff
pnpm install
pnpm dev         # http://localhost:4000, WS: ws://localhost:4000/ws
pnpm test        # vitest
pnpm typecheck
```

Основные REST-эндпоинты (контракт, к которому идёт реализация):

| Метод | Путь | Экран |
|---|---|---|
| GET | `/api/dashboard` | 1. Главная — сводка по сделкам |
| GET | `/api/notifications` | Уведомления |
| POST | `/api/deals` | 2. Создание сделки (мастер) |
| GET | `/api/scenarios` | 3. Выбор сценария расчёта |
| POST | `/api/deals/:id/scenario` | 3. Подтверждение сценария |
| PATCH | `/api/deals/:dealId/documents/:documentId` | 4. Документооборот |
| GET | `/api/deals/:id/tracking` | 5. Трекинг сделки |

Моковые данные удалены: сейчас каждый из этих маршрутов отвечает
`501 NOT_IMPLEMENTED` (см. `bff/src/routes/deals.ts`) — реальную реализацию
поверх сервисов бэкенда добавляет отдельная задача (Task 3 плана 05).

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
