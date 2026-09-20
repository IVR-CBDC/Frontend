// План 03 обнаружил, что путь восстановления сделки после отклонённого
// документа был недостижим: вердикт эмулятора зависел только от (deal_id,
// kind), поэтому переподанный документ отклонялся снова и снова — вечно.
// Теперь вердикт эмулятора зависит ещё и от номера попытки (см.
// service-core/include/emulator.h documentApproved): на первой попытке
// (attempt == 0) документ отклоняется примерно в 10% случаев (детерминировано
// по fnv1a(deal_id, kind)), а начиная со второй попытки (attempt >= 1) —
// одобряется всегда. Это и есть путь восстановления, который тест обязан
// закрепить.
//
// Какой из документов конкретной сделки отклонят на первой попытке —
// предсказать из теста нельзя, не воспроизводя ту же fnv1a-хеш-функцию,
// которую использует эмулятор. Именно так ошибся план 03 (и ревью справедливо
// назвало это дублированием продакшн-логики в тесте: если завтра поменяется
// соль хеша или порог 10%, тест сломался бы не там, где сломалась бы
// реальная система). Поэтому вместо предсказания тест создаёт сделки в
// цикле (до 40 попыток — см. точный расчёт вероятности у MAX_ATTEMPTS) и
// использует первую же сделку, на которой эмулятор действительно отклонил
// хотя бы один документ на первой проверке. Если за 40 попыток отказа не
// случилось — тест падает с объясняющим сообщением: это сигнал, что
// вероятность отказа в эмуляторе изменилась, а не что тест сломан.

import type { Locator, Page } from "@playwright/test";
import { expect, test, waitForDocumentApproved } from "./fixtures/stand";

// Этот тест — единственный в наборе, который намеренно гоняет много
// реальных HTTP-вызовов (tick() дёргается в expect.poll на каждой из
// MAX_ATTEMPTS сделок, а не один-два раза, как в остальных спеках). При
// невезении (несколько неудачных попыток подряд) счётчик вызовов уходит в
// сотни, и на такой длине Playwright может упасть при финализации trace/video
// артефактов: `ENOENT ... traces/...` в teardown на этой машине. Это известная
// проблема окружения (наблюдается и на happy-path.spec.ts), не специфичная для
// этого тестового файла. Для локальных запусков используй `--trace=off` в
// командной строке, а не отключай сборку артефактов в коде, чтобы сохранить
// полную диагностику в CI при реальной регрессии.

const COUNTERPARTY_NAME = "Recovery Test Trading Co.";
const DEAL_AMOUNT = "30000";
const DEAL_CURRENCY = "USD";
// 10% отказа на документ, 2 документа на сделку -> вероятность "сделка
// без единого отказа" = 0.9^2 = 0.81. С 10 попытками P(ни разу не повезло)
// = 0.81^10 ≈ 12% — на практике это ложные падения теста (см. лог рана
// контроллера). С 40 попытками 0.81^40 ≈ 0.02%, что уже пренебрежимо
// мало. Цикл готовит данные через API/UI-мастер, а не гоняет эмулятор
// впустую, поэтому лишние сделки почти ничего не стоят по времени.
const MAX_ATTEMPTS = 40;

test.describe("Восстановление сделки после отклонённого документа", () => {
  test("переподанный документ одобряется, сделка доходит до completed", async ({ page, tick }) => {
    // До 40 сделок подряд, и на каждую — реальное настенное ожидание двух
    // задержек эмулятора (uploaded -> under_review -> approved/rejected,
    // по doc_review_sec каждая, см. ниже), которое нельзя обойти без
    // waitForTimeout/угадывания хеша. Поэтому этому тесту одному нужен
    // больший бюджет, чем дефолтные 120с из playwright.config.ts.
    //
    // F3 (final fix wave): 300_000 было мало — каждая попытка стоит ~13-16с
    // (две задержки по 5с + клики мастера), 40 попыток * 16с ≈ 640с. При
    // бюджете 300с цикл успевал сделать только ~20 из 40 попыток, поэтому
    // собственное диагностическое сообщение цикла ("за 40 сделок ни один
    // документ не был отклонён...", см. ниже) было недостижимо — тест умирал
    // по таймауту Playwright ("Test timeout of 300000ms exceeded") без этой
    // подсказки в ~1.4% прогонов (12% честных падений сообщением превратились
    // в ~1.5% немых таймаутов). Поднимаем бюджет выше 40 * 16s ≈ 640s с
    // запасом, чтобы цикл гарантированно успевал дойти до своего собственного
    // throw. Корневая причина (реальные секунды ожидания вместо
    // детерминированного advance_sec) — план 08, см. F4.
    test.setTimeout(720_000);

    let rejectedRow: Locator | null = null;
    let dealId: string | null = null;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS && !rejectedRow; attempt++) {
      dealId = await createDealThroughDocuments(page);

      // submitDocument ставит next_action_at на doc_review_sec вперёд (5с в
      // EMULATOR_SPEED=demo, см. service-core/src/emulator.cc: uploaded ->
      // under_review -> approved/rejected — две отдельные задержки), тик
      // сразу после отправки ничего не продвигает, пока не пройдёт реальное
      // время. Оба документа сделки идут по этим стадиям НЕЗАВИСИМО и
      // необязательно синхронно, поэтому ждать нужно не "оба сразу
      // финальны", а первое из двух событий: либо какой-то документ уже
      // "Отклонён" (эта сделка годится, ждать второй не нужно), либо оба
      // "Подтверждён" (не повезло — вердикт по обоим уже вынесен, отказа не
      // было).
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
        // Эта сделка не годится — оба документа одобрены с первой попытки.
        // Возвращаемся на дашборд и пробуем следующую сделку.
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
