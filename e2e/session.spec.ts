// Критический дефект из плана 06: когда cookie сессии истекала, приложение
// оставалось в состоянии "авторизован" (status в AuthProvider не менялся
// сам по себе — событие 401 никто не слушал так, чтобы отличить "сессия
// истекла" от "никогда не входил"), поэтому все экраны просто показывали
// ошибку запроса, а /login видел status === "authenticated" и тут же
// отбрасывал пользователя обратно — выйти было нельзя без жёсткой
// перезагрузки страницы.
//
// context.clearCookies() — ровно то же самое, что делает браузер сам, когда
// у cookie истекает maxAge (см. e2e/fixtures/stand.ts): сессионный cookie
// пропадает, а localStorage/состояние SPA — нет, это и воспроизводит баг
// один в один, без обращения к серверным настройкам TTL.

import { expect, test } from "./fixtures/stand";

test.describe("Истечение сессии", () => {
  test("после истечения cookie приложение переходит на /login и позволяет войти снова", async ({
    page,
    company,
  }) => {
    // Начинаем точно авторизованными на защищённом маршруте.
    await expect(page.locator("[data-app-status]")).toHaveAttribute("data-app-status", "authenticated");
    await expect(page.getByText("Активных сделок пока нет.")).toBeVisible();

    // Cookie исчезает так, как будто истёк её maxAge — состояние SPA (React,
    // localStorage) при этом не трогаем: баг был именно в том, что клиент
    // сам не замечал пропажи cookie, пока не сходит в сеть.
    await page.context().clearCookies();

    // Любое действие, которое требует запроса к BFF. Переход на другой
    // маршрут и обратно на дашборд перемонтирует DashboardPage и запускает
    // её обычный fetch при монтировании — без page.reload() и без
    // waitForTimeout, ровно так, как это увидел бы реальный пользователь,
    // кликающий по приложению после обеда.
    await page.getByRole("link", { name: "+ Новая сделка" }).click();
    await page.waitForURL(/\/deals\/new$/);
    await page.getByRole("link", { name: "Дашборд" }).click();

    // До фикса: экран просто показывал ошибку запроса, а приложение
    // оставалось в data-app-status="authenticated" навсегда. После фикса —
    // 401 на "authenticated" статусе переводит приложение в anonymous, и
    // RequireAuth уводит на /login.
    await expect(page).toHaveURL(/\/login$/);

    // И, что было ровно тем местом, где ломалось до фикса: LoginPage не
    // должен считать пользователя всё ещё authenticated и не должен
    // отбрасывать его обратно на защищённый маршрут — форма входа должна
    // быть видна и рабочей.
    await expect(page.getByRole("heading", { name: "Вход" })).toBeVisible();

    await page.getByLabel("Логин").fill(company.login);
    await page.getByLabel("Пароль").fill(company.password);
    await page.getByRole("button", { name: "Войти" }).click();

    // Логин тем же (валидным) аккаунтом снова заводит в приложение —
    // сессия истекла, а не сам аккаунт.
    await expect(page).toHaveURL("/");
    await expect(page.locator("[data-app-status]")).toHaveAttribute("data-app-status", "authenticated");
    await expect(page.getByText("Активных сделок пока нет.")).toBeVisible();
  });

  // F8 (final fix wave): спека §9 перечисляет "критерий готовности +
  // логин с неверным паролем" как содержимое e2e-набора — такого сценария
  // не было ни в одной спеке. Использует ту же company-фикстуру (реальный
  // логин), только пароль неверный — проверяет, что BFF/service-auth
  // отвечают ошибкой аутентификации, а не 500/пропуском на защищённый
  // маршрут, и что форма входа остаётся рабочей (можно тут же ввести
  // правильный пароль, без перезагрузки страницы).
  test("вход с неверным паролем показывает ошибку и не пускает в приложение", async ({ page, company }) => {
    await page.context().clearCookies();
    await page.goto("/login");
    await expect(page.getByRole("heading", { name: "Вход" })).toBeVisible();

    await page.getByLabel("Логин").fill(company.login);
    await page.getByLabel("Пароль").fill("wrong-password-definitely-not-it");
    await page.getByRole("button", { name: "Войти" }).click();

    await expect(page.getByRole("alert")).toBeVisible();
    await expect(page).toHaveURL(/\/login$/);

    // Форма не сломалась — с правильным паролем тот же экран пускает внутрь.
    await page.getByLabel("Пароль").fill(company.password);
    await page.getByRole("button", { name: "Войти" }).click();
    await expect(page).toHaveURL("/");
    await expect(page.locator("[data-app-status]")).toHaveAttribute("data-app-status", "authenticated");
  });
});
