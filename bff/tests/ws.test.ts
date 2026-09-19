import { afterEach, describe, expect, it } from "vitest";
import { createServer } from "node:http";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { EventEmitter } from "node:events";
import { WebSocket } from "ws";
import {
  initWebSocketHub,
  closeWebSocketHub,
  MAX_SEEN_SEQ,
  _debugSeenSeqSizes,
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

let server: Server;
let fakeRedis: FakeRedisSubscriber;
let port: number;
const openSockets: WebSocket[] = [];

async function startHub(): Promise<void> {
  server = createServer();
  fakeRedis = new FakeRedisSubscriber();
  await initWebSocketHub(server, { redis: fakeRedis, verifyToken: fakeVerifyToken });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  port = (server.address() as AddressInfo).port;
}

function connect(cookie: string | undefined): WebSocket {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`, {
    headers: cookie ? { Cookie: cookie } : {},
  });
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

describe("initWebSocketHub", () => {
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
});
