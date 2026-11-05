import type { Server as HttpServer, IncomingMessage } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { importJWK, importSPKI, jwtVerify, type JWK } from "jose";
import type { Config } from "../config.js";
import { COOKIE_NAME } from "../session.js";




import type { DealEvent, DealEventType } from "../types.js";

export type { DealEvent, DealEventType };

const HEARTBEAT_INTERVAL_MS = 25_000;
const CHANNEL_PREFIX = "deal-events:";










export const DEAD_CHECK_INTERVAL_MS = 30_000;
















export const MAX_SEEN_SEQ = 500;






export const DEFAULT_SUBSCRIBE_TIMEOUT_MS = 5_000;







const REDIS_CONNECT_TIMEOUT_MS = 3_000;
const REDIS_STARTUP_MAX_ATTEMPTS = 5;
const REDIS_MAX_RETRIES_PER_REQUEST = 3;




export interface RedisSubscriberLike {
  psubscribe(pattern: string): unknown;
  on(event: "pmessage", listener: (pattern: string, channel: string, message: string) => void): unknown;
  quit(): unknown;
  
  
  
  
  
  
  readonly status?: string;
}

export interface VerifyTokenResult {
  companyId: string;
}

export interface WsHubDeps {
  onCompanyEvent?: (companyId: string, event: DealEvent) => Promise<void> | void;
  redis: RedisSubscriberLike;
  verifyToken: (token: string) => Promise<VerifyTokenResult>;
  
  
  
  
  
  
  allowedOrigins: string[];
  
  
  subscribeTimeoutMs?: number;
  
  
  deadCheckIntervalMs?: number;
}

interface ClientState {
  companyId: string;
  seenSeq: Set<number>;
  
  
  
  isAlive: boolean;
}

let wss: WebSocketServer | null = null;
let redisSubscriber: RedisSubscriberLike | null = null;
let deadCheckInterval: ReturnType<typeof setInterval> | null = null;
let onCompanyEvent: WsHubDeps["onCompanyEvent"];

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
    
    
    
    
    
    at: typeof raw.at === "string" ? raw.at : warnMissingAt(),
  };
}





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


export function _resetWarnMissingAtForTests(): void {
  warnedMissingAt = false;
}






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

  const event = parseDealEvent(message);
  if (!event) {
    console.warn(`ws/hub: некорректное событие в канале ${channel}, пропущено`);
    return;
  }

  void onCompanyEvent?.(companyId, event);
  const sockets = clientsByCompany.get(companyId);
  if (!sockets || sockets.size === 0) return;

  const payload = JSON.stringify(event);
  for (const socket of sockets) {
    if (socket.readyState !== WebSocket.OPEN) continue;
    const state = stateByClient.get(socket);
    if (!state) continue;
    if (!shouldDeliver(state, event.seq)) continue;
    socket.send(payload);
  }
}

// Поднимает WS-хаб на уже созданном HTTP-сервере: недопустимый Origin
// отклоняется ДО завершения handshake (verifyClient ниже — сервер сам
// пишет HTTP-ответ 403 и рвёт сокет, апгрейд до 101 не доходит вовсе), а
// проверка сессии — уже после успешного апгрейда: невалидный/отсутствующий
// клиент закрывается кодом 4401 (диапазон 4000-4999 зарезервирован под
// собственные коды приложения, отправить его можно только после успешного
// handshake, поэтому не раньше события "connection" — в отличие от Origin,
// у сессии нет более раннего места для проверки, потому что cookie парсится
// из того же request, который verifyClient уже видел бы, но верить в целую
// куку — не структурная проверка уровня "с этой страницы вообще можно
// открывать сокет").
export async function initWebSocketHub(server: HttpServer, deps: WsHubDeps): Promise<void> {
  // F12 (final review): раньше повторный вызов (без closeWebSocketHub
  // между ними) тихо навешивал второй "pmessage"-листенер на нового
  // redisSubscriber и терял старый wss/interval — в проде вызывается один
  // раз, но это грабли для тестов и для любого будущего кода перезапуска.
  // Подчищаем предыдущее состояние хаба перед тем, как поднимать новое.
  if (wss || redisSubscriber) {
    await closeWebSocketHub();
  }

  wss = new WebSocketServer({
    server,
    path: "/ws",
    // F2 (final review, round 2): проверка Origin в обработчике "connection"
    // запускалась ПОСЛЕ того, как ws уже отправил 101 Switching Protocols —
    // хендшейк успевал завершиться, и только потом сокет закрывался 4403.
    // Страница с чужого origin всё равно получала открытый сокет на
    // мгновение — ровно то "accept first, close later", что и было
    // дырой. verifyClient вызывается ДО апгрейда: если callback(false, ...),
    // ws сам пишет HTTP-ответ с заданным статусом и рвёт TCP-соединение —
    // хендшейк до 101 не доходит вовсе, клиент никогда не получает "open".
    verifyClient(info, callback) {
      const origin = info.origin;
      if (!origin || !deps.allowedOrigins.includes(origin)) {
        callback(false, 403, "Недопустимый источник");
        return;
      }
      callback(true);
    },
  });
  redisSubscriber = deps.redis;
  onCompanyEvent = deps.onCompanyEvent;

  redisSubscriber.on("pmessage", handlePMessage);

  wss.on("connection", (socket: WebSocket, request: IncomingMessage) => {
    // Origin уже проверен в verifyClient выше — до этой точки долетают
    // только запросы с разрешённым Origin. Ниже — проверка сессии, у
    // которой (в отличие от Origin) нет более раннего места: cookie не
    // структурная характеристика запроса, а состояние, действительность
    // которого решает verifyToken() асинхронно, поэтому закрыть 4401 можно
    // только после того, как сокет уже открыт.
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
  onCompanyEvent = undefined;
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
  const { sendPushToCompany } = await import("../services/push.js");
  return {
    redis: redisLike,
    verifyToken,
    allowedOrigins: config.allowedOrigins,
    onCompanyEvent: (companyId, event) =>
      sendPushToCompany(companyId, {
        title: "Alfa Global CBDC Hub",
        body: event.type === "notification.created" ? "Новое уведомление по сделке" : "Статус сделки обновлён",
        dealId: event.dealId,
        type: event.type,
      }).catch((error) => console.error("Не удалось отправить push-уведомление:", error)),
  };
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
