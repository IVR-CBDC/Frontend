import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthProvider } from "./AuthProvider";
import { LoginPage } from "./LoginPage";
import { RequireAuth } from "./RequireAuth";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function renderApp(initialPath: string) {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/" element={<div>Дашборд</div>} />
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

describe("LoginPage", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("успешный вход зовёт POST /api/auth/login с credentials same-origin, без токена в состоянии", async () => {
    const user = userEvent.setup();

    let loggedIn = false;
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/auth/login")) {
        loggedIn = true;
        return Promise.resolve(jsonResponse(200, { user_id: "u1", company_id: "c1" }));
      }
      if (url.endsWith("/api/auth/me")) {
        if (!loggedIn) return Promise.resolve(jsonResponse(401, { code: "UNAUTHORIZED", error: "Войдите" }));
        return Promise.resolve(
          jsonResponse(200, {
            user_id: "u1",
            login: "ivan",
            name: "Иван",
            company: { id: "c1", name: "ООО Ромашка", inn: "1234567890" },
          }),
        );
      }
      return Promise.resolve(jsonResponse(401, { code: "UNAUTHORIZED", error: "Войдите" }));
    });

    renderApp("/login");

    await user.type(screen.getByLabelText("Логин"), "ivan");
    await user.type(screen.getByLabelText("Пароль"), "correct-horse");
    await user.click(screen.getByRole("button", { name: "Войти" }));

    const loginCall = await waitFor(() => {
      const call = fetchMock.mock.calls.find(([input]) => String(input).endsWith("/api/auth/login"));
      expect(call).toBeTruthy();
      return call!;
    });
    expect(loginCall[1]).toMatchObject({ credentials: "same-origin" });

    // Токена нет ни в теле запроса, ни в каком-либо виде хранилища браузера.
    expect(JSON.parse(loginCall[1].body as string)).not.toHaveProperty("token");
    expect(window.localStorage.getItem("token")).toBeNull();
    expect(document.cookie).not.toContain("token=");
  });

  it("вход с неверным паролем показывает человеческое сообщение и не редиректит в цикле", async () => {
    const user = userEvent.setup();
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/auth/login")) {
        return Promise.resolve(jsonResponse(401, { code: "INVALID_CREDENTIALS", error: "Неверный логин или пароль" }));
      }
      return Promise.resolve(jsonResponse(401, { code: "UNAUTHORIZED", error: "Войдите" }));
    });

    renderApp("/login");

    await user.type(screen.getByLabelText("Логин"), "ivan");
    await user.type(screen.getByLabelText("Пароль"), "wrong");
    await user.click(screen.getByRole("button", { name: "Войти" }));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Неверный логин или пароль"));
    // Остаёмся на экране входа — форма всё ещё на месте, значит редиректа
    // на себя же в цикле не произошло.
    expect(screen.getByRole("button", { name: "Войти" })).toBeInTheDocument();
  });

  it("после входа возвращает на исходный защищённый маршрут", async () => {
    const user = userEvent.setup();
    let loggedIn = false;
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/auth/login")) {
        loggedIn = true;
        return Promise.resolve(jsonResponse(200, { user_id: "u1", company_id: "c1" }));
      }
      if (url.endsWith("/api/auth/me")) {
        if (!loggedIn) return Promise.resolve(jsonResponse(401, { code: "UNAUTHORIZED", error: "Войдите" }));
        return Promise.resolve(
          jsonResponse(200, {
            user_id: "u1",
            login: "ivan",
            name: "Иван",
            company: { id: "c1", name: "ООО Ромашка", inn: "1234567890" },
          }),
        );
      }
      return Promise.resolve(jsonResponse(401, { code: "UNAUTHORIZED", error: "Войдите" }));
    });

    renderApp("/deals/42/tracking");

    await waitFor(() => expect(screen.getByLabelText("Логин")).toBeInTheDocument());
    await user.type(screen.getByLabelText("Логин"), "ivan");
    await user.type(screen.getByLabelText("Пароль"), "correct-horse");
    await user.click(screen.getByRole("button", { name: "Войти" }));

    await waitFor(() => expect(screen.getByText("Защищённый трекинг")).toBeInTheDocument());
  });
});
