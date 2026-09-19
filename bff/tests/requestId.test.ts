import { afterEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { UnsecuredJWT } from "jose";
import { createApp } from "../src/app.js";
import { testConfig } from "./helpers/config.js";

// F7 (final review): спека §6 требует пробрасывать x-request-id в сервисы —
// без этого сбой, который пользователь видит в SPA, нельзя проследить в
// логах service-core/service-auth/service-commission.

function tokenExpiringIn(seconds: number): string {
  return new UnsecuredJWT({})
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + seconds)
    .encode();
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("x-request-id", () => {
  it("исходящий запрос к upstream содержит X-Request-Id, присланный клиентом", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          user_id: "u1",
          login: "a",
          name: "Имя",
          company: { id: "c1", name: "ООО Ромашка", inn: "7736050003" },
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const app = createApp(testConfig());
    const token = tokenExpiringIn(3600);

    const response = await request(app)
      .get("/api/auth/me")
      .set("Cookie", `session=${token}`)
      .set("X-Request-Id", "client-supplied-id-123");

    expect(response.status).toBe(200);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers["X-Request-Id"]).toBe("client-supplied-id-123");
    // Возвращаем клиенту тот же id — SPA может сопоставить лог и ответ.
    expect(response.headers["x-request-id"]).toBe("client-supplied-id-123");
  });

  it("если клиент не передал X-Request-Id, BFF генерирует свой и проставляет его и в ответе, и в исходящем запросе", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          user_id: "u1",
          login: "a",
          name: "Имя",
          company: { id: "c1", name: "ООО Ромашка", inn: "7736050003" },
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const app = createApp(testConfig());
    const token = tokenExpiringIn(3600);

    const response = await request(app).get("/api/auth/me").set("Cookie", `session=${token}`);

    expect(response.status).toBe(200);
    const generated = response.headers["x-request-id"];
    expect(typeof generated).toBe("string");
    expect(generated.length).toBeGreaterThan(0);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers["X-Request-Id"]).toBe(generated);
  });

  it("два параллельных запроса не путают чужие request id между собой", async () => {
    const seen: string[] = [];
    const fetchMock = vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
      const headers = init.headers as Record<string, string>;
      seen.push(headers["X-Request-Id"]);
      return new Response(
        JSON.stringify({
          user_id: "u1",
          login: "a",
          name: "Имя",
          company: { id: "c1", name: "ООО Ромашка", inn: "7736050003" },
        }),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    const app = createApp(testConfig());
    const token = tokenExpiringIn(3600);

    const [respA, respB] = await Promise.all([
      request(app).get("/api/auth/me").set("Cookie", `session=${token}`).set("X-Request-Id", "req-a"),
      request(app).get("/api/auth/me").set("Cookie", `session=${token}`).set("X-Request-Id", "req-b"),
    ]);

    expect(respA.headers["x-request-id"]).toBe("req-a");
    expect(respB.headers["x-request-id"]).toBe("req-b");
    expect(seen.sort()).toEqual(["req-a", "req-b"]);
  });
});
