import { afterEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { ApiError, installErrorHandler } from "../src/errors.js";
import { callUpstream } from "../src/upstream/http.js";
import { createApp } from "../src/app.js";
import { testConfig } from "./helpers/config.js";

describe("installErrorHandler", () => {
  it("превращает ApiError в тело {code, error} с его статусом", async () => {
    const app = express();
    app.get("/boom", (_req, _res, next) => {
      next(new ApiError(409, "VERSION_CONFLICT", "Конфликт версии"));
    });
    installErrorHandler(app);

    const response = await request(app).get("/boom");

    expect(response.status).toBe(409);
    expect(response.body).toEqual({ code: "VERSION_CONFLICT", error: "Конфликт версии" });
  });

  it("отвечает 404 {code: NOT_FOUND} на неизвестный маршрут", async () => {
    const app = express();
    installErrorHandler(app);

    const response = await request(app).get("/nope");

    expect(response.status).toBe(404);
    expect(response.body.code).toBe("NOT_FOUND");
  });

  // F4 (final review): проверено вживую — GET /api/nope без cookie отвечал
  // 401 UNAUTHORIZED, а не 404, потому что requireSession раньше висел на
  // dealsRouter.use(...) и перехватывал ЛЮБОЙ /api/* путь (роутер
  // смонтирован на "/api" целиком) раньше, чем запрос мог дойти до
  // финального 404. По спеке §7 SPA на 401 уходит на логин — опечатка в
  // URL выглядела бы как "вас разлогинило".
  it("неизвестный путь ПОД /api тоже отвечает 404, а не 401 (requireSession не перехватывает его)", async () => {
    const app = createApp(testConfig());

    const response = await request(app).get("/api/nope");

    expect(response.status).toBe(404);
    expect(response.body.code).toBe("NOT_FOUND");
  });

  it("отвечает 500 {code: INTERNAL_ERROR} и не отдаёт текст исключения наружу", async () => {
    const app = express();
    app.get("/boom", () => {
      throw new Error("секрет из стектрейса, который не должен утечь наружу");
    });
    installErrorHandler(app);

    const response = await request(app).get("/boom");

    expect(response.status).toBe(500);
    expect(response.body.code).toBe("INTERNAL_ERROR");
    expect(JSON.stringify(response.body)).not.toContain("секрет из стектрейса");
  });
});

describe("битое тело запроса", () => {
  // F3 (final review): проверено вживую — POST /api/auth/login с {bad
  // отвечал 500 INTERNAL_ERROR вместо 400. express.json() бросает
  // SyntaxError со status: 400 сам, но обработчик ошибок его не узнавал.
  it("невалидный JSON в теле POST /api/auth/login отвечает 400 VALIDATION_ERROR, а не 500", async () => {
    const app = createApp(testConfig());

    const response = await request(app)
      .post("/api/auth/login")
      .set("Origin", "http://localhost:5173")
      .set("Content-Type", "application/json")
      .send("{bad");

    expect(response.status).toBe(400);
    expect(response.body.code).toBe("VALIDATION_ERROR");
  });
});

describe("callUpstream", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("502 от upstream превращается в ApiError 503 UPSTREAM_UNAVAILABLE", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ code: "IGNORED", error: "не важно" }), { status: 502 }),
      ),
    );

    await expect(callUpstream("http://auth.test/x", {}, 1000)).rejects.toMatchObject({
      status: 503,
      code: "UPSTREAM_UNAVAILABLE",
    });
  });

  it("409 {code, error} от upstream пробрасывается тем же статусом и кодом", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ code: "VERSION_CONFLICT", error: "Конфликт версии" }), {
          status: 409,
        }),
      ),
    );

    await expect(callUpstream("http://auth.test/x", {}, 1000)).rejects.toMatchObject({
      status: 409,
      code: "VERSION_CONFLICT",
    });
  });
});
