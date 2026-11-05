import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";




vi.mock("../src/ws/hub.js", () => ({
  isRedisSubscriberReady: vi.fn(),
}));

import { isRedisSubscriberReady } from "../src/ws/hub.js";
import { createApp } from "../src/app.js";
import { testConfig } from "./helpers/config.js";
import { _resetReadinessCacheForTests } from "../src/health.js";

function okResponse(): Response {
  return new Response(null, { status: 200 });
}

beforeEach(() => {
  _resetReadinessCacheForTests();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("GET /ready", () => {
  it("200 {ok:true,...}, когда Redis готов и все апстримы отвечают", async () => {
    vi.mocked(isRedisSubscriberReady).mockReturnValue(true);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okResponse()));
    const app = createApp(testConfig());

    const response = await request(app).get("/ready");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true, redis: true, auth: true, core: true, commission: true });
  });

  it("503, когда Redis-подписчик сейчас не готов (переподключается), даже если апстримы живы", async () => {
    
    
    
    vi.mocked(isRedisSubscriberReady).mockReturnValue(false);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okResponse()));
    const app = createApp(testConfig());

    const response = await request(app).get("/ready");

    expect(response.status).toBe(503);
    expect(response.body).toEqual({ ok: false, redis: false, auth: true, core: true, commission: true });
  });

  it("503, когда один из апстримов недоступен", async () => {
    vi.mocked(isRedisSubscriberReady).mockReturnValue(true);
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("core.test")) throw new Error("connection refused");
      return okResponse();
    });
    vi.stubGlobal("fetch", fetchMock);
    const app = createApp(testConfig());

    const response = await request(app).get("/ready");

    expect(response.status).toBe(503);
    expect(response.body).toEqual({ ok: false, redis: true, auth: true, core: false, commission: true });
  });

  it("кеширует результат на короткий TTL — второй запрос сразу после первого не бьёт апстримы снова", async () => {
    vi.mocked(isRedisSubscriberReady).mockReturnValue(true);
    const fetchMock = vi.fn().mockResolvedValue(okResponse());
    vi.stubGlobal("fetch", fetchMock);
    const app = createApp(testConfig());

    await request(app).get("/ready");
    await request(app).get("/ready");

    
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("после истечения TTL следующий запрос снова опрашивает апстримы", async () => {
    vi.useFakeTimers();
    vi.mocked(isRedisSubscriberReady).mockReturnValue(true);
    const fetchMock = vi.fn().mockResolvedValue(okResponse());
    vi.stubGlobal("fetch", fetchMock);
    const app = createApp(testConfig());

    await request(app).get("/ready");
    expect(fetchMock).toHaveBeenCalledTimes(3);

    vi.advanceTimersByTime(2_001);

    await request(app).get("/ready");
    expect(fetchMock).toHaveBeenCalledTimes(6);
  });

  it("несколько одновременных запросов дедуплицируются в один расчёт готовности", async () => {
    vi.mocked(isRedisSubscriberReady).mockReturnValue(true);
    const fetchMock = vi.fn().mockResolvedValue(okResponse());
    vi.stubGlobal("fetch", fetchMock);
    const app = createApp(testConfig());

    await Promise.all([request(app).get("/ready"), request(app).get("/ready"), request(app).get("/ready")]);

    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
