import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useWebSocket } from "./useWebSocket";
import { authEvents, SESSION_EXPIRED_EVENT } from "../api/client";
import type { WsServerFrame } from "../types/api";

// jsdom не реализует WebSocket — подменяем его управляемым фейком, чтобы
// тесты сами решали, когда сокет "открылся", прислал кадр или закрылся.
class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  url: string;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  close() {
    this.closed = true;
  }

  emitMessage(frame: WsServerFrame) {
    this.onmessage?.({ data: JSON.stringify(frame) });
  }

  emitClose(code: number) {
    this.onclose?.({ code });
  }
}

describe("useWebSocket", () => {
  beforeEach(() => {
    FakeWebSocket.instances = [];
    vi.stubGlobal("WebSocket", FakeWebSocket as unknown as typeof WebSocket);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  function lastSocket(): FakeWebSocket {
    const socket = FakeWebSocket.instances[FakeWebSocket.instances.length - 1];
    if (!socket) throw new Error("сокет ещё не создан");
    return socket;
  }

  it("connection.ack вызывает onEvent на первом подключении и на каждом переподключении после разрыва", () => {
    const onEvent = vi.fn();
    renderHook(() => useWebSocket(onEvent));

    lastSocket().emitMessage({ type: "connection.ack" });
    expect(onEvent).toHaveBeenCalledWith({ type: "connection.ack" });
    expect(onEvent).toHaveBeenCalledTimes(1);

    // Разрыв без прикладного кода закрытия — обычный обрыв связи.
    lastSocket().emitClose(1006);
    // Переподключение не мгновенное — с задержкой (проверяется отдельным тестом),
    // но оно обязано случиться.
    vi.runOnlyPendingTimers();
    expect(FakeWebSocket.instances.length).toBe(2);

    lastSocket().emitMessage({ type: "connection.ack" });
    // Именно это — главный тест из брифа: без повторного вызова на реконнекте
    // экран не перезапросит данные и дыра после разрыва останется незамеченной.
    expect(onEvent).toHaveBeenCalledTimes(2);
  });

  it("на deal.updated вызывает onEvent с самим событием (перезапрос — забота вызывающего, не хука)", () => {
    const onEvent = vi.fn();
    renderHook(() => useWebSocket(onEvent));

    const event: WsServerFrame = { type: "deal.updated", seq: 1, dealId: "d1", at: "2026-01-01T00:00:00Z" };
    lastSocket().emitMessage(event);

    expect(onEvent).toHaveBeenCalledWith(event);
  });

  it("переподключается с нарастающей задержкой и не уходит в плотный цикл переподключений", () => {
    const onEvent = vi.fn();
    renderHook(() => useWebSocket(onEvent));

    lastSocket().emitClose(1006);
    // Сразу после разрыва новый сокет ещё не должен быть открыт.
    expect(FakeWebSocket.instances.length).toBe(1);

    vi.advanceTimersByTime(500);
    expect(FakeWebSocket.instances.length).toBe(1);

    vi.advanceTimersByTime(1000);
    expect(FakeWebSocket.instances.length).toBe(2);

    const secondAttemptCount = FakeWebSocket.instances.length;
    lastSocket().emitClose(1006);
    // Задержка второй попытки не меньше первой (экспоненциальный рост, не
    // тайт-луп из мгновенных реконнектов).
    vi.advanceTimersByTime(1500);
    expect(FakeWebSocket.instances.length).toBe(secondAttemptCount);

    vi.advanceTimersByTime(2000);
    expect(FakeWebSocket.instances.length).toBe(secondAttemptCount + 1);
  });

  it("закрытие с кодом 4401 не переподключается и сигналит session-expired", () => {
    const onEvent = vi.fn();
    const listener = vi.fn();
    authEvents.addEventListener(SESSION_EXPIRED_EVENT, listener);

    renderHook(() => useWebSocket(onEvent));
    lastSocket().emitClose(4401);

    expect(listener).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(60_000);
    expect(FakeWebSocket.instances.length).toBe(1);

    authEvents.removeEventListener(SESSION_EXPIRED_EVENT, listener);
  });

  it("размонтирование останавливает переподключения", () => {
    const onEvent = vi.fn();
    const { unmount } = renderHook(() => useWebSocket(onEvent));

    lastSocket().emitClose(1006);
    unmount();

    vi.advanceTimersByTime(60_000);
    expect(FakeWebSocket.instances.length).toBe(1);
  });

  it("возвращает isLive: true после connection.ack, false после разрыва", () => {
    const { result } = renderHook(() => useWebSocket(() => {}));
    expect(result.current).toBe(false);

    act(() => lastSocket().emitMessage({ type: "connection.ack" }));
    expect(result.current).toBe(true);

    act(() => lastSocket().emitClose(1006));
    expect(result.current).toBe(false);
  });
});
