import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthProvider } from "./AuthProvider";
import { RegisterPage } from "./RegisterPage";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function renderApp() {
  return render(
    <MemoryRouter initialEntries={["/register"]}>
      <AuthProvider>
        <Routes>
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/" element={<div>Дашборд</div>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

async function fillCommonFields(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("Название компании"), "ООО Ромашка");
  await user.type(screen.getByLabelText("Логин"), "ivan");
  await user.type(screen.getByLabelText("Пароль"), "correct-horse");
}

describe("RegisterPage", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue(jsonResponse(401, { code: "UNAUTHORIZED", error: "Войдите" }));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("ИНН из 3 цифр не даёт отправить форму и показывает подсказку", async () => {
    const user = userEvent.setup();
    renderApp();

    await fillCommonFields(user);
    await user.type(screen.getByLabelText("ИНН"), "123");
    await user.click(screen.getByRole("button", { name: "Зарегистрироваться" }));

    expect(screen.getByText("ИНН должен состоять из 10 цифр")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalledWith("/api/auth/register", expect.anything());
  });

  it("подсказка про формат ИНН гаснет по мере редактирования поля, не дожидаясь следующего submit", async () => {
    const user = userEvent.setup();
    renderApp();

    await fillCommonFields(user);
    await user.type(screen.getByLabelText("ИНН"), "123");
    await user.click(screen.getByRole("button", { name: "Зарегистрироваться" }));
    expect(screen.getByText("ИНН должен состоять из 10 цифр")).toBeInTheDocument();

    await user.type(screen.getByLabelText("ИНН"), "4");

    expect(screen.queryByText("ИНН должен состоять из 10 цифр")).not.toBeInTheDocument();
  });

  it("отправляет company_name и inn вместе с login/password", async () => {
    const user = userEvent.setup();
    let registered = false;
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/auth/register")) {
        registered = true;
        return Promise.resolve(jsonResponse(200, { user_id: "u1", company_id: "c1" }));
      }
      if (url.endsWith("/api/auth/me")) {
        if (!registered) return Promise.resolve(jsonResponse(401, { code: "UNAUTHORIZED", error: "Войдите" }));
        return Promise.resolve(
          jsonResponse(200, {
            user_id: "u1",
            login: "ivan",
            name: "",
            company: { id: "c1", name: "ООО Ромашка", inn: "1234567890" },
          }),
        );
      }
      return Promise.resolve(jsonResponse(401, { code: "UNAUTHORIZED", error: "Войдите" }));
    });

    renderApp();

    await fillCommonFields(user);
    await user.type(screen.getByLabelText("ИНН"), "1234567890");
    await user.click(screen.getByRole("button", { name: "Зарегистрироваться" }));

    const registerCall = await waitFor(() => {
      const call = fetchMock.mock.calls.find(([input]) => String(input).endsWith("/api/auth/register"));
      expect(call).toBeTruthy();
      return call!;
    });
    const body = JSON.parse(registerCall[1].body as string);
    expect(body).toMatchObject({
      login: "ivan",
      password: "correct-horse",
      company_name: "ООО Ромашка",
      inn: "1234567890",
    });

    await waitFor(() => expect(screen.getByText("Дашборд")).toBeInTheDocument());
  });
});
