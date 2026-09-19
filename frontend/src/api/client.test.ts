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

  it("на 401 TOKEN_EXPIRED посреди сессии сигналит session-expired через authEvents", async () => {
    fetchMock.mockResolvedValue(jsonResponse(401, { code: "TOKEN_EXPIRED", error: "Сессия истекла" }));
    const listener = vi.fn();
    authEvents.addEventListener(SESSION_EXPIRED_EVENT, listener);

    await expect(api.getDashboard()).rejects.toBeInstanceOf(ApiError);
    expect(listener).toHaveBeenCalledTimes(1);

    authEvents.removeEventListener(SESSION_EXPIRED_EVENT, listener);
  });

  it("не сигналит session-expired для бизнес-ошибок вроде неверного пароля", async () => {
    fetchMock.mockResolvedValue(jsonResponse(401, { code: "INVALID_CREDENTIALS", error: "Неверный логин или пароль" }));
    const listener = vi.fn();
    authEvents.addEventListener(SESSION_EXPIRED_EVENT, listener);

    await expect(api.auth.login({ login: "a", password: "wrong" })).rejects.toBeInstanceOf(ApiError);
    expect(listener).not.toHaveBeenCalled();

    authEvents.removeEventListener(SESSION_EXPIRED_EVENT, listener);
  });

  it("logout (204) не пытается парсить тело", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    await expect(api.auth.logout()).resolves.toBeUndefined();
  });
});
