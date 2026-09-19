import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { DealCard } from "./DealCard";
import type { DashboardCard } from "../../types/api";

const BLOCKED_DEAL: DashboardCard = {
  id: "d1",
  displayId: "DEAL-1",
  counterpartyName: "Shenzhen Bay",
  counterpartyCountry: "CN",
  operationType: "import",
  amount: 500_000,
  currency: "USD",
  stage: "blocked",
  progressPercent: 42,
  needsAttention: true,
  attentionReason: "Не хватает подтверждающего документа",
  updatedAt: "2026-01-01T00:00:00Z",
};

describe("DealCard", () => {
  it("показывает progressPercent и причину блокировки для сделки в blocked", () => {
    render(
      <MemoryRouter>
        <DealCard deal={BLOCKED_DEAL} />
      </MemoryRouter>,
    );

    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "42");
    expect(screen.getByText(/Не хватает подтверждающего документа/)).toBeInTheDocument();
  });

  // F5 (final review): counterpartyCountry — ISO-код ("CN"), карточка должна
  // показывать название страны, а не код.
  it("показывает название страны, а не ISO-код", () => {
    render(
      <MemoryRouter>
        <DealCard deal={BLOCKED_DEAL} />
      </MemoryRouter>,
    );

    expect(screen.getByText(/Китай/)).toBeInTheDocument();
    expect(screen.queryByText("Импорт · CN")).not.toBeInTheDocument();
  });
});
