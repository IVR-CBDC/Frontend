// Критерий готовности всей системы (спека §1): юрлицо регистрируется,
// заводит сделку, видит реальную комиссию, подаёт документы и наблюдает,
// как сделка сама доезжает до completed — без единой перезагрузки страницы.
// Это ровно то демо, которое показывают на защите, записанное как тест:
// каждый шаг что-то проверяет, а не просто "кликнули и дальше".
//
// Эмулятор — в ручном режиме (EMULATOR_MANUAL=true): прогресс сделки решает
// не время, а вызовы tick() из теста, поэтому здесь нет ни одного
// waitForTimeout — только автоожидающие expect() и expect.poll(), которые
// на каждой попытке дёргают tick() и проверяют реальное состояние экрана.

import { BFF_URL, expect, test, waitForDocumentApproved } from "./fixtures/stand";

const COUNTERPARTY_NAME = "Shenzhen Bay Trading Co.";
const DEAL_AMOUNT = "50000";
const DEAL_CURRENCY = "CNY";

test.describe("Сквозной путь сделки", () => {
  test("регистрация → сделка → сценарий → документы → трекинг, без перезагрузки страницы", async ({
    page,
    tick,
  }) => {
    // --- 1. Начинаем авторизованными, дашборд пуст ------------------------
    const totalDealsCount = page.getByTestId("deals-total-count");
    await expect(totalDealsCount).toHaveText("0");
    await expect(page.getByText("Активных сделок пока нет.")).toBeVisible();

    // --- 2. Создаём сделку через мастер ------------------------------------
    await page.getByRole("link", { name: "+ Новая сделка" }).click();
    await expect(page).toHaveURL(/\/deals\/new$/);

    // Шаг 1: страна контрагента.
    await expect(page.locator('[aria-current="step"]')).toContainText("Страна контрагента");
    await page.getByLabel("Страна контрагента").selectOption({ label: "Китай" });
    await page.getByRole("button", { name: "Далее" }).click();

    // Шаг 2: тип операции.
    await expect(page.locator('[aria-current="step"]')).toContainText("Тип операции");
    await page.getByRole("button", { name: "Импорт", exact: true }).click();
    await page.getByRole("button", { name: "Далее" }).click();

    // Шаг 3: сумма и валюта.
    await expect(page.locator('[aria-current="step"]')).toContainText("Сумма и валюта");
    await page.getByLabel("Сумма сделки").fill(DEAL_AMOUNT);
    await page.getByLabel("Валюта").selectOption(DEAL_CURRENCY);
    await page.getByRole("button", { name: "Далее" }).click();

    // Шаг 4: данные контрагента — и отправка.
    await expect(page.locator('[aria-current="step"]')).toContainText("Данные контрагента");
    await page.getByLabel("Название контрагента").fill(COUNTERPARTY_NAME);
    await page.getByRole("button", { name: "Создать сделку" }).click();

    // Мастер сам ведёт на экран сценария только что созданной сделки.
    await page.waitForURL(/\/deals\/[^/]+\/scenario$/);
    const dealId = new URL(page.url()).pathname.split("/")[2];
    expect(dealId).toBeTruthy();

    // Дашборд должен показать ровно одну сделку — с "Китай", а не с "CN"
    // (регрессия, которую спека прямо называет).
    await page.getByRole("link", { name: "Дашборд" }).click();
    await expect(totalDealsCount).toHaveText("1");
    const dealLink = page.locator(`a[href="/deals/${dealId}/tracking"]`);
    await expect(dealLink).toContainText("Китай");
    await expect(dealLink).toContainText(COUNTERPARTY_NAME);
    // Регрессия из спеки: страна должна быть человекочитаемым названием, а
    // не сырым ISO-кодом ("CN" как отдельное слово/аббревиатура рядом с
    // операцией или страной — валюта DEAL_CURRENCY, "CNY", легитимно
    // содержит подстроку "CN" и не должна ложно проваливать эту проверку).
    await expect(dealLink.locator("div", { hasText: "Импорт" }).first()).not.toHaveText(/\bCN\b/);

    // Заходим в саму сделку — свежесозданная, сценарий ещё не выбран.
    await dealLink.click();
    await page.waitForURL(`/deals/${dealId}/tracking`);
    await page.getByRole("link", { name: "Выбрать сценарий" }).click();
    await page.waitForURL(`/deals/${dealId}/scenario`);

    // --- 3. Экран сценариев: числовая комиссия с валютой, выбор ЦВЦБ ------
    const scenarioCards = page.getByTestId("scenario-card");
    await expect(scenarioCards).toHaveCount(4);

    const cbdcCard = page.locator('[data-testid="scenario-card"][data-scenario="cbdc"]');
    await expect(cbdcCard).toBeVisible();

    // F1 (final fix wave, критично): спека §1 требует сценарий "с комиссией
    // из commission-service", а не "с каким-то числом на экране" — прежняя
    // проверка была регэкспом "цифры + код валюты" где угодно в карточке и
    // пропускала "0 CNY" точно так же, как правильное значение. Тест не
    // пересчитывает формулу комиссии сам (это была бы регрессия из плана 03
    // — ревью уже указывало на это для recovery.spec.ts, см. F3/F4 там же),
    // а запрашивает ту же котировку у BFF, которую в этом самом прогоне
    // получил и отрендерил экран (GET /api/deals/:id/scenarios — тот же
    // запрос, что делает ScenarioPage.load()), и сравнивает с тем, что
    // показано в блоке "Стоимость" выбранной карточки. Сверка с живым
    // сервисом, а не переизобретение его логики.
    const scenariosRes = await page.request.get(`${BFF_URL}/api/deals/${dealId}/scenarios`);
    expect(scenariosRes.ok(), `GET /api/deals/${dealId}/scenarios: ${scenariosRes.status()}`).toBe(true);
    const scenariosBody = (await scenariosRes.json()) as {
      scenarios: Array<{ id: string; commission: { total: number } | null }>;
    };
    const cbdcQuote = scenariosBody.scenarios.find((s) => s.id === "cbdc");
    expect(cbdcQuote?.commission, "у сценария cbdc нет котировки комиссии").not.toBeNull();
    const expectedTotal = cbdcQuote!.commission!.total;
    // Ненулевое значение — "Уточняется"/0 не должны молча проходить проверку.
    expect(expectedTotal).toBeGreaterThan(0);
    const expectedCost = `${new Intl.NumberFormat("ru-RU").format(expectedTotal)} ${DEAL_CURRENCY}`;
    // Локатор привязан к самому блоку "Стоимость" (data-testid="scenario-cost",
    // ScenarioPage.tsx StatBlock), а не к regexp по всей карточке.
    await expect(cbdcCard.getByTestId("scenario-cost")).toHaveText(expectedCost);

    await cbdcCard.click();
    await page.getByRole("button", { name: "Подтвердить сценарий" }).click();

    // Подтверждение сценария ведёт обратно на трекинг (ScenarioPage.confirm)
    // — сделка там уже должна значиться как перешедшая к сбору документов.
    await page.waitForURL(`/deals/${dealId}/tracking`);
    await expect(page.getByTestId("deal-stage")).toHaveText("Сбор документов");
    await page.getByRole("link", { name: "Документооборот" }).click();
    await page.waitForURL(`/deals/${dealId}/documents`);

    // --- 4. Документы: подать оба, довести до "Подтверждён" без reload ----
    const documentRows = page.getByTestId("document-row");
    await expect(documentRows).toHaveCount(2);
    for (const status of await documentRows.getByTestId("document-status").allTextContents()) {
      expect(status).toBe("Не загружен");
    }

    // Подаём документы по одному — submit() требует актуальную version
    // сделки, поэтому ждём, пока статус строки перестанет быть "Не загружен"
    // (т.е. предыдущая отправка долетела и state обновился), прежде чем
    // отправлять следующий.
    const rowCount = await documentRows.count();
    for (let i = 0; i < rowCount; i++) {
      const row = documentRows.nth(i);
      await row.getByRole("button", { name: /Отправить на проверку/ }).click();
      await expect(row.getByTestId("document-status")).not.toHaveText("Не загружен");
    }

    // Двигаем эмулятор и ждём "Подтверждён" на каждом документе. Один из
    // двух документов теоретически может быть отклонён на первой попытке
    // (~10%, см. service-core/include/emulator.h) — тест не пытается
    // угадать/воспроизвести этот хэш, а просто реагирует: видим "Отклонён",
    // жмём "Отправить на проверку" ещё раз (повторная подача всегда
    // одобряется).
    await Promise.all(
      (await documentRows.all()).map((row) => waitForDocumentApproved(row, tick)),
    );

    // --- 5. Трекинг: доводим сделку до completed, без единого reload ------
    await page.getByRole("link", { name: "Дашборд" }).click();
    await page.locator(`a[href="/deals/${dealId}/tracking"]`).click();
    await page.waitForURL(`/deals/${dealId}/tracking`);

    const stageBadge = page.getByTestId("deal-stage");
    await expect.poll(
      async () => {
        await tick();
        return stageBadge.textContent();
      },
      { timeout: 90_000, message: "сделка не дошла до 'Завершена'" },
    ).toBe("Завершена");

    // Таймлайн обновился сам (тот же WS-пуш + перезапрос, что двигал статусы
    // документов) — все шаги, включая последний, "Завершено".
    const finalTimelineStep = page.locator("li", { hasText: "Завершение сделки" });
    await expect(finalTimelineStep).toContainText("Завершено");

    // Прогресс на дашборде — 100%. Тот же клиентский переход (Sidebar-ссылка,
    // без page.reload()) подтверждает, что вся цепочка WS → refetch дошла и
    // до карточки на дашборде, не только до экрана трекинга.
    await page.getByRole("link", { name: "Дашборд" }).click();
    const finishedDealCard = page.locator(`a[href="/deals/${dealId}/tracking"]`);
    await expect(finishedDealCard.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "100");
    await expect(finishedDealCard).toContainText("Завершена");
  });
});
