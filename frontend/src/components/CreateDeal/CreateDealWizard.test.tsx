import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CreateDealWizard } from "./CreateDealWizard";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function renderWizard() {
  return render(
    <MemoryRouter initialEntries={["/deals/new"]}>
      <Routes>
        <Route path="/deals/new" element={<CreateDealWizard />} />
        <Route path="/deals/:id/scenario" element={<div>Экран сценария</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

// Проводит мастер через первые три шага (страна → тип операции → сумма и
// валюта), оставляя открытым последний шаг с названием контрагента —
// общий сетап для тестов, которым нужно дойти до сабмита.
async function fillUpToLastStep(user: ReturnType<typeof userEvent.setup>, amount = "1000") {
  await user.selectOptions(screen.getByLabelText("Страна контрагента"), "CN");
  await user.click(screen.getByRole("button", { name: "Далее" }));
  await user.click(screen.getByRole("button", { name: "Далее" }));
  const amountInput = screen.getByLabelText("Сумма сделки");
  await user.clear(amountInput);
  await user.type(amountInput, amount);
  await user.click(screen.getByRole("button", { name: "Далее" }));
}

describe("CreateDealWizard", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("отправляет ISO-код страны, а не русское название", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(
      jsonResponse(201, {
        deal: { id: "d1", displayId: "DEAL-1", version: 1 },
      }),
    );
    renderWizard();

    await fillUpToLastStep(user);
    await user.type(screen.getByLabelText("Название контрагента"), "Shenzhen Bay Trading Co.");
    await user.click(screen.getByRole("button", { name: "Создать сделку" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.counterpartyCountry).toBe("CN");
    expect(body.counterpartyCountry).not.toBe("Китай");
  });

  it("восстанавливает черновик из localStorage при перемонтировании", async () => {
    const user = userEvent.setup();
    const { unmount } = renderWizard();

    await user.selectOptions(screen.getByLabelText("Страна контрагента"), "TR");
    await user.click(screen.getByRole("button", { name: "Далее" }));

    expect(localStorage.getItem("draft:new-deal")).toContain("TR");

    unmount();
    renderWizard();

    // Мастер должен открыться сразу на шаге "Тип операции" (шаг 1), т.к.
    // страна уже выбрана и сохранена в черновике.
    expect(screen.getByText("Импорт")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Назад" }));
    expect(screen.getByLabelText("Страна контрагента")).toHaveValue("TR");
  });

  it("очищает черновик после успешного создания сделки", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(
      jsonResponse(201, { deal: { id: "d1", displayId: "DEAL-1", version: 1 } }),
    );
    renderWizard();

    await fillUpToLastStep(user);
    await user.type(screen.getByLabelText("Название контрагента"), "ООО Ромашка");
    await user.click(screen.getByRole("button", { name: "Создать сделку" }));

    await waitFor(() => expect(screen.getByText("Экран сценария")).toBeInTheDocument());
    expect(localStorage.getItem("draft:new-deal")).toBeNull();
  });

  it("не пропускает нулевую и отрицательную сумму", async () => {
    const user = userEvent.setup();
    renderWizard();

    await user.selectOptions(screen.getByLabelText("Страна контрагента"), "CN");
    await user.click(screen.getByRole("button", { name: "Далее" }));
    await user.click(screen.getByRole("button", { name: "Далее" }));

    const amountInput = screen.getByLabelText("Сумма сделки");
    await user.clear(amountInput);
    await user.type(amountInput, "0");
    await user.click(screen.getByRole("button", { name: "Далее" }));
    expect(screen.getByText(/сумму больше нуля/i)).toBeInTheDocument();

    await user.clear(amountInput);
    await user.type(amountInput, "-5");
    await user.click(screen.getByRole("button", { name: "Далее" }));
    expect(screen.getByText(/сумму больше нуля/i)).toBeInTheDocument();
  });

  it("не пропускает сумму с более чем двумя знаками после запятой", async () => {
    const user = userEvent.setup();
    renderWizard();

    await user.selectOptions(screen.getByLabelText("Страна контрагента"), "CN");
    await user.click(screen.getByRole("button", { name: "Далее" }));
    await user.click(screen.getByRole("button", { name: "Далее" }));

    const amountInput = screen.getByLabelText("Сумма сделки");
    await user.clear(amountInput);
    await user.type(amountInput, "10.123");
    await user.click(screen.getByRole("button", { name: "Далее" }));

    expect(screen.getByText(/не более двух знаков после запятой/i)).toBeInTheDocument();
  });

  it("показывает текст ошибки от BFF при 400 VALIDATION_ERROR, а не «Ошибка запроса: 400»", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(
      jsonResponse(400, { code: "VALIDATION_ERROR", error: "Коридор RU→IR не поддерживается" }),
    );
    renderWizard();

    await fillUpToLastStep(user);
    await user.type(screen.getByLabelText("Название контрагента"), "Тегеран Трейд");
    await user.click(screen.getByRole("button", { name: "Создать сделку" }));

    expect(await screen.findByText("Коридор RU→IR не поддерживается")).toBeInTheDocument();
    expect(screen.queryByText(/Ошибка запроса: 400/)).not.toBeInTheDocument();
  });

  // F14 (final review): раньше проверялся только текущий (последний) шаг —
  // восстановленный черновик, сохранённый на шаге 3 без страны (например,
  // сохранён руками через localStorage до того, как страна была заполнена),
  // уходил на сервер как есть.
  it("восстановленный черновик с пустым полем на более раннем шаге не уходит на сервер — мастер возвращает на невалидный шаг", async () => {
    localStorage.setItem(
      "draft:new-deal",
      JSON.stringify({
        form: { counterpartyCountry: "", operationType: "import", amount: 1000, currency: "RUB", counterpartyName: "ООО Ромашка" },
        step: 3,
      }),
    );
    const user = userEvent.setup();
    renderWizard();

    expect(screen.getByLabelText("Название контрагента")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Создать сделку" }));

    // Мастер должен вернуть на шаг 1 (страна) и показать его ошибку, а не
    // отправить запрос с пустой страной.
    expect(await screen.findByText("Выберите страну контрагента")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // F14 (final review): "1e-5" — валидный ввод для <input type="number">,
  // но раньше проверка decimals искала точку в raw и её экспоненциальная
  // запись обходила проверку "не более двух знаков после запятой".
  it("не пропускает сумму в экспоненциальной записи", async () => {
    const user = userEvent.setup();
    renderWizard();

    await user.selectOptions(screen.getByLabelText("Страна контрагента"), "CN");
    await user.click(screen.getByRole("button", { name: "Далее" }));
    await user.click(screen.getByRole("button", { name: "Далее" }));

    // fireEvent.change вместо посимвольного user.type: HTML5 number input
    // санирует value на каждое промежуточное нажатие ("1e" — ещё не валидное
    // число), эмулировать реальную печать посимвольно здесь не нужно — важно
    // само поведение amountError на готовой экспоненциальной строке.
    const amountInput = screen.getByLabelText("Сумма сделки");
    fireEvent.change(amountInput, { target: { value: "1e-5" } });
    await user.click(screen.getByRole("button", { name: "Далее" }));

    expect(screen.getByText(/без экспоненциальной записи/i)).toBeInTheDocument();
  });
});
