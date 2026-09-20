// company_id из JWT — единственная граница между арендаторами во всей
// системе (см. task-2-brief.md, план 03). API-уровень (service-core,
// bff) это проверяют pytest-тесты плана 03; этот сценарий — единственная
// проверка изоляции, которую видит пользователь: что SPA не покажет чужую
// сделку, даже если её id ввести в адресную строку напрямую.
//
// Компания A создаёт сделку в своём (дефолтном для теста) браузерном
// контексте. Компания B регистрируется в отдельном browser-контексте (свой
// набор cookie — ровно так и выглядят две разные вкладки/два разных
// пользователя в реальности) и пытается достучаться до сделки A тремя
// способами: с дашборда, прямым переходом на /tracking и на /documents.

import { randomUUID } from "node:crypto";
import { expect, test, BFF_URL, SPA_URL } from "./fixtures/stand";

test.describe("Изоляция арендаторов", () => {
  test("компания B не видит сделку компании A ни на дашборде, ни по прямой ссылке", async ({
    page,
    browser,
  }) => {
    // --- Компания A создаёт сделку --------------------------------------
    await page.getByRole("link", { name: "+ Новая сделка" }).click();
    await page.waitForURL(/\/deals\/new$/);

    await page.getByLabel("Страна контрагента").selectOption({ label: "Китай" });
    await page.getByRole("button", { name: "Далее" }).click();
    await page.getByRole("button", { name: "Импорт", exact: true }).click();
    await page.getByRole("button", { name: "Далее" }).click();
    await page.getByLabel("Сумма сделки").fill("10000");
    await page.getByLabel("Валюта").selectOption("USD");
    await page.getByRole("button", { name: "Далее" }).click();
    await page.getByLabel("Название контрагента").fill("Isolation Test Counterparty");
    await page.getByRole("button", { name: "Создать сделку" }).click();

    await page.waitForURL(/\/deals\/[^/]+\/scenario$/);
    const dealAId = new URL(page.url()).pathname.split("/")[2];
    expect(dealAId).toBeTruthy();

    // --- Компания B: отдельный browser-контекст, отдельная сессия --------
    const companyBContext = await browser.newContext();
    const registerRes = await companyBContext.request.post(`${BFF_URL}/api/auth/register`, {
      headers: { Origin: SPA_URL },
      data: {
        login: `e2e-isolation-b-${randomUUID()}`,
        password: "E2e-Test-Passw0rd!",
        company_name: `E2E Isolation B ${randomUUID().slice(0, 8)}`,
        inn: randomInn(),
      },
    });
    expect(registerRes.ok(), `не удалось зарегистрировать компанию B: ${await registerRes.text()}`).toBe(true);

    const pageB = await companyBContext.newPage();
    await pageB.goto("/");

    // 1. Дашборд B пуст — сделки A там нет.
    await expect(pageB.getByText("Активных сделок пока нет.")).toBeVisible();
    await expect(pageB.locator(`a[href="/deals/${dealAId}/tracking"]`)).toHaveCount(0);

    // 2. Прямой переход по URL трекинга сделки A — ошибка "не найдено", а не
    // данные чужой сделки.
    await pageB.goto(`/deals/${dealAId}/tracking`);
    await expect(pageB.getByRole("alert")).toContainText("не найдены");
    await expect(pageB.getByText("Isolation Test Counterparty")).not.toBeVisible();

    // 3. То же для документооборота сделки A.
    await pageB.goto(`/deals/${dealAId}/documents`);
    await expect(pageB.getByRole("alert")).toContainText("не найдены");
    await expect(pageB.getByTestId("document-row")).toHaveCount(0);

    await companyBContext.close();
  });
});

function randomInn(): string {
  let digits = "";
  for (let i = 0; i < 10; i++) digits += Math.floor(Math.random() * 10);
  return digits;
}
