import { afterEach, describe, expect, it, vi } from "vitest";
import { createServer } from "node:http";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { EventEmitter } from "node:events";
import { WebSocket } from "ws";
import {
  initWebSocketHub,
  closeWebSocketHub,
  isRedisSubscriberReady,
  MAX_SEEN_SEQ,
  _debugSeenSeqSizes,
  _resetWarnMissingAtForTests,
  type RedisSubscriberLike,
  type VerifyTokenResult,
} from "../src/ws/hub.js";

// Фейковый Redis-подписчик: реализует ровно тот интерфейс, который нужен
// хабу (psubscribe/on("pmessage")/quit), а события публикует тест вручную
// через fakeRedis.emit("pmessage", ...) — без поднятия настоящего Redis.
class FakeRedisSubscriber extends EventEmitter implements RedisSubscriberLike {
  psubscribe(): unknown {
    return Promise.resolve(1);
  }
  quit(): unknown {
    return Promise.resolve("OK");
  }
}

// Фейк, который никогда не подтверждает подписку — имитирует недоступный
// Redis без ограничений на клиенте (offline-очередь копится вечно): нужен,
// чтобы доказать, что initWebSocketHub() сама себя не подвешивает навсегда,
// а отклоняется по таймауту (round 2 отчёта задачи 4).
class HangingRedisSubscriber extends EventEmitter implements RedisSubscriberLike {
  psubscribe(): unknown {
    return new Promise(() => {
      // намеренно никогда не resolve/reject — как offline-очередь ioredis
      // без maxRetriesPerRequest/retryStrategy-ограничения.
    });
  }
  quit(): unknown {
    return Promise.resolve("OK");
  }
}

// Токены — просто метки на фейковый company_id, реальный JWT/jose здесь не
// нужен: проверка подписи/claims — забота createProductionWsHubDeps,
// покрытая живой проверкой в отчёте, а не этим тестом.
const TOKENS: Record<string, VerifyTokenResult> = {
  "token-company-a": { companyId: "company-a" },
  "token-company-b": { companyId: "company-b" },
};

async function fakeVerifyToken(token: string): Promise<VerifyTokenResult> {
  const result = TOKENS[token];
  if (!result) {
    throw new Error("недействительный токен");
  }
  return result;
}

const ALLOWED_ORIGIN = "http://localhost:5173";

let server: Server;
let fakeRedis: FakeRedisSubscriber;
let port: number;
const openSockets: WebSocket[] = [];

async function startHub(deadCheckIntervalMs?: number): Promise<void> {
  server = createServer();
  fakeRedis = new FakeRedisSubscriber();
  await initWebSocketHub(server, {
    redis: fakeRedis,
    verifyToken: fakeVerifyToken,
    allowedOrigins: [ALLOWED_ORIGIN],
    deadCheckIntervalMs,
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  port = (server.address() as AddressInfo).port;
}

// origin по умолчанию — разрешённый: большинству существующих тестов (про
// cookie/токен/доставку событий) проверка Origin из F2 не касается, им
// важно только пройти её и попасть дальше в проверку токена. `null` —
// отдельный сигнал "заголовок Origin вовсе не отправлять" (в отличие от
// default-параметра, который сработал бы и на explicit undefined).
function connect(cookie: string | undefined, origin: string | null = ALLOWED_ORIGIN): WebSocket {
  const headers: Record<string, string> = {};
  if (cookie) headers.Cookie = cookie;
  if (origin !== null) headers.Origin = origin;
  const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers });
  openSockets.push(socket);
  return socket;
}

function waitForOpen(socket: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.once("open", () => resolve());
    socket.once("error", reject);
  });
}

function waitForClose(socket: WebSocket): Promise<{ code: number; reason: string }> {
  return new Promise((resolve) => {
    socket.once("close", (code, reason) => resolve({ code, reason: reason.toString() }));
  });
}

// Собирает разобранные JSON-сообщения сокета, отфильтровывая служебные
// connection.ack/heartbeat — тестам нужны только доставленные события сделок.
function collectDealEvents(socket: WebSocket): { events: unknown[]; wait: (count: number) => Promise<void> } {
  const events: unknown[] = [];
  let resolveWait: (() => void) | null = null;
  let waitCount = 0;

  socket.on("message", (raw) => {
    const parsed = JSON.parse(raw.toString());
    if (parsed.type === "connection.ack" || parsed.type === "heartbeat") return;
    events.push(parsed);
    if (resolveWait && events.length >= waitCount) {
      resolveWait();
      resolveWait = null;
    }
  });

  return {
    events,
    wait: (count: number) =>
      new Promise((resolve) => {
        if (events.length >= count) {
          resolve();
          return;
        }
        waitCount = count;
        resolveWait = resolve;
      }),
  };
}

function publish(channel: string, event: Record<string, unknown>): void {
  fakeRedis.emit("pmessage", "deal-events:*", channel, JSON.stringify(event));
}

afterEach(async () => {
  for (const socket of openSockets.splice(0)) {
    socket.close();
  }
  await closeWebSocketHub();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

// Ждёт либо "open" (хендшейк состоялся), либо "unexpected-response" (сервер
// ответил НЕ 101 — HTTP-ответ с кодом статуса вместо апгрейда, verifyClient
// отклонил ДО хендшейка) — ровно то различие, которое доказывает или
// опровергает "accept first, close later". Если бы сервер сначала принимал
// апгрейд, а потом закрывал сокет прикладным кодом (старая, дырявая
// реализация), здесь сработал бы "open", а не "unexpected-response".
function waitForHandshakeOutcome(
  socket: WebSocket,
): Promise<{ outcome: "open" } | { outcome: "unexpected-response"; statusCode: number | undefined }> {
  return new Promise((resolve, reject) => {
    socket.once("open", () => resolve({ outcome: "open" }));
    socket.once("unexpected-response", (_req, res) => resolve({ outcome: "unexpected-response", statusCode: res.statusCode }));
    socket.once("error", reject);
  });
}

describe("initWebSocketHub", () => {
  // F2 (final review, round 2): реви на первый заход показал, что проверка
  // Origin в обработчике "connection" срабатывала ПОСЛЕ того, как ws уже
  // отправил 101 Switching Protocols — хендшейк успевал завершиться, и
  // страница с чужого origin на мгновение получала открытый сокет (accept
  // first, close later — ровно то, что финдинг называл дисквалифицирующим).
  // Тест ниже различает это: он проверяет не "в конце концов пришёл код
  // 4403", а что хендшейк вообще НЕ состоялся (событие "open" не должно
  // произойти никогда) — против старой реализации (verifyClient отсутствует,
  // проверка в "connection") этот тест обязан упасть, потому что там "open"
  // происходит всегда, до применения самой проверки.
  it("недопустимый Origin отклоняется НА HTTP-апгрейде (403), хендшейк не завершается, событие open не происходит", async () => {
    await startHub();
    const socket = connect("session=token-company-a", "http://evil.com");
    const { events } = collectDealEvents(socket);

    const result = await waitForHandshakeOutcome(socket);
    expect(result.outcome).toBe("unexpected-response");
    if (result.outcome === "unexpected-response") {
      expect(result.statusCode).toBe(403);
    }

    publish("deal-events:company-a", { type: "deal.created", seq: 1, deal_id: "d1", at: "2026-01-01T00:00:00Z" });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(events).toHaveLength(0);
  });

  it("запрос вовсе без заголовка Origin тоже отклоняется на HTTP-апгрейде (403), а не открывается", async () => {
    await startHub();
    const socket = connect("session=token-company-a", null);

    const result = await waitForHandshakeOutcome(socket);
    expect(result.outcome).toBe("unexpected-response");
    if (result.outcome === "unexpected-response") {
      expect(result.statusCode).toBe(403);
    }
  });

  // Допустимый Origin по-прежнему нормально завершает хендшейк — регрессия
  // на "слишком строго" не менее опасна, чем дыра.
  it("допустимый Origin по-прежнему успешно проходит хендшейк (open, не unexpected-response)", async () => {
    await startHub();
    const socket = connect("session=token-company-a"); // ALLOWED_ORIGIN по умолчанию

    const result = await waitForHandshakeOutcome(socket);
    expect(result.outcome).toBe("open");
  });

  it("сокет без валидной cookie закрывается кодом 4401 и не получает событий", async () => {
    await startHub();
    const socket = connect(undefined);
    await waitForOpen(socket);
    const { events } = collectDealEvents(socket);

    const closeInfo = await waitForClose(socket);
    expect(closeInfo.code).toBe(4401);

    publish("deal-events:company-a", { type: "deal.created", seq: 1, deal_id: "d1", at: "2026-01-01T00:00:00Z" });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(events).toHaveLength(0);
  });

  it("сокет с cookie, но невалидным токеном закрывается кодом 4401, не получает событий и не остаётся в наборе компании", async () => {
    await startHub();
    // Кука присутствует (в отличие от первого теста), но verifyToken её отклонит —
    // это должно попасть в ветку .catch(), а не пройти проверку "нет cookie".
    const socket = connect("session=tampered-token");
    await waitForOpen(socket);
    const { events } = collectDealEvents(socket);

    const closeInfo = await waitForClose(socket);
    expect(closeInfo.code).toBe(4401);

    // Компания, на которую нацелились бы, если бы токен прошёл проверку —
    // company-a. Публикуем в её канал и убеждаемся, что событие никуда не
    // доставляется: сокет не должен был попасть в clientsByCompany, потому
    // что addClient() вызывается только после успешного .then(), а не в
    // .catch().
    publish("deal-events:company-a", { type: "deal.created", seq: 1, deal_id: "d1", at: "2026-01-01T00:00:00Z" });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(events).toHaveLength(0);

    // Сокет так и не должен был появиться в наборе company-a — единственный
    // внешний способ это проверить без раскрытия внутренней Map целиком.
    expect(_debugSeenSeqSizes("company-a")).toEqual([]);
  });

  it("событие компании A приходит подписчику A и не приходит подписчику B", async () => {
    await startHub();
    const socketA = connect("session=token-company-a");
    const socketB = connect("session=token-company-b");
    await Promise.all([waitForOpen(socketA), waitForOpen(socketB)]);
    const collectorA = collectDealEvents(socketA);
    const collectorB = collectDealEvents(socketB);

    publish("deal-events:company-a", { type: "deal.created", seq: 1, deal_id: "d1", at: "2026-01-01T00:00:00Z" });
    await collectorA.wait(1);
    // Даём шанс (неверному) сообщению дойти и до B, прежде чем утверждать его отсутствие.
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(collectorA.events).toEqual([
      { type: "deal.created", seq: 1, dealId: "d1", at: "2026-01-01T00:00:00Z" },
    ]);
    expect(collectorB.events).toHaveLength(0);
  });

  it("повторная доставка того же seq (at-least-once) отдаётся клиенту один раз", async () => {
    await startHub();
    const socket = connect("session=token-company-a");
    await waitForOpen(socket);
    const collector = collectDealEvents(socket);

    const event = { type: "deal.updated", seq: 7, deal_id: "d1", at: "2026-01-01T00:00:00Z" };
    publish("deal-events:company-a", event);
    publish("deal-events:company-a", event); // ретрай outbox-паблишера с тем же seq
    await collector.wait(1);
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(collector.events).toHaveLength(1);
  });

  it("событие с seq меньше уже виденного всё равно доставляется (не отбрасывается по верхней границе)", async () => {
    await startHub();
    const socket = connect("session=token-company-a");
    await waitForOpen(socket);
    const collector = collectDealEvents(socket);

    publish("deal-events:company-a", { type: "deal.updated", seq: 10, deal_id: "d1", at: "2026-01-01T00:00:00Z" });
    await collector.wait(1);
    publish("deal-events:company-a", { type: "deal.updated", seq: 3, deal_id: "d2", at: "2026-01-01T00:00:01Z" });
    await collector.wait(2);

    expect(collector.events).toEqual([
      { type: "deal.updated", seq: 10, dealId: "d1", at: "2026-01-01T00:00:00Z" },
      { type: "deal.updated", seq: 3, dealId: "d2", at: "2026-01-01T00:00:01Z" },
    ]);
  });

  it("множество увиденных seq на сокет ограничено по размеру", async () => {
    await startHub();
    const socket = connect("session=token-company-a");
    await waitForOpen(socket);
    const collector = collectDealEvents(socket);

    const total = MAX_SEEN_SEQ + 50;
    for (let seq = 1; seq <= total; seq += 1) {
      publish("deal-events:company-a", { type: "deal.updated", seq, deal_id: "d1", at: "2026-01-01T00:00:00Z" });
    }
    await collector.wait(total);

    const sizes = _debugSeenSeqSizes("company-a");
    expect(sizes).toEqual([MAX_SEEN_SEQ]);
  });

  it("отклоняется по таймауту, если Redis никогда не подтверждает подписку, а не зависает навсегда", async () => {
    const hangingServer = createServer();
    const hangingRedis = new HangingRedisSubscriber();

    const start = Date.now();
    await expect(
      initWebSocketHub(hangingServer, {
        redis: hangingRedis,
        verifyToken: fakeVerifyToken,
        allowedOrigins: [ALLOWED_ORIGIN],
        // Короткий таймаут — тест не должен реально ждать боевые 5 секунд
        // (DEFAULT_SUBSCRIBE_TIMEOUT_MS), только доказать сам механизм.
        subscribeTimeoutMs: 50,
      }),
    ).rejects.toThrow(/подтвердить подписку/);
    expect(Date.now() - start).toBeLessThan(1000);

    // closeWebSocketHub() внутри initWebSocketHub уже должен был откатить
    // частично поднятое состояние — следующий startHub() в другом тесте не
    // должен наткнуться на чужой wss/redisSubscriber.
    await closeWebSocketHub();
    await new Promise<void>((resolve) => hangingServer.close(() => resolve()));
  });

  // F6 (final review): "мёртвый" сокет — клиент, который принял апгрейд, но
  // не отвечает на ping протокольным pong'ом (autoPong: false выключает
  // автоответ ws-клиента, имитируя реальный обрыв без TCP FIN — закрытая
  // крышка, NAT, выселение пода). Раньше такой сокет не давал события
  // "close" никогда, и его запись в clientsByCompany/heartbeat-таймер
  // тикали бы вечно.
  it("сокет, не отвечающий pong'ом на ping, обрывается сервером (terminate) на втором тике", async () => {
    await startHub(30); // короткий deadCheckIntervalMs — тест не ждёт боевые 30с
    const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`, {
      headers: { Cookie: "session=token-company-a", Origin: ALLOWED_ORIGIN },
      autoPong: false,
    });
    openSockets.push(socket);
    await waitForOpen(socket);
    // Даём хабу время аутентифицировать сокет (deps.verifyToken — асинхронный).
    await new Promise((resolve) => setTimeout(resolve, 20));

    const closeInfo = await waitForClose(socket);
    // ws.terminate() рвёт TCP-соединение без штатного close-фрейма —
    // клиентская сторона в этом случае видит code 1006 (abnormal closure).
    expect(closeInfo.code).toBe(1006);
  });

  it("сокет, отвечающий pong'ом на каждый ping, не обрывается", async () => {
    await startHub(30);
    const socket = connect("session=token-company-a"); // autoPong: true по умолчанию
    await waitForOpen(socket);
    let closed = false;
    socket.once("close", () => {
      closed = true;
    });

    // Переживаем несколько тиков dead-check интервала.
    await new Promise((resolve) => setTimeout(resolve, 130));
    expect(closed).toBe(false);
  });

  // F12 (final review): initWebSocketHub раньше не подчищал предыдущее
  // состояние хаба, если его вызвать повторно без closeWebSocketHub между
  // вызовами — "pmessage"-листенер копился бы на новом redisSubscriber. Сам
  // факт, что второй вызов подряд не бросает и хаб продолжает нормально
  // работать (доставляет события ровно один раз на сокет), доказывает, что
  // защита сработала, а не просто не упала.
  it("повторный initWebSocketHub без закрытия предыдущего не копит листенеры/состояние", async () => {
    await startHub();
    await initWebSocketHub(server, {
      redis: fakeRedis,
      verifyToken: fakeVerifyToken,
      allowedOrigins: [ALLOWED_ORIGIN],
    });

    const socket = connect("session=token-company-a");
    await waitForOpen(socket);
    const collector = collectDealEvents(socket);

    publish("deal-events:company-a", { type: "deal.created", seq: 1, deal_id: "d1", at: "2026-01-01T00:00:00Z" });
    await collector.wait(1);
    await new Promise((resolve) => setTimeout(resolve, 20));

    // Если бы старый listener не был снят, событие пришло бы дважды.
    expect(collector.events).toHaveLength(1);
  });
});

describe("isRedisSubscriberReady (F10, final review)", () => {
  it("до старта хаба — не готов", async () => {
    await closeWebSocketHub(); // на случай, если предыдущий тест не закрылся
    expect(isRedisSubscriberReady()).toBe(false);
  });

  it("после успешного старта — готов (фейк без .status считается всегда готовым)", async () => {
    await startHub();
    expect(isRedisSubscriberReady()).toBe(true);
  });

  it("после closeWebSocketHub — снова не готов", async () => {
    await startHub();
    await closeWebSocketHub();
    expect(isRedisSubscriberReady()).toBe(false);
  });
});

describe("warnMissingAt throttling (F12, final review)", () => {
  afterEach(() => {
    _resetWarnMissingAtForTests();
  });

  it("предупреждение о событии без at пишется в лог только один раз, даже на несколько таких событий", async () => {
    await startHub();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const socket = connect("session=token-company-a");
    await waitForOpen(socket);
    const collector = collectDealEvents(socket);

    publish("deal-events:company-a", { type: "deal.updated", seq: 1, deal_id: "d1" }); // без at
    publish("deal-events:company-a", { type: "deal.updated", seq: 2, deal_id: "d1" }); // без at
    await collector.wait(2);

    const missingAtWarnings = warnSpy.mock.calls.filter(([msg]) =>
      String(msg).includes("событие от core без поля at"),
    );
    expect(missingAtWarnings).toHaveLength(1);
    warnSpy.mockRestore();
  });
});
