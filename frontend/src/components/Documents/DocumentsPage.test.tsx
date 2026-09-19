import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DocumentsPage } from "./DocumentsPage";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function deal(documents: unknown[], version = 2) {
  return {
    id: "d1",
    displayId: "DEAL-1",
    counterpartyCountry: "CN",
    counterpartyName: "Shenzhen Bay",
    operationType: "import",
    amount: 1000,
    currency: "USD",
    scenario: "cbdc",
    stage: "documents",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    hasBlockers: false,
    version,
    commissionTotal: 12345,
    documents,
    timeline: [],
  };
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/deals/d1/documents"]}>
      <Routes>
        <Route path="/deals/:dealId/documents" element={<DocumentsPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("DocumentsPage", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("показывает name, purpose и статус каждого документа", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        deal: deal([
          { id: "doc1", kind: "invoice", name: "Инвойс", purpose: "Подтверждение суммы сделки", status: "missing" },
          { id: "doc2", kind: "contract", name: "Контракт", purpose: "Условия поставки", status: "approved" },
        ]),
      }),
    );
    renderPage();

    expect(await screen.findByText("Инвойс")).toBeInTheDocument();
    expect(screen.getByText("Подтверждение суммы сделки")).toBeInTheDocument();
    expect(screen.getByText("Не загружен")).toBeInTheDocument();
    expect(screen.getByText("Контракт")).toBeInTheDocument();
    expect(screen.getByText("Подтверждён")).toBeInTheDocument();
  });

  it("кнопка «Отправить на проверку» доступна только для missing и rejected", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        deal: deal([
          { id: "doc1", kind: "invoice", name: "Инвойс", purpose: "п1", status: "missing" },
          { id: "doc2", kind: "contract", name: "Контракт", purpose: "п2", status: "rejected", rejectReason: "Нечитаемый скан" },
          { id: "doc3", kind: "license", name: "Лицензия", purpose: "п3", status: "under_review" },
          { id: "doc4", kind: "invoice2", name: "Счёт", purpose: "п4", status: "approved" },
        ]),
      }),
    );
    renderPage();

    await screen.findByText("Инвойс");
    expect(screen.getAllByRole("button", { name: "Отправить на проверку" })).toHaveLength(2);
  });

  it("у отклонённого документа видна rejectReason", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        deal: deal([
          { id: "doc1", kind: "contract", name: "Контракт", purpose: "п1", status: "rejected", rejectReason: "Нечитаемый скан" },
        ]),
      }),
    );
    renderPage();

    expect(await screen.findByText("Нечитаемый скан")).toBeInTheDocument();
  });

  it("подача отправляет version сделки на /submit", async () => {
    const dealBody = deal([{ id: "doc1", kind: "invoice", name: "Инвойс", purpose: "п1", status: "missing" }], 7);
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (url.endsWith("/submit")) return Promise.resolve(jsonResponse(200, { deal: { ...dealBody, version: 8 } }));
      if (url.endsWith("/deals/d1")) return Promise.resolve(jsonResponse(200, { deal: dealBody }));
      return Promise.reject(new Error(`unexpected url ${url} ${init?.method}`));
    });
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole("button", { name: "Отправить на проверку" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      "/api/deals/d1/documents/doc1/submit",
      expect.objectContaining({ method: "POST" }),
    ));
    const call = fetchMock.mock.calls.find(([url]) => (url as string).endsWith("/submit"));
    const body = JSON.parse((call?.[1] as RequestInit).body as string);
    expect(body).toEqual({ version: 7 });
  });
});
