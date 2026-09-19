import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ScenarioPage } from "./ScenarioPage";
import { WsProvider } from "../../hooks/WsProvider";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

// jsdom не реализует WebSocket — этому файлу не важно поведение сокета, но
// WsProvider его открывает при монтировании (ScenarioPage теперь под
// useRefetch, F2), поэтому нужна хотя бы заглушка.
class FakeWebSocket {
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;
  onerror: (() => void) | null = null;
  close() {}
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
  stage: "created",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  hasBlockers: false,
  version: 3,
  commissionTotal: null,
  documents: [],
  timeline: [],
};

const SCENARIOS = [
  {
    id: "cbdc",
    title: "Цифровой рубль",
    description: "Мгновенный расчёт",
    etaLabel: "5 минут",
    limitations: ["Лимит 500 000 ₽"],
    available: true,
    unavailableReason: null,
    commission: {
      baseFee: 100,
      percentageFee: 0.001,
      percentageAmount: 1,
      fixedFee: 0,
      subtotal: 101,
      clamped: false,
      multiplier: 1,
      total: 12345,
    },
  },
  {
    id: "trade_finance",
    title: "Торговое финансирование",
    description: "Аккредитив",
    etaLabel: "10 дней",
    limitations: [],
    available: false,
    unavailableReason: "Коридор RU→CN не поддерживает этот сценарий",
    commission: null,
  },
];

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/deals/d1/scenario"]}>
      <WsProvider>
        <Routes>
          <Route path="/deals/:dealId/scenario" element={<ScenarioPage />} />
          <Route path="/deals/:dealId/tracking" element={<div>Экран трекинга</div>} />
        </Routes>
      </WsProvider>
    </MemoryRouter>,
  );
}

describe("ScenarioPage", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("WebSocket", FakeWebSocket as unknown as typeof WebSocket);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubHappyLoad() {
    fetchMock.mockImplementation((url: string) => {
      if (url.endsWith("/scenarios")) return Promise.resolve(jsonResponse(200, { corridorId: "RU-CN", scenarios: SCENARIOS }));
      if (url.endsWith("/deals/d1")) return Promise.resolve(jsonResponse(200, { deal: DEAL }));
      return Promise.reject(new Error(`unexpected url ${url}`));
    });
  }

  it("показывает реальную сумму комиссии из ответа, а не статический текст", async () => {
    stubHappyLoad();
    renderPage();

    expect(await screen.findByText("12 345")).toBeInTheDocument();
    expect(screen.queryByText(/от 0,05%/)).not.toBeInTheDocument();
  });

  it("недоступный сценарий не кликабелен и показывает unavailableReason", async () => {
    stubHappyLoad();
    const user = userEvent.setup();
    renderPage();

    await screen.findByText("Торговое финансирование");
    expect(screen.getByText("Коридор RU→CN не поддерживает этот сценарий")).toBeInTheDocument();

    const unavailableCard = screen.getByText("Торговое финансирование").closest("button");
    expect(unavailableCard).toBeDisabled();

    // клик по недоступной карточке не должен включать её в выбор — кнопка
    // подтверждения остаётся заблокированной для несуществующего выбора
    if (unavailableCard) await user.click(unavailableCard);
    expect(screen.getByRole("button", { name: /Подтвердить сценарий/ })).toBeDisabled();
  });

  it("подтверждение отправляет version сделки", async () => {
    stubHappyLoad();
    const user = userEvent.setup();
    renderPage();

    const availableCard = await screen.findByText("Цифровой рубль");
    await user.click(availableCard.closest("button")!);

    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (url.endsWith("/scenario") && init?.method === "POST") {
        return Promise.resolve(jsonResponse(200, { deal: { ...DEAL, scenario: "cbdc", version: 4 } }));
      }
      return Promise.reject(new Error(`unexpected url ${url}`));
    });

    await user.click(screen.getByRole("button", { name: /Подтвердить сценарий/ }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      "/api/deals/d1/scenario",
      expect.objectContaining({ method: "POST" }),
    ));
    const call = fetchMock.mock.calls.find(([url]) => (url as string).endsWith("/scenario"));
    const body = JSON.parse((call?.[1] as RequestInit).body as string);
    expect(body).toEqual({ scenario: "cbdc", version: 3 });
    await waitFor(() => expect(screen.getByText("Экран трекинга")).toBeInTheDocument());
  });

  it("на 409 VERSION_CONFLICT показывает «сделка изменилась» и перезапрашивает экран", async () => {
    stubHappyLoad();
    const user = userEvent.setup();
    renderPage();

    const availableCard = await screen.findByText("Цифровой рубль");
    await user.click(availableCard.closest("button")!);

    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (url.endsWith("/scenario") && init?.method === "POST") {
        return Promise.resolve(jsonResponse(409, { code: "VERSION_CONFLICT", error: "Сделка была изменена" }));
      }
      if (url.endsWith("/scenarios")) return Promise.resolve(jsonResponse(200, { corridorId: "RU-CN", scenarios: SCENARIOS }));
      if (url.endsWith("/deals/d1")) return Promise.resolve(jsonResponse(200, { deal: { ...DEAL, version: 5 } }));
      return Promise.reject(new Error(`unexpected url ${url}`));
    });

    await user.click(screen.getByRole("button", { name: /Подтвердить сценарий/ }));

    expect(await screen.findByText(/сделка изменилась/i)).toBeInTheDocument();
    // экран перезапросил данные — снова обратился к getDeal
    await waitFor(() => expect(fetchMock.mock.calls.filter(([url]) => (url as string).endsWith("/deals/d1")).length).toBeGreaterThan(1));
  });

  it("на 503 UPSTREAM_UNAVAILABLE показывает «сервис расчёта недоступен» с кнопкой «Повторить»", async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.endsWith("/scenarios")) return Promise.resolve(jsonResponse(503, { code: "UPSTREAM_UNAVAILABLE", error: "Сервис недоступен" }));
      if (url.endsWith("/deals/d1")) return Promise.resolve(jsonResponse(200, { deal: DEAL }));
      return Promise.reject(new Error(`unexpected url ${url}`));
    });
    renderPage();

    expect(await screen.findByText(/сервис расчёта комиссии временно недоступен/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Повторить" })).toBeInTheDocument();
  });
});
