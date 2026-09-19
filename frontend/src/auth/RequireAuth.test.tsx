import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthProvider } from "./AuthProvider";
import { RequireAuth } from "./RequireAuth";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function renderApp(initialPath: string) {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<div>Экран входа</div>} />
          <Route
            path="/deals/:id/tracking"
            element={
              <RequireAuth>
                <div>Защищённый трекинг</div>
              </RequireAuth>
            }
          />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe("RequireAuth", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("anonymous → редиректит на /login и не моргает защищённым контентом", async () => {
    fetchMock.mockResolvedValue(jsonResponse(401, { code: "UNAUTHORIZED", error: "Войдите" }));

    renderApp("/deals/42/tracking");

    await waitFor(() => expect(screen.getByText("Экран входа")).toBeInTheDocument());
    expect(screen.queryByText("Защищённый трекинг")).not.toBeInTheDocument();
  });

  it("authenticated → показывает защищённый контент", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, { user_id: "u1", login: "ivan", name: "Иван", company: { id: "c1", name: "ООО Ромашка", inn: "1234567890" } }),
    );

    renderApp("/deals/42/tracking");

    await waitFor(() => expect(screen.getByText("Защищённый трекинг")).toBeInTheDocument());
  });

  // F13 (final review): раньше при loading рендерился null — странице
  // нечего было ждать в e2e. data-app-status держит текущий статус на одном
  // узле во всех трёх состояниях.
  it("data-app-status отражает переход loading → authenticated", async () => {
    let resolveMe!: (v: Response) => void;
    fetchMock.mockReturnValue(new Promise((resolve) => (resolveMe = resolve)));

    renderApp("/deals/42/tracking");

    expect(document.querySelector('[data-app-status="loading"]')).toBeInTheDocument();

    resolveMe(
      jsonResponse(200, { user_id: "u1", login: "ivan", name: "Иван", company: { id: "c1", name: "ООО Ромашка", inn: "1234567890" } }),
    );

    await waitFor(() => expect(document.querySelector('[data-app-status="authenticated"]')).toBeInTheDocument());
  });
});
