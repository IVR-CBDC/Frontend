import { act, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DashboardPage } from "./DashboardPage";

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;
  onerror: (() => void) | null = null;

  constructor() {
    FakeWebSocket.instances.push(this);
  }

  close() {}

  emitMessage(frame: unknown) {
    this.onmessage?.({ data: JSON.stringify(frame) });
  }
}

function lastSocket(): FakeWebSocket {
  const socket = FakeWebSocket.instances[FakeWebSocket.instances.length - 1];
  if (!socket) throw new Error("сокет ещё не создан");
  return socket;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("DashboardPage", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    FakeWebSocket.instances = [];
    vi.stubGlobal("WebSocket", FakeWebSocket as unknown as typeof WebSocket);
    fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { deals: [], unreadNotifications: 0 }));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("перезапрашивает /api/dashboard на connection.ack — главное условие: пропуски во время разрыва не остаются незамеченными", async () => {
    render(
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>,
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    act(() => lastSocket().emitMessage({ type: "connection.ack" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock).toHaveBeenCalledWith("/api/dashboard", expect.anything());
  });

  it("перезапрашивает на deal.updated, а не патчит карточку из полей события", async () => {
    render(
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>,
    );
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    act(() =>
      lastSocket().emitMessage({ type: "deal.updated", seq: 1, dealId: "d1", at: "2026-01-01T00:00:00Z" }),
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });
});
