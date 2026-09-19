import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NotificationsDrawer } from "./NotificationsDrawer";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const NOTIFICATIONS = [
  { id: "n1", dealId: "d1", severity: "warning", message: "Требуется документ", createdAt: "2026-01-01T00:00:00Z", read: false },
  { id: "n2", dealId: "d1", severity: "info", message: "Сделка продвинулась", createdAt: "2026-01-02T00:00:00Z", read: false },
];

describe("NotificationsDrawer", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("отметка прочитанным зовёт onRead и снимает бейдж 'непрочитано' у пункта", async () => {
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/notifications") && (!init || init.method === undefined)) {
        return Promise.resolve(jsonResponse(200, { notifications: NOTIFICATIONS }));
      }
      if (url.endsWith("/api/notifications/n1/read")) {
        return Promise.resolve(jsonResponse(200, { notification: { ...NOTIFICATIONS[0], read: true } }));
      }
      return Promise.resolve(jsonResponse(404, { code: "NOT_FOUND", error: "Не найдено" }));
    });

    const onRead = vi.fn();
    const user = userEvent.setup();
    render(<NotificationsDrawer open onClose={() => {}} refreshKey={0} onRead={onRead} />);

    await waitFor(() => expect(screen.getByText("Требуется документ")).toBeInTheDocument());

    const buttons = screen.getAllByRole("button", { name: "Прочитано" });
    await user.click(buttons[0]);

    await waitFor(() => expect(onRead).toHaveBeenCalledWith("n1"));
  });

  it("не падает, если отметка прочитанным получает 404 (уведомление уже неактуально) — всё равно считает прочитанным", async () => {
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/notifications")) {
        return Promise.resolve(jsonResponse(200, { notifications: NOTIFICATIONS }));
      }
      if (url.endsWith("/api/notifications/n1/read")) {
        return Promise.resolve(jsonResponse(404, { code: "NOT_FOUND", error: "Не найдено" }));
      }
      return Promise.resolve(jsonResponse(404, { code: "NOT_FOUND", error: "Не найдено" }));
    });

    const onRead = vi.fn();
    const user = userEvent.setup();
    render(<NotificationsDrawer open onClose={() => {}} refreshKey={0} onRead={onRead} />);

    await waitFor(() => expect(screen.getByText("Требуется документ")).toBeInTheDocument());

    const buttons = screen.getAllByRole("button", { name: "Прочитано" });
    await expect(user.click(buttons[0])).resolves.not.toThrow();

    await waitFor(() => expect(onRead).toHaveBeenCalledWith("n1"));
    // После 404 кнопка "Прочитано" для n1 больше не должна показываться —
    // пункт локально считается прочитанным.
    expect(screen.getAllByRole("button", { name: "Прочитано" })).toHaveLength(1);
  });
});
