import { act, render, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TrackingPage } from "./TrackingPage";

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

const DEAL = {
  id: "d1",
  displayId: "DEAL-1",
  counterpartyCountry: "CN",
  counterpartyName: "Shenzhen Bay",
  operationType: "import",
  amount: 1000,
  currency: "USD",
  scenario: null,
  stage: "compliance_check",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  hasBlockers: false,
  version: 1,
  commissionTotal: null,
  documents: [],
  timeline: [],
};

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/deals/d1/tracking"]}>
      <Routes>
        <Route path="/deals/:dealId/tracking" element={<TrackingPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("TrackingPage", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    FakeWebSocket.instances = [];
    vi.stubGlobal("WebSocket", FakeWebSocket as unknown as typeof WebSocket);
    fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { deal: DEAL }));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // fetchMock резолвится немедленно (микротаска), поэтому после каждого
  // релевантного события достаточно дать микротаскам шанс отработать — без
  // этого проверка "successful before fake timers advance" гонится бы с
  // реальным asynchronous waitFor, который плохо ладит с фейковыми таймерами.
  async function flushMicrotasks() {
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  it("перезапрашивает сделку на connection.ack — включая переподключение, где события могли потеряться", async () => {
    vi.useFakeTimers();
    try {
      renderPage();
      await flushMicrotasks();
      expect(fetchMock).toHaveBeenCalledTimes(1);

      // Первый connection.ack (обычное подключение).
      act(() => lastSocket().emitMessage({ type: "connection.ack" }));
      await flushMicrotasks();
      expect(fetchMock).toHaveBeenCalledTimes(2);

      // Разрыв — хук сам планирует переподключение (backoff покрыт отдельно
      // в useWebSocket.test.ts); здесь важно только то, что реальный новый
      // сокет создаёт хук, а не тест, и что его connection.ack снова
      // перезапрашивает сделку. Это главный тест из брифа: без него дыра
      // после реконнекта остаётся незамеченной.
      const socketBeforeReconnect = lastSocket();
      act(() => socketBeforeReconnect.onclose?.({ code: 1006 }));
      act(() => vi.runOnlyPendingTimers());
      expect(FakeWebSocket.instances.length).toBe(2);

      act(() => lastSocket().emitMessage({ type: "connection.ack" }));
      await flushMicrotasks();
      expect(fetchMock).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it("перезапрашивает на deal.updated своей сделки и игнорирует чужую", async () => {
    renderPage();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    act(() =>
      lastSocket().emitMessage({ type: "deal.updated", seq: 1, dealId: "other-deal", at: "2026-01-01T00:00:00Z" }),
    );
    // Даём микротаскам шанс — счётчик не должен вырасти.
    await Promise.resolve();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    act(() =>
      lastSocket().emitMessage({ type: "deal.updated", seq: 2, dealId: "d1", at: "2026-01-01T00:00:00Z" }),
    );
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });
});
