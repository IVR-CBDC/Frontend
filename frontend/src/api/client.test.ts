import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, authEvents, SESSION_EXPIRED_EVENT } from "./client";
import { ApiError } from "./errors";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("api client", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("login шлёт credentials: same-origin", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { user_id: "u1", company_id: "c1" }));

    await api.auth.login({ login: "a", password: "b" });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/auth/login",
      expect.objectContaining({ credentials: "same-origin" }),
    );
  });

  it("бросает ApiError со status и code вместо голого Error", async () => {
    fetchMock.mockResolvedValue(jsonResponse(401, { code: "INVALID_CREDENTIALS", error: "Неверный логин или пароль" }));

    await expect(api.auth.login({ login: "a", password: "wrong" })).rejects.toMatchObject({
      status: 401,
      code: "INVALID_CREDENTIALS",
    });
    await expect(api.auth.login({ login: "a", password: "wrong" })).rejects.toBeInstanceOf(ApiError);
  });

  // F1 (final review): client.ts больше не фильтрует по code — решение,
  // считать ли 401 истечением сессии, теперь принимает AuthProvider
  // (у него есть контекст: текущий AuthStatus), а не этот слой. Здесь
  // проверяем только то, что client.ts дисциплинированно шлёт сигнал на
  // КАЖДЫЙ 401, включая доминирующий в проде UNAUTHORIZED (см.
  // AuthProvider.test.tsx — там же проверяется, что сама реакция зависит
  // от статуса).
  it.each(["TOKEN_EXPIRED", "INVALID_TOKEN", "UNAUTHORIZED", "INVALID_CREDENTIALS"])(
    "на любой 401 (%s) сигналит session-expired через authEvents",
    async (code) => {
      fetchMock.mockResolvedValue(jsonResponse(401, { code, error: "x" }));
      const listener = vi.fn();
      authEvents.addEventListener(SESSION_EXPIRED_EVENT, listener);

      await expect(api.getDashboard()).rejects.toBeInstanceOf(ApiError);
      expect(listener).toHaveBeenCalledTimes(1);

      authEvents.removeEventListener(SESSION_EXPIRED_EVENT, listener);
    },
  );

  it("не сигналит session-expired для ошибок с другим статусом", async () => {
    fetchMock.mockResolvedValue(jsonResponse(403, { code: "FORBIDDEN_ORIGIN", error: "x" }));
    const listener = vi.fn();
    authEvents.addEventListener(SESSION_EXPIRED_EVENT, listener);

    await expect(api.getDashboard()).rejects.toBeInstanceOf(ApiError);
    expect(listener).not.toHaveBeenCalled();

    authEvents.removeEventListener(SESSION_EXPIRED_EVENT, listener);
  });

  it("logout (204) не пытается парсить тело", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    await expect(api.auth.logout()).resolves.toBeUndefined();
  });
});
