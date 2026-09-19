import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { WsProvider, useWsStatus, useWsSubscribe } from "./WsProvider";
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

function wrapper({ children }: { children: ReactNode }) {
  return <WsProvider>{children}</WsProvider>;
}

describe("WsProvider", () => {
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

  it("connection.ack доходит до подписчика на первом подключении и на каждом переподключении после разрыва", () => {
    const onEvent = vi.fn();
    renderHook(() => useWsSubscribe(onEvent), { wrapper });

    lastSocket().emitMessage({ type: "connection.ack" });
    expect(onEvent).toHaveBeenCalledWith({ type: "connection.ack" });
    expect(onEvent).toHaveBeenCalledTimes(1);

    // Разрыв без прикладного кода закрытия — обычный обрыв связи.
    lastSocket().emitClose(1006);
    vi.runOnlyPendingTimers();
    expect(FakeWebSocket.instances.length).toBe(2);

    lastSocket().emitMessage({ type: "connection.ack" });
    // Главный инвариант: без повторного вызова на реконнекте экран не
    // перезапросит данные и дыра после разрыва останется незамеченной.
    expect(onEvent).toHaveBeenCalledTimes(2);
  });

  it("на deal.updated доставляет подписчику само событие", () => {
    const onEvent = vi.fn();
    renderHook(() => useWsSubscribe(onEvent), { wrapper });

    const event: WsServerFrame = { type: "deal.updated", seq: 1, dealId: "d1", at: "2026-01-01T00:00:00Z" };
    lastSocket().emitMessage(event);

    expect(onEvent).toHaveBeenCalledWith(event);
  });

  it("один провайдер — один сокет для всех подписчиков (F3)", () => {
    renderHook(
      () => {
        useWsSubscribe(() => {});
        useWsSubscribe(() => {});
      },
      { wrapper },
    );

    expect(FakeWebSocket.instances.length).toBe(1);
  });

  it("переподключается с нарастающей задержкой и не уходит в плотный цикл переподключений", () => {
    renderHook(() => useWsSubscribe(() => {}), { wrapper });

    lastSocket().emitClose(1006);
    expect(FakeWebSocket.instances.length).toBe(1);

    vi.advanceTimersByTime(500);
    expect(FakeWebSocket.instances.length).toBe(1);

    vi.advanceTimersByTime(1000);
    expect(FakeWebSocket.instances.length).toBe(2);

    const secondAttemptCount = FakeWebSocket.instances.length;
    lastSocket().emitClose(1006);
    vi.advanceTimersByTime(1500);
    expect(FakeWebSocket.instances.length).toBe(secondAttemptCount);

    vi.advanceTimersByTime(2000);
    expect(FakeWebSocket.instances.length).toBe(secondAttemptCount + 1);
  });

  it("закрытие с кодом 4401 не переподключается и сигналит session-expired", () => {
    const listener = vi.fn();
    authEvents.addEventListener(SESSION_EXPIRED_EVENT, listener);

    renderHook(() => useWsSubscribe(() => {}), { wrapper });
    lastSocket().emitClose(4401);

    expect(listener).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(60_000);
    expect(FakeWebSocket.instances.length).toBe(1);

    authEvents.removeEventListener(SESSION_EXPIRED_EVENT, listener);
  });

  it("размонтирование останавливает переподключения", () => {
    const { unmount } = renderHook(() => useWsSubscribe(() => {}), { wrapper });

    lastSocket().emitClose(1006);
    unmount();

    vi.advanceTimersByTime(60_000);
    expect(FakeWebSocket.instances.length).toBe(1);
  });

  it("useWsStatus: live после connection.ack, connecting после разрыва", () => {
    const { result } = renderHook(() => useWsStatus(), { wrapper });
    expect(result.current).toBe("connecting");

    act(() => lastSocket().emitMessage({ type: "connection.ack" }));
    expect(result.current).toBe("live");

    act(() => lastSocket().emitClose(1006));
    expect(result.current).toBe("connecting");
  });

  // F12 (final review): недопустимый Origin отклоняется на апгрейде (403) —
  // клиент никогда не видит 4401 и не получает connection.ack, поэтому без
  // потолка попыток индикатор вечно показывал бы "Подключение…", хотя это
  // уже не временный сетевой сбой, а ошибка конфигурации.
  it("useWsStatus: после серии неудач без единого connection.ack становится stalled", () => {
    const { result } = renderHook(() => useWsStatus(), { wrapper });

    for (let i = 0; i < 5; i++) {
      act(() => lastSocket().emitClose(1006));
      act(() => vi.runOnlyPendingTimers());
    }

    expect(result.current).toBe("stalled");
  });

  it("useWsStatus: connection.ack после stalled возвращает live (сеть ожила)", () => {
    const { result } = renderHook(() => useWsStatus(), { wrapper });

    for (let i = 0; i < 5; i++) {
      act(() => lastSocket().emitClose(1006));
      act(() => vi.runOnlyPendingTimers());
    }
    expect(result.current).toBe("stalled");

    act(() => lastSocket().emitMessage({ type: "connection.ack" }));
    expect(result.current).toBe("live");
  });
});
