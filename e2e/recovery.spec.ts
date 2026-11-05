





















import type { Locator, Page } from "@playwright/test";
import { expect, test, waitForDocumentApproved } from "./fixtures/stand";












const COUNTERPARTY_NAME = "Recovery Test Trading Co.";
const DEAL_AMOUNT = "30000";
const DEAL_CURRENCY = "USD";






const MAX_ATTEMPTS = 40;

test.describe("Восстановление сделки после отклонённого документа", () => {
  test("переподанный документ одобряется, сделка доходит до completed", async ({ page, tick }) => {
    
    
    
    
    
    
    
    
    
    
    
    
    
    
    
    
    
    test.setTimeout(720_000);

    let rejectedRow: Locator | null = null;
    let dealId: string | null = null;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS && !rejectedRow; attempt++) {
      dealId = await createDealThroughDocuments(page);

      
      
      
      
      
      
      
      
      
      
      const rows = page.getByTestId("document-row");
      const statusBadges = rows.getByTestId("document-status");
      let outcome: "rejected" | "approved" | null = null;
      await expect
        .poll(
          async () => {
            await tick();
            const statuses = await statusBadges.allTextContents();
            if (statuses.includes("Отклонён")) {
              outcome = "rejected";
              return true;
            }
            if (statuses.every((s) => s === "Подтверждён")) {
              outcome = "approved";
              return true;
            }
            return false;
          },
          { timeout: 20_000, message: "документы не дошли до финального статуса первой проверки" },
        )
        .toBe(true);

      if (outcome === "rejected") {
        const count = await rows.count();
        for (let i = 0; i < count; i++) {
          const row = rows.nth(i);
          if ((await row.getByTestId("document-status").textContent()) === "Отклонён") {
            rejectedRow = row;
            break;
          }
        }
      }

      if (!rejectedRow) {
        
        
        await page.getByRole("link", { name: "Дашборд" }).click();
      }
    }

    if (!rejectedRow || !dealId) {
      throw new Error(
        `За ${MAX_ATTEMPTS} сделок ни один документ не был отклонён на первой попытке. ` +
          "Ожидаемая вероятность отказа ~10% на документ — если это не флуктуация, " +
          "поведение эмулятора (service-core/include/emulator.h documentApproved) изменилось.",
      );
    }

    // Причина отказа должна быть видна на экране, а не только в статусе.
    await expect(rejectedRow.locator(".field-error")).not.toHaveText("");

    // Переподаём отклонённый документ — согласно documentApproved, вторая
    // попытка (attempt >= 1) одобряется всегда.
    await rejectedRow.getByRole("button", { name: /Отправить на проверку/ }).click();
    await expect(rejectedRow.getByTestId("document-status")).not.toHaveText("Отклонён");

    // Доводим все документы сделки (включая переподанный) до "Подтверждён" —
    // тикаем и, если какой-то документ всё ещё "Отклонён" (после уже второй
    // попытки такое не ожидается, но на всякий случай применяем ту же
    // общую логику ожидания, что и happy-path), переподаём ещё раз.
    const rows = page.getByTestId("document-row");
    await Promise.all((await rows.all()).map((row) => waitForDocumentApproved(row, tick)));

    // И сама сделка доходит до "Завершена" — восстановление не просто
    // проходит для документа, а разблокирует всю сделку.
    await page.getByRole("link", { name: "Дашборд" }).click();
    await page.locator(`a[href="/deals/${dealId}/tracking"]`).click();
    await page.waitForURL(`/deals/${dealId}/tracking`);

    const stageBadge = page.getByTestId("deal-stage");
    await expect.poll(
      async () => {
        await tick();
        return stageBadge.textContent();
      },
      { timeout: 90_000, message: "сделка не дошла до 'Завершена' после восстановления документа" },
    ).toBe("Завершена");
  });
});

// Создаёт сделку через мастер (страна Китай/импорт, как в happy-path — сами
// параметры сделки не влияют на вердикт эмулятора, важен только deal_id),
// выбирает сценарий ЦВЦБ, подаёт оба документа на проверку и возвращает на
// экране документооборота, готовом к первому тику.
async function createDealThroughDocuments(page: Page): Promise<string> {
  await page.getByRole("link", { name: "+ Новая сделка" }).click();
  await page.waitForURL(/\/deals\/new$/);

  await page.getByLabel("Страна контрагента").selectOption({ label: "Китай" });
  await page.getByRole("button", { name: "Далее" }).click();

  await page.getByRole("button", { name: "Импорт", exact: true }).click();
  await page.getByRole("button", { name: "Далее" }).click();

  await page.getByLabel("Сумма сделки").fill(DEAL_AMOUNT);
  await page.getByLabel("Валюта").selectOption(DEAL_CURRENCY);
  await page.getByRole("button", { name: "Далее" }).click();

  await page.getByLabel("Название контрагента").fill(COUNTERPARTY_NAME);
  await page.getByRole("button", { name: "Создать сделку" }).click();

  await page.waitForURL(/\/deals\/[^/]+\/scenario$/);
  const dealId = new URL(page.url()).pathname.split("/")[2];

  const cbdcCard = page.locator('[data-testid="scenario-card"][data-scenario="cbdc"]');
  await cbdcCard.click();
  await page.getByRole("button", { name: "Подтвердить сценарий" }).click();

  await page.waitForURL(`/deals/${dealId}/tracking`);
  await page.getByRole("link", { name: "Документооборот" }).click();
  await page.waitForURL(`/deals/${dealId}/documents`);

  const rows = page.getByTestId("document-row");
  await expect(rows).toHaveCount(2);
  const rowCount = await rows.count();
  for (let i = 0; i < rowCount; i++) {
    const row = rows.nth(i);
    await row.getByRole("button", { name: /Отправить на проверку/ }).click();
    await expect(row.getByTestId("document-status")).not.toHaveText("Не загружен");
  }

  return dealId;
}
