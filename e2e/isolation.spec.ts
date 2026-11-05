











import { randomUUID } from "node:crypto";
import { expect, test, randomInn, BFF_URL, SPA_URL } from "./fixtures/stand";

test.describe("Изоляция арендаторов", () => {
  test("компания B не видит сделку компании A ни на дашборде, ни по прямой ссылке", async ({
    page,
    browser,
  }) => {
    
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
