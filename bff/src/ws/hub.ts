import type { Server as HttpServer, IncomingMessage } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { importJWK, importSPKI, jwtVerify, type JWK } from "jose";
import type { Config } from "../config.js";
import { COOKIE_NAME } from "../session.js";
// F8 (final review): тип кадра события — часть контракта BFF↔SPA, теперь
// живёт в types.ts вместе с остальными типами этого контракта, а не только
// здесь. Ре-экспортируем ниже, чтобы не ломать то, что уже импортирует их
// отсюда (см. tests/ws.test.ts).
import type { DealEvent, DealEventType } from "../types.js";

export type { DealEvent, DealEventType };

const HEARTBEAT_INTERVAL_MS = 25_000;
const CHANNEL_PREFIX = "deal-events:";

// F6 (final review): протокольные ping/pong (в отличие от JSON-heartbeat
// выше, который сервер только отправляет) — стандартный для `ws` приём
// обнаружения мёртвых сокетов. Клиент, исчезнувший без TCP FIN (закрыли
// крышку, NAT, выселение пода), никогда не даст событие "close": без этого
// его запись в clientsByCompany и таймер heartbeat тикали бы вечно. Интервал
// должен быть заметно больше времени, за которое реальный клиент успевает
// ответить pong (сетевой RTT), но не настолько большим, чтобы утечка жила
// долго — 30с (чуть больше HEARTBEAT_INTERVAL_MS) даёт клиенту минимум один
// полный цикл на ответ, прежде чем его сочтут мёртвым на СЛЕДУЮЩЕМ тике.
export const DEAD_CHECK_INTERVAL_MS = 30_000;

// Дедупликация по seq — на "виденный набор", а не на "выше последнего":
// спека §4.4 говорит, что core присваивает seq при INSERT в outbox-таблицу,
// а коммиты конкурентных транзакций попадают в Redis не в порядке seq. Событие
// с seq меньше уже показанного клиенту — не обязательно повтор, это может быть
// более старая по seq, но позже закоммиченная реальная запись. Если отбрасывать
// всё, что меньше максимума увиденного, часть настоящих обновлений сделки
// никогда не долетит до клиента. Поэтому храним множество виденных seq
// целиком (для дедупликации только точных повторов), а не одну границу.
//
// Ограничение размера множества — отдельная, не связанная с этим забота:
// сокет может жить часами, и без верхней границы Set рос бы неограниченно.
// 500 — с большим запасом больше, чем любой реалистичный всплеск повторных
// доставок одного сокета (at-least-once подразумевает единицы повторов, а не
// сотни), вычищаем по FIFO (Set сохраняет порядок вставки, поэтому первый
// элемент — самый старый).
export const MAX_SEEN_SEQ = 500;

// Сколько ждём подтверждённой Redis-подписки при старте, прежде чем сдаться:
// достаточно долго для локали/compose (Redis уже поднят по healthcheck в
// depends_on), но ограничено, чтобы недоступный Redis приводил к быстрому и
// громкому отказу процесса, а не к бесконечному "зависанию" без HTTP-порта и
// без диагностики (см. отчёт задачи 4, round 2).
export const DEFAULT_SUBSCRIBE_TIMEOUT_MS = 5_000;

// Параметры боевого ioredis-клиента (createProductionWsHubDeps):
// connectTimeout — сколько ждём TCP-соединение с Redis на каждую попытку;
// REDIS_STARTUP_MAX_ATTEMPTS — сколько попыток переподключения делаем, пока
// не было ни одного успешного подключения, прежде чем retryStrategy
// сдаётся (см. комментарий у createProductionWsHubDeps);
// DEFAULT_SUBSCRIBE_TIMEOUT_MS выше — итоговая страховка поверх этого всего.
const REDIS_CONNECT_TIMEOUT_MS = 3_000;
const REDIS_STARTUP_MAX_ATTEMPTS = 5;
const REDIS_MAX_RETRIES_PER_REQUEST = 3;

// Минимальный интерфейс Redis-подписчика, который нужен хабу. В проде это
// ioredis; в тестах — фейк, публикующий "pmessage" вручную без реального
// Redis (описано в бифе задачи 4).
export interface RedisSubscriberLike {
  psubscribe(pattern: string): unknown;
  on(event: "pmessage", listener: (pattern: string, channel: string, message: string) => void): unknown;
  quit(): unknown;
  // F10 (final review): необязательное поле — ioredis отдаёт живой статус
  // соединения через геттер .status ("ready" только когда подписка реально
  // активна прямо сейчас, а не "когда-то была подтверждена"; после обрыва
  // клиент уходит в "reconnecting", и /ready должен это увидеть). Фейки в
  // тестах его не реализуют — считаем такой подписчик всегда готовым же,
  // т.к. это не предмет их тестов (см. isRedisSubscriberReady ниже).
  readonly status?: string;
}

export interface VerifyTokenResult {
  companyId: string;
}

export interface WsHubDeps {
  redis: RedisSubscriberLike;
  verifyToken: (token: string) => Promise<VerifyTokenResult>;
  // F2 (final review): WS-рукопожатие не подчиняется CORS (checkOrigin в
  // session.ts защищает только HTTP-сторону) — без этой проверки страница с
  // чужого origin могла бы открыть сокет и получать события компании,
  // используя только то, что cookie сессии уедет с запросом (SameSite=Strict
  // сегодня это ещё не пускает, но это свойство cookie, а не WS-хаба, и его
  // однажды могут ослабить). Тот же список, что использует checkOrigin.
  allowedOrigins: string[];
  // Переопределяется только в тестах, чтобы не ждать DEFAULT_SUBSCRIBE_TIMEOUT_MS
  // по-настоящему — в проде всегда берётся значение по умолчанию.
  subscribeTimeoutMs?: number;
  // Аналогично — переопределяется только в тестах (F6), чтобы не ждать
  // боевые DEAD_CHECK_INTERVAL_MS.
  deadCheckIntervalMs?: number;
}

interface ClientState {
  companyId: string;
  seenSeq: Set<number>;
  // F6 (final review): true — клиент ответил на последний ping (или ещё не
  // проверялся ни разу); interval выставляет false перед каждым новым ping
  // и terminate()-ит сокет, если застаёт его всё ещё false на следующем тике.
  isAlive: boolean;
}

let wss: WebSocketServer | null = null;
let redisSubscriber: RedisSubscriberLike | null = null;
let deadCheckInterval: ReturnType<typeof setInterval> | null = null;

const clientsByCompany = new Map<string, Set<WebSocket>>();
const stateByClient = new WeakMap<WebSocket, ClientState>();

function parseSessionCookie(header: string | undefined): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const name = part.slice(0, eq).trim();
    if (name === COOKIE_NAME) {
      const value = part.slice(eq + 1).trim();
      try {
        return decodeURIComponent(value);
      } catch {
        return value;
      }
    }
  }
  return undefined;
}

function addClient(companyId: string, socket: WebSocket): void {
  let sockets = clientsByCompany.get(companyId);
  if (!sockets) {
    sockets = new Set();
    clientsByCompany.set(companyId, sockets);
  }
  sockets.add(socket);
}

// Убирает сокет из набора компании и, если набор опустел, сам набор —
// иначе Map<companyId, Set<...>> будет копить пустые записи на каждую
// компанию, чей последний сокет когда-либо отключался.
function removeClient(companyId: string, socket: WebSocket): void {
  const sockets = clientsByCompany.get(companyId);
  if (!sockets) return;
  sockets.delete(socket);
  if (sockets.size === 0) {
    clientsByCompany.delete(companyId);
  }
}

function shouldDeliver(state: ClientState, seq: number): boolean {
  if (state.seenSeq.has(seq)) return false;
  state.seenSeq.add(seq);
  if (state.seenSeq.size > MAX_SEEN_SEQ) {
    const oldest = state.seenSeq.values().next().value;
    if (oldest !== undefined) {
      state.seenSeq.delete(oldest);
    }
  }
  return true;
}

function parseDealEvent(message: string): DealEvent | null {
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(message) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (
    typeof raw.seq !== "number" ||
    (raw.type !== "deal.updated" && raw.type !== "deal.created" && raw.type !== "notification.created")
  ) {
    return null;
  }
  return {
    type: raw.type,
    seq: raw.seq,
    dealId: typeof raw.deal_id === "string" ? raw.deal_id : undefined,
    notificationId: typeof raw.notification_id === "string" ? raw.notification_id : undefined,
    // at не всегда присутствует в реальном payload core (см. отчёт задачи 4) —
    // подстраховываемся временем получения на стороне BFF, а не роняем событие.
    // Предупреждаем в лог: время получения BFF — не то же самое, что время
    // события в core, и если это происходит систематически (а не разово),
    // это симптом на стороне core, который иначе останется незамеченным.
    at: typeof raw.at === "string" ? raw.at : warnMissingAt(),
  };
}

// F12 (final review): раньше писал в лог на каждое такое событие — если
// core систематически не присылает at, это заливает лог одним и тем же
// предупреждением бесконечно. Предупреждаем один раз за жизнь процесса:
// этого достаточно, чтобы заметить симптом, не заливая лог.
let warnedMissingAt = false;

function warnMissingAt(): string {
  if (!warnedMissingAt) {
    warnedMissingAt = true;
    console.warn(
      "ws/hub: событие от core без поля at, подставлено время получения BFF " +
        "(повторные предупреждения об этом подавлены до перезапуска процесса)",
    );
  }
  return new Date().toISOString();
}

// Только для тестов — иначе тесты в одном файле зависят от порядка запуска.
export function _resetWarnMissingAtForTests(): void {
  warnedMissingAt = false;
}

// Оборачивает промис таймаутом: если он не устаканится (не resolve, не reject)
// за ms миллисекунд — отклоняем с понятным сообщением. Нужен как страховка
// поверх ioredis-таймаутов/retryStrategy: даже если клиент сконфигурирован
// неверно и завис бы на самой команде, initWebSocketHub всё равно не
// зависнет молча навсегда.
function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err instanceof Error ? err : new Error(String(err)));
      },
    );
  });
}

function companyIdFromChannel(channel: string): string | null {
  if (!channel.startsWith(CHANNEL_PREFIX)) return null;
  const companyId = channel.slice(CHANNEL_PREFIX.length);
  return companyId.length > 0 ? companyId : null;
}

function handlePMessage(_pattern: string, channel: string, message: string): void {
  const companyId = companyIdFromChannel(channel);
  if (!companyId) return;

  const sockets = clientsByCompany.get(companyId);
  if (!sockets || sockets.size === 0) return;

  const event = parseDealEvent(message);
  if (!event) {
    console.warn(`ws/hub: некорректное событие в канале ${channel}, пропущено`);
    return;
  }

  const payload = JSON.stringify(event);
  for (const socket of sockets) {
    if (socket.readyState !== WebSocket.OPEN) continue;
    const state = stateByClient.get(socket);
    if (!state) continue;
    if (!shouldDeliver(state, event.seq)) continue;
    socket.send(payload);
  }
}

// Поднимает WS-хаб на уже созданном HTTP-сервере: апгрейд принимается всегда
// (это уровень протокола ws), а проверка сессии происходит сразу после —
// невалидный/отсутствующий клиент закрывается кодом 4401 (диапазон 4000-4999
// зарезервирован под собственные коды приложения, отправить его можно только
// после успешного handshake, поэтому не раньше события "connection").
export async function initWebSocketHub(server: HttpServer, deps: WsHubDeps): Promise<void> {
  // F12 (final review): раньше повторный вызов (без closeWebSocketHub
  // между ними) тихо навешивал второй "pmessage"-листенер на нового
  // redisSubscriber и терял старый wss/interval — в проде вызывается один
  // раз, но это грабли для тестов и для любого будущего кода перезапуска.
  // Подчищаем предыдущее состояние хаба перед тем, как поднимать новое.
  if (wss || redisSubscriber) {
    await closeWebSocketHub();
  }

  wss = new WebSocketServer({ server, path: "/ws" });
  redisSubscriber = deps.redis;

  redisSubscriber.on("pmessage", handlePMessage);

  wss.on("connection", (socket: WebSocket, request: IncomingMessage) => {
    // F2 (final review): проверяем Origin ДО cookie/токена и отдельным
    // кодом (4403, а не 4401) — это структурная проверка "с этой страницы
    // вообще можно открывать сокет", а не "эта сессия недействительна".
    // Апгрейд принимается на уровне протокола ws раньше (см. комментарий
    // над initWebSocketHub), поэтому закрыть с прикладным кодом можно
    // только здесь, после события "connection" — так же, как уже сделано
    // для 4401.
    const origin = request.headers.origin;
    if (!origin || !deps.allowedOrigins.includes(origin)) {
      socket.close(4403, "Недопустимый источник");
      return;
    }

    const token = parseSessionCookie(request.headers.cookie);
    if (!token) {
      socket.close(4401, "Требуется авторизация");
      return;
    }

    deps
      .verifyToken(token)
      .then(({ companyId }) => {
        if (socket.readyState !== WebSocket.OPEN) return; // клиент отключился, пока ждали проверку токена

        stateByClient.set(socket, { companyId, seenSeq: new Set(), isAlive: true });
        addClient(companyId, socket);

        socket.send(JSON.stringify({ type: "connection.ack" }));

        // F6 (final review): протокольный pong — ws-клиент отвечает на
        // ping автоматически на транспортном уровне без участия
        // прикладного кода клиента, поэтому это работает даже для клиентов,
        // которые никогда не смотрят на кадры heartbeat/connection.ack.
        socket.on("pong", () => {
          const state = stateByClient.get(socket);
          if (state) state.isAlive = true;
        });

        const heartbeat = setInterval(() => {
          if (socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ type: "heartbeat", at: new Date().toISOString() }));
          }
        }, HEARTBEAT_INTERVAL_MS);

        socket.on("close", () => {
          clearInterval(heartbeat);
          removeClient(companyId, socket);
          stateByClient.delete(socket);
        });
      })
      .catch(() => {
        // Невалидный токен — cookie есть, но подпись/claims не сошлись.
        socket.close(4401, "Недействительный токен");
      });
  });

  // F6 (final review): единственный серверный interval на весь хаб (не по
  // одному на сокет) — ping()-ует всех аутентифицированных клиентов и
  // terminate()-ит тех, кто не ответил pong'ом с прошлого тика. Сокеты, ещё
  // не прошедшие verifyToken (stateByClient пуст), не пингуем — у них нет
  // isAlive, и если клиент завис на этом этапе, соединение и так ничего не
  // держит подписанным в clientsByCompany.
  const deadCheckIntervalMs = deps.deadCheckIntervalMs ?? DEAD_CHECK_INTERVAL_MS;
  deadCheckInterval = setInterval(() => {
    if (!wss) return;
    for (const socket of wss.clients) {
      const state = stateByClient.get(socket);
      if (!state) continue;
      if (!state.isAlive) {
        socket.terminate();
        continue;
      }
      state.isAlive = false;
      socket.ping();
    }
  }, deadCheckIntervalMs);

  // Ждём подтверждения подписки от Redis, а не только факта вызова
  // psubscribe(): ioredis буферизует команды, пока соединение устанавливается,
  // поэтому вызов psubscribe() до его завершения не гарантирует, что сервер
  // Redis уже подписал нас на канал. Возвращаем управление вызывающему коду
  // (index.ts) только после подтверждения — иначе есть окно между стартом
  // HTTP-сервера и реальной подпиской, в которое опубликованные события
  // были бы потеряны.
  //
  // Но ждём не бесконечно: если Redis недоступен, ioredis по умолчанию будет
  // копить psubscribe() в offline-очереди и переподключаться вечно — сам
  // промис никогда не разрешится и не отклонится, а процесс зависнет без
  // открытого HTTP-порта и без единой строчки в логе (round 2 отчёта задачи
  // 4). withTimeout — итоговая страховка сверху retryStrategy/connectTimeout
  // клиента (createProductionWsHubDeps): даже если они настроены неверно,
  // initWebSocketHub всё равно завершится отказом за конечное время.
  const timeoutMs = deps.subscribeTimeoutMs ?? DEFAULT_SUBSCRIBE_TIMEOUT_MS;
  try {
    await withTimeout(
      Promise.resolve(redisSubscriber.psubscribe(`${CHANNEL_PREFIX}*`)),
      timeoutMs,
      `Не удалось подтвердить подписку на Redis-канал ${CHANNEL_PREFIX}* за ${timeoutMs} мс`,
    );
  } catch (err) {
    // Не оставляем половинчато поднятый хаб: закрываем то, что успели создать
    // (wss и, если получится, redisSubscriber), чтобы вызывающий код (index.ts)
    // мог упасть с чистым состоянием, а не с повисшим сервером и подпиской.
    // Ошибку самой очистки проглатываем — исходная причина отказа (таймаут/
    // недоступный Redis) важнее и не должна быть замаскирована.
    try {
      await closeWebSocketHub();
    } catch {
      // см. комментарий выше
    }
    throw err;
  }
}

// Закрывает Redis-подписку и все открытые сокеты — вызывается из SIGTERM в
// index.ts, чтобы процесс не завершался, бросив клиентов и соединение с
// Redis висеть.
export async function closeWebSocketHub(): Promise<void> {
  if (deadCheckInterval) {
    clearInterval(deadCheckInterval);
    deadCheckInterval = null;
  }

  if (redisSubscriber) {
    try {
      await Promise.resolve(redisSubscriber.quit());
    } catch {
      // Соединение уже могло быть разорвано (например, initWebSocketHub
      // зовёт closeWebSocketHub() после неудачной/просроченной подписки) —
      // quit() на уже мёртвом клиенте может отклониться, это не повод ронять
      // само закрытие хаба.
    }
    redisSubscriber = null;
  }

  if (wss) {
    const server = wss;
    for (const socket of server.clients) {
      socket.close(1001, "Сервер завершает работу");
    }
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
    wss = null;
  }

  clientsByCompany.clear();
}

// F10 (final review): "готовность" для /ready — состояние Redis-подписчика
// В МОМЕНТЕ запроса, а не факт, что initWebSocketHub() когда-то дождался
// подтверждённой подписки при старте. После обрыва соединения ioredis по
// умолчанию уходит в бесконечные переподключения (см. createProductionWsHubDeps)
// молча, не роняя процесс — без этой проверки /ready продолжал бы отвечать
// "готов", пока BFF на самом деле не доставляет ни одного события. "ready" —
// единственный статус ioredis, означающий "подписка сейчас реально активна";
// подписчик без .status (фейки в тестах хаба) считается готовым — это не то,
// что проверяют те тесты.
export function isRedisSubscriberReady(): boolean {
  if (!redisSubscriber) return false;
  return redisSubscriber.status === undefined || redisSubscriber.status === "ready";
}

// Только для тестов: снимок размеров множеств увиденных seq у сокетов
// компании — единственный способ снаружи проверить, что дедупликация
// ограничена по памяти, не раскрывая внутреннее состояние как публичный API.
export function _debugSeenSeqSizes(companyId: string): number[] {
  const sockets = clientsByCompany.get(companyId);
  if (!sockets) return [];
  return [...sockets].map((socket) => stateByClient.get(socket)?.seenSeq.size ?? 0);
}

// --- Сборка боевых зависимостей хаба --------------------------------------

// Собирает зависимости для реального запуска: один раз при старте забирает
// публичный ключ auth (без него апгрейд WS вообще нельзя проверить — лучше
// упасть сразу на старте процесса, чем поднять сервис, который не может
// отличить настоящего клиента от подделки) и создаёт ioredis-подписчика.
export async function createProductionWsHubDeps(config: Config): Promise<WsHubDeps> {
  const publicKey = await fetchAuthPublicKey(config.authUrl);

  const verifyToken = async (token: string): Promise<VerifyTokenResult> => {
    const { payload } = await jwtVerify(token, publicKey, {
      issuer: "service-auth",
      audience: "internal",
    });
    if (typeof payload.company_id !== "string") {
      throw new Error("В токене отсутствует company_id");
    }
    return { companyId: payload.company_id };
  };

  const { default: Redis } = await import("ioredis");

  // По умолчанию ioredis переподключается бесконечно и копит команды в
  // offline-очереди, пока не подключится — удобно во время работы (обрыв
  // соединения не должен убивать уже стартовавший процесс), но опасно на
  // старте: initWebSocketHub() теперь дожидается подтверждённой подписки
  // (round 1 задачи 4), и недоступный Redis без этих ограничений превратил
  // бы await psubscribe() в вечное зависание без единой строчки в логе.
  //
  // connectedOnce переключает поведение retryStrategy: пока не было ни
  // одного успешного подключения — ретраи ограничены (даём Redis шанс
  // подняться, но не вечно, чтобы initWebSocketHub() отказал быстро и
  // громко). После первого успешного подключения — то же самое соединение
  // обязано переподключаться неограниченно при обрыве: рантайм-устойчивость
  // и строгость старта — разные задачи, и уже работающий сервис не должен
  // падать из-за временного сетевого сбоя.
  let connectedOnce = false;
  const redis = new Redis(config.redisUrl, {
    connectTimeout: REDIS_CONNECT_TIMEOUT_MS,
    maxRetriesPerRequest: REDIS_MAX_RETRIES_PER_REQUEST,
    retryStrategy(times) {
      if (!connectedOnce && times > REDIS_STARTUP_MAX_ATTEMPTS) {
        // null останавливает переподключение — offline-очередь (включая
        // наш psubscribe) тут же отклоняется с ошибкой вместо вечного
        // ожидания.
        return null;
      }
      return Math.min(times * 50, 2000);
    },
  });
  redis.once("ready", () => {
    connectedOnce = true;
  });

  const redisLike: RedisSubscriberLike = redis;
  return { redis: redisLike, verifyToken, allowedOrigins: config.allowedOrigins };
}

// Эндпоинт называется .well-known/jwks.json, но исторически (и осознанно —
// это опубликованный контракт, не переименовываем в рамках этого плана)
// отдаёт не JWKS-документ, а сырой публичный ключ одним объектом. На живом
// стенде это оказался JWK JSON (RSA n/e), а не PEM-текст, которым эндпоинт
// назван по контент-тайпу (application/x-pem-file) и по описанию в брифе —
// поэтому разбираем оба варианта: если тело парсится как JSON-объект с
// полем kty, это JWK; иначе трактуем тело как PEM.
async function fetchAuthPublicKey(authUrl: string) {
  const response = await fetch(`${authUrl}/api/auth/.well-known/jwks.json`);
  if (!response.ok) {
    throw new Error(
      `Не удалось получить публичный ключ auth (HTTP ${response.status}) — без него BFF не может проверять токены на апгрейде WebSocket`,
    );
  }
  const body = await response.text();

  const asJwk = tryParseJwk(body);
  if (asJwk) {
    return importJWK(asJwk, "RS256");
  }
  return importSPKI(body, "RS256");
}

function tryParseJwk(body: string): JWK | null {
  try {
    const parsed = JSON.parse(body) as unknown;
    if (parsed && typeof parsed === "object" && "kty" in parsed) {
      return parsed as JWK;
    }
    return null;
  } catch {
    return null;
  }
}
