import { describe, expect, it } from "vitest";
import { ApiError, messageFor } from "./errors";

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

  // F9 (final review): обрыв связи (не-ApiError, обычно TypeError самого
  // fetch) не должен показывать пользователю английский текст браузера
  // вроде "Failed to fetch".
  it("для не-ApiError (обрыв связи) возвращает русский текст, а не e.message браузера", () => {
    expect(messageFor(new TypeError("Failed to fetch"))).toBe("Нет связи с сервисом, проверьте подключение");
    expect(messageFor("что-то совсем не то")).toBe("Нет связи с сервисом, проверьте подключение");
  });
});
