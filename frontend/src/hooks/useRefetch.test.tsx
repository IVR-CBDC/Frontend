import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { useRefetch } from "./useRefetch";
import { WsProvider } from "./WsProvider";
import type { WsServerFrame } from "../types/api";

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;
  onerror: (() => void) | null = null;

  constructor() {
    FakeWebSocket.instances.push(this);
  }

  close() {}

  emitMessage(frame: WsServerFrame) {
    this.onmessage?.({ data: JSON.stringify(frame) });
  }
}

function lastSocket(): FakeWebSocket {
  const socket = FakeWebSocket.instances[FakeWebSocket.instances.length - 1];
  if (!socket) throw new Error("сокет ещё не создан");
  return socket;
}

// useRefetch больше не открывает свой сокет (F3, final review) — подписка
// идёт через WsProvider, поэтому тестовому хуку нужен провайдер-обёртка.
function wrapper({ children }: { children: ReactNode }) {
  return <WsProvider>{children}</WsProvider>;
}

describe("useRefetch", () => {
  beforeEach(() => {
    FakeWebSocket.instances = [];
    vi.stubGlobal("WebSocket", FakeWebSocket as unknown as typeof WebSocket);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("перезапрашивает сразу при монтировании (обычная загрузка экрана)", () => {
    const reload = vi.fn();
    renderHook(() => useRefetch(reload), { wrapper });
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("перезапрашивает на connection.ack безусловно — это единственный сигнал 'вы могли что-то пропустить'", () => {
    const reload = vi.fn();
    const matches = vi.fn().mockReturnValue(false);
    renderHook(() => useRefetch(reload, matches), { wrapper });
    reload.mockClear();

    lastSocket().emitMessage({ type: "connection.ack" });

    expect(reload).toHaveBeenCalledTimes(1);
    // connection.ack не является DealEvent — матчер для него не должен даже вызываться.
    expect(matches).not.toHaveBeenCalled();
  });

  it("игнорирует heartbeat", () => {
    const reload = vi.fn();
    renderHook(() => useRefetch(reload), { wrapper });
    reload.mockClear();

    lastSocket().emitMessage({ type: "heartbeat", at: "2026-01-01T00:00:00Z" });

    expect(reload).not.toHaveBeenCalled();
  });

  it("перезапрашивает на DealEvent только когда matches вернул true", () => {
    const reload = vi.fn();
    const matches = vi.fn((event: WsServerFrame) => "dealId" in event && event.dealId === "d1");
    renderHook(() => useRefetch(reload, matches), { wrapper });
    reload.mockClear();

    lastSocket().emitMessage({ type: "deal.updated", seq: 1, dealId: "d2", at: "2026-01-01T00:00:00Z" });
    expect(reload).not.toHaveBeenCalled();

    lastSocket().emitMessage({ type: "deal.updated", seq: 2, dealId: "d1", at: "2026-01-01T00:00:00Z" });
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("без matches перезапрашивает на любой DealEvent (безопасный дефолт)", () => {
    const reload = vi.fn();
    renderHook(() => useRefetch(reload), { wrapper });
    reload.mockClear();

    lastSocket().emitMessage({ type: "notification.created", seq: 1, notificationId: "n1", at: "2026-01-01T00:00:00Z" });

    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("два экрана под одним WsProvider делят один и тот же сокет (F3)", () => {
    const reloadA = vi.fn();
    const reloadB = vi.fn();
    renderHook(
      () => {
        useRefetch(reloadA);
        useRefetch(reloadB);
      },
      { wrapper },
    );

    expect(FakeWebSocket.instances.length).toBe(1);
  });
});
