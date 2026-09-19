import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api/client";
import { AuthProvider } from "./AuthProvider";
import { RequireAuth } from "./RequireAuth";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function Protected() {
  return <div>Защищённый экран</div>;
}

describe("AuthProvider — session expiry mid-flight", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("401 TOKEN_EXPIRED на произвольном запросе переводит приложение в anonymous → редирект на /login", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        user_id: "u1",
        login: "ivan",
        name: "Иван",
        company: { id: "c1", name: "ООО Ромашка", inn: "1234567890" },
      }),
    );

    render(
      <MemoryRouter initialEntries={["/deals/1/tracking"]}>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<div>Экран входа</div>} />
            <Route
              path="/deals/:id/tracking"
              element={
                <RequireAuth>
                  <Protected />
                </RequireAuth>
              }
            />
          </Routes>
        </AuthProvider>
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByText("Защищённый экран")).toBeInTheDocument());

    // Некий произвольный запрос в середине сессии обнаруживает погашенную
    // BFF cookie.
    fetchMock.mockResolvedValueOnce(jsonResponse(401, { code: "TOKEN_EXPIRED", error: "Сессия истекла" }));
    await expect(api.getDashboard()).rejects.toBeTruthy();

    await waitFor(() => expect(screen.getByText("Экран входа")).toBeInTheDocument());
  });
});
