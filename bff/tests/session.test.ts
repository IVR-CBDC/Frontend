import { afterEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { UnsecuredJWT } from "jose";
import { createApp } from "../src/app.js";
import { testConfig } from "./helpers/config.js";

// decodeJwt в session.ts не проверяет подпись, так что для тестов достаточно
// unsecured-токена (alg: none) с нужным exp — этого хватает, чтобы проверить
// логику Max-Age, не поднимая настоящий service-auth.
function tokenExpiringIn(seconds: number): string {
  return new UnsecuredJWT({})
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + seconds)
    .encode();
}

function stubFetchOnce(status: number, body: unknown): void {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status })),
  );
}

function parseSetCookie(response: request.Response): string {
  const raw = response.headers["set-cookie"];
  const header = Array.isArray(raw) ? raw[0] : raw;
  if (!header) {
    throw new Error("ответ не содержит Set-Cookie");
  }
  return header;
}

describe("session cookie", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("успешный логин ставит HttpOnly/SameSite=Strict/Path=/ cookie и не возвращает токен в теле", async () => {
    stubFetchOnce(200, { user_id: "u1", company_id: "c1", token: tokenExpiringIn(3600) });
    const app = createApp(testConfig());

    const response = await request(app)
      .post("/api/auth/login")
      .set("Origin", "http://localhost:5173")
      .send({ login: "a", password: "b" });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ user_id: "u1", company_id: "c1" });
    expect(response.body.token).toBeUndefined();

    const cookie = parseSetCookie(response);
    expect(cookie).toMatch(/^session=/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Strict/i);
    expect(cookie).toMatch(/Path=\//);
    expect(cookie).not.toMatch(/Secure/i);
  });

  it("COOKIE_SECURE=true добавляет флаг Secure к cookie", async () => {
    stubFetchOnce(200, { user_id: "u1", company_id: "c1", token: tokenExpiringIn(3600) });
    const app = createApp(testConfig({ cookieSecure: true }));

    const response = await request(app)
      .post("/api/auth/login")
      .set("Origin", "http://localhost:5173")
      .send({ login: "a", password: "b" });

    expect(parseSetCookie(response)).toMatch(/Secure/i);
  });

  it("GET /api/auth/me без cookie отвечает 401 UNAUTHORIZED", async () => {
    const app = createApp(testConfig());

    const response = await request(app).get("/api/auth/me");

    expect(response.status).toBe(401);
    expect(response.body.code).toBe("UNAUTHORIZED");
  });

  it("GET /api/auth/me с cookie проксирует токен в Authorization: Bearer upstream'у", async () => {
    const token = tokenExpiringIn(3600);
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

    const response = await request(app).get("/api/auth/me").set("Cookie", `session=${token}`);

    expect(response.status).toBe(200);
    expect(response.body.user_id).toBe("u1");
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${token}`);
  });

  it("токен без exp — 502, cookie не ставится (fail-closed)", async () => {
    stubFetchOnce(200, {
      user_id: "u1",
      company_id: "c1",
      token: new UnsecuredJWT({}).setIssuedAt().encode(), // без setExpirationTime -> нет exp
    });
    const app = createApp(testConfig());

    const response = await request(app)
      .post("/api/auth/login")
      .set("Origin", "http://localhost:5173")
      .send({ login: "a", password: "b" });

    expect(response.status).toBe(502);
    // F9 (final review): отдельный код от 503 UPSTREAM_UNAVAILABLE — это
    // не "сервис недоступен", а "апстрим ответил, но нарушил контракт".
    expect(response.body.code).toBe("UPSTREAM_CONTRACT_VIOLATION");
    expect(response.headers["set-cookie"]).toBeUndefined();
  });

  it("токен с exp в прошлом — 502, cookie не ставится (fail-closed)", async () => {
    stubFetchOnce(200, { user_id: "u1", company_id: "c1", token: tokenExpiringIn(-60) });
    const app = createApp(testConfig());

    const response = await request(app)
      .post("/api/auth/login")
      .set("Origin", "http://localhost:5173")
      .send({ login: "a", password: "b" });

    expect(response.status).toBe(502);
    expect(response.body.code).toBe("UPSTREAM_CONTRACT_VIOLATION");
    expect(response.headers["set-cookie"]).toBeUndefined();
  });

  it("POST /api/auth/logout отвечает 204 и гасит cookie", async () => {
    const app = createApp(testConfig());

    const response = await request(app).post("/api/auth/logout").set("Origin", "http://localhost:5173");

    expect(response.status).toBe(204);
    const cookie = parseSetCookie(response);
    expect(cookie).toMatch(/session=;/);
    const maxAgeMatch = /Max-Age=(-?\d+)/i.exec(cookie);
    const expiresMatch = /Expires=([^;]+)/i.exec(cookie);
    const clearedByMaxAge = maxAgeMatch ? Number(maxAgeMatch[1]) <= 0 : false;
    const clearedByExpires = expiresMatch ? new Date(expiresMatch[1]).getTime() < Date.now() : false;
    expect(clearedByMaxAge || clearedByExpires).toBe(true);
  });
});

describe("гашение мёртвой сессии на 401 от апстрима (F5, final review)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // Cookie сессии HttpOnly — SPA не может увидеть её и удалить сама. Без
  // явного gашения на 401 TOKEN_EXPIRED/INVALID_TOKEN BFF слал бы мёртвый
  // токен апстримам бесконечно, пока пользователь сам не зайдёт в /logout.
  it("401 TOKEN_EXPIRED от апстрима на запросе с cookie гасит сессию (Set-Cookie с истёкшей датой)", async () => {
    stubFetchOnce(401, { code: "TOKEN_EXPIRED", error: "Срок действия токена истёк" });
    const app = createApp(testConfig());

    const response = await request(app).get("/api/auth/me").set("Cookie", "session=stale-token");

    expect(response.status).toBe(401);
    expect(response.body.code).toBe("TOKEN_EXPIRED");
    const cookie = parseSetCookie(response);
    expect(cookie).toMatch(/session=;/);
    const maxAgeMatch = /Max-Age=(-?\d+)/i.exec(cookie);
    const expiresMatch = /Expires=([^;]+)/i.exec(cookie);
    const clearedByMaxAge = maxAgeMatch ? Number(maxAgeMatch[1]) <= 0 : false;
    const clearedByExpires = expiresMatch ? new Date(expiresMatch[1]).getTime() < Date.now() : false;
    expect(clearedByMaxAge || clearedByExpires).toBe(true);
  });

  it("401 INVALID_TOKEN от апстрима на запросе с cookie тоже гасит сессию", async () => {
    stubFetchOnce(401, { code: "INVALID_TOKEN", error: "Недействительный токен" });
    const app = createApp(testConfig());

    const response = await request(app).get("/api/auth/me").set("Cookie", "session=tampered");

    expect(response.status).toBe(401);
    const cookie = parseSetCookie(response);
    expect(cookie).toMatch(/session=;/);
  });

  it("401 UNAUTHORIZED от requireSession (нет cookie вовсе) не пытается гасить несуществующую сессию", async () => {
    const app = createApp(testConfig());

    const response = await request(app).get("/api/auth/me");

    expect(response.status).toBe(401);
    expect(response.body.code).toBe("UNAUTHORIZED");
    // Cookie не было — Set-Cookie на "погасить" быть не должно вовсе.
    expect(response.headers["set-cookie"]).toBeUndefined();
  });
});

describe("checkOrigin", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("мутирующий запрос с чужим Origin получает 403 FORBIDDEN_ORIGIN", async () => {
    const app = createApp(testConfig());

    const response = await request(app)
      .post("/api/auth/logout")
      .set("Origin", "http://evil.example");

    expect(response.status).toBe(403);
    expect(response.body.code).toBe("FORBIDDEN_ORIGIN");
  });

  it("мутирующий запрос без Origin вообще получает 403 FORBIDDEN_ORIGIN", async () => {
    const app = createApp(testConfig());

    const response = await request(app).post("/api/auth/logout");

    expect(response.status).toBe(403);
    expect(response.body.code).toBe("FORBIDDEN_ORIGIN");
  });

  it("мутирующий запрос с разрешённым Origin проходит", async () => {
    const app = createApp(testConfig());

    const response = await request(app)
      .post("/api/auth/logout")
      .set("Origin", "http://localhost:5173");

    expect(response.status).toBe(204);
  });

  it("Origin проверяется точным совпадением, а не префиксом (localhost:5173.evil.com — чужой)", async () => {
    const app = createApp(testConfig());

    const response = await request(app)
      .post("/api/auth/logout")
      .set("Origin", "http://localhost:5173.evil.com");

    expect(response.status).toBe(403);
    expect(response.body.code).toBe("FORBIDDEN_ORIGIN");
  });

  it("GET с чужим Origin не блокируется", async () => {
    const app = createApp(testConfig());

    const response = await request(app).get("/health").set("Origin", "http://evil.example");

    expect(response.status).toBe(200);
  });
});
