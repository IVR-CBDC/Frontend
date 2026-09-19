import type { Server as HttpServer, IncomingMessage } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { importJWK, importSPKI, jwtVerify, type JWK } from "jose";
import type { Config } from "../config.js";
import { COOKIE_NAME } from "../session.js";

const HEARTBEAT_INTERVAL_MS = 25_000;
const CHANNEL_PREFIX = "deal-events:";

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

export type DealEventType = "deal.updated" | "deal.created" | "notification.created";

export interface DealEvent {
  type: DealEventType;
  seq: number;
  dealId?: string;
  notificationId?: string;
  at: string;
}

// Минимальный интерфейс Redis-подписчика, который нужен хабу. В проде это
// ioredis; в тестах — фейк, публикующий "pmessage" вручную без реального
// Redis (описано в бифе задачи 4).
export interface RedisSubscriberLike {
  psubscribe(pattern: string): unknown;
  on(event: "pmessage", listener: (pattern: string, channel: string, message: string) => void): unknown;
  quit(): unknown;
}

export interface VerifyTokenResult {
  companyId: string;
}

export interface WsHubDeps {
  redis: RedisSubscriberLike;
  verifyToken: (token: string) => Promise<VerifyTokenResult>;
}

interface ClientState {
  companyId: string;
  seenSeq: Set<number>;
}

let wss: WebSocketServer | null = null;
let redisSubscriber: RedisSubscriberLike | null = null;

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
    at: typeof raw.at === "string" ? raw.at : new Date().toISOString(),
  };
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
export function initWebSocketHub(server: HttpServer, deps: WsHubDeps): void {
  wss = new WebSocketServer({ server, path: "/ws" });
  redisSubscriber = deps.redis;

  redisSubscriber.on("pmessage", handlePMessage);
  redisSubscriber.psubscribe(`${CHANNEL_PREFIX}*`);

  wss.on("connection", (socket: WebSocket, request: IncomingMessage) => {
    const token = parseSessionCookie(request.headers.cookie);
    if (!token) {
      socket.close(4401, "Требуется авторизация");
      return;
    }

    deps
      .verifyToken(token)
      .then(({ companyId }) => {
        if (socket.readyState !== WebSocket.OPEN) return; // клиент отключился, пока ждали проверку токена

        stateByClient.set(socket, { companyId, seenSeq: new Set() });
        addClient(companyId, socket);

        socket.send(JSON.stringify({ type: "connection.ack" }));

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
}

// Закрывает Redis-подписку и все открытые сокеты — вызывается из SIGTERM в
// index.ts, чтобы процесс не завершался, бросив клиентов и соединение с
// Redis висеть.
export async function closeWebSocketHub(): Promise<void> {
  if (redisSubscriber) {
    await Promise.resolve(redisSubscriber.quit());
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
  const redis: RedisSubscriberLike = new Redis(config.redisUrl);

  return { redis, verifyToken };
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
