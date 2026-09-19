import { describe, expect, it } from "vitest";
import { ApiError, isAuthError, messageFor } from "./errors";

describe("isAuthError", () => {
  it("true для 401 с TOKEN_EXPIRED/INVALID_TOKEN", () => {
    expect(isAuthError(new ApiError(401, "TOKEN_EXPIRED", "x"))).toBe(true);
    expect(isAuthError(new ApiError(401, "INVALID_TOKEN", "x"))).toBe(true);
  });

  // UNAUTHORIZED — это "не вошли вовсе" (напр. самый первый /auth/me от
  // никогда не логинившегося посетителя), а не "сессия истекла". Если
  // считать его auth-ошибкой, первый же анонимный /auth/me шлёт
  // session-expired и задваивает clearSession ещё до логина.
  it("false для 401 с UNAUTHORIZED (нет сессии — не значит 'истекла')", () => {
    expect(isAuthError(new ApiError(401, "UNAUTHORIZED", "x"))).toBe(false);
  });

  it("false для 401 с другим кодом (напр. неверный пароль)", () => {
    expect(isAuthError(new ApiError(401, "INVALID_CREDENTIALS", "x"))).toBe(false);
  });

  it("false для не-401 и не-ApiError", () => {
    expect(isAuthError(new ApiError(403, "FORBIDDEN_ORIGIN", "x"))).toBe(false);
    expect(isAuthError(new Error("boom"))).toBe(false);
  });
});

describe("messageFor", () => {
  it("ветвится по code, а не по тексту сообщения", () => {
    const upstream = new ApiError(503, "UPSTREAM_UNAVAILABLE", "то же самое человекочитаемое сообщение");
    const validation = new ApiError(400, "VALIDATION_ERROR", "то же самое человекочитаемое сообщение");
    expect(messageFor(upstream)).not.toBe(messageFor(validation));
  });

  it("для неизвестного кода использует error из ответа как запасной вариант", () => {
    const e = new ApiError(409, "VERSION_CONFLICT", "Кто-то уже изменил сделку");
    expect(messageFor(e)).toBe("Кто-то уже изменил сделку");
  });
});
