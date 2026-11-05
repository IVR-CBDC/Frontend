import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Timeline } from "./Timeline";
import type { TimelineEvent } from "../../types/api";

const EVENTS: TimelineEvent[] = [
  {
    seq: 1,
    label: "Сбор документов",
    actor: "Комплаенс-служба Альфа-Банка",
    status: "done",
    startedAt: "2026-01-01T10:00:00Z",
    finishedAt: "2026-01-01T11:00:00Z",
  },
  {
    seq: 2,
    label: "Комплаенс-проверка",
    actor: "ФНС России",
    status: "delayed",
    delayReason: "Ожидаем ответ от ФНС",
    startedAt: "2026-01-02T09:00:00Z",
    finishedAt: null,
  },
];

describe("Timeline", () => {
  it("показывает участника каждого шага", () => {
    render(<Timeline events={EVENTS} />);
    fireEvent.click(screen.getAllByRole("button", { name: /Подробнее/ })[0]);
    fireEvent.click(screen.getAllByRole("button", { name: /Подробнее/ })[0]);
    expect(screen.getByText(/Комплаенс-служба Альфа-Банка/)).toBeInTheDocument();
    expect(screen.getByText(/ФНС России/)).toBeInTheDocument();
  });

  it("показывает delayReason для шага со статусом delayed", () => {
    render(<Timeline events={EVENTS} />);
    fireEvent.click(screen.getAllByRole("button", { name: /Подробнее/ })[1]);
    expect(screen.getByText(/Ожидаем ответ от ФНС/)).toBeInTheDocument();
  });

  it("не показывает причину задержки для шага без неё (done) — только для delayed", () => {
    render(<Timeline events={EVENTS} />);
    fireEvent.click(screen.getAllByRole("button", { name: /Подробнее/ })[0]);
    expect(screen.queryByText(/Причина задержки/)).not.toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: /Подробнее/ })[0]);
    expect(screen.getAllByText(/Причина задержки/)).toHaveLength(1);
  });
});
