












import { expect, test } from "./fixtures/stand";

test.describe("Истечение сессии", () => {
  test("после истечения cookie приложение переходит на /login и позволяет войти снова", async ({
    page,
    company,
  }) => {
    
    await expect(page.locator("[data-app-status]")).toHaveAttribute("data-app-status", "authenticated");
    await expect(page.getByText("Активных сделок пока нет.")).toBeVisible();

    
    
    
    await page.context().clearCookies();

    
    
    
    
    
    await page.getByRole("link", { name: "+ Новая сделка" }).click();
    await page.waitForURL(/\/deals\/new$/);
    await page.getByRole("link", { name: "Дашборд" }).click();

    
    
    
    
    await expect(page).toHaveURL(/\/login$/);

    
    
    
    
    await expect(page.getByRole("heading", { name: "Вход" })).toBeVisible();

    await page.getByLabel("Логин").fill(company.login);
    await page.getByLabel("Пароль").fill(company.password);
    await page.getByRole("button", { name: "Войти" }).click();

    
    
    await expect(page).toHaveURL("/");
    await expect(page.locator("[data-app-status]")).toHaveAttribute("data-app-status", "authenticated");
    await expect(page.getByText("Активных сделок пока нет.")).toBeVisible();
  });

  
  
  
  
  
  
  
  test("вход с неверным паролем показывает ошибку и не пускает в приложение", async ({ page, company }) => {
    await page.context().clearCookies();
    await page.goto("/login");
    await expect(page.getByRole("heading", { name: "Вход" })).toBeVisible();

    await page.getByLabel("Логин").fill(company.login);
    await page.getByLabel("Пароль").fill("wrong-password-definitely-not-it");
    await page.getByRole("button", { name: "Войти" }).click();

    await expect(page.getByRole("alert")).toBeVisible();
    await expect(page).toHaveURL(/\/login$/);

    
    await page.getByLabel("Пароль").fill(company.password);
    await page.getByRole("button", { name: "Войти" }).click();
    await expect(page).toHaveURL("/");
    await expect(page.locator("[data-app-status]")).toHaveAttribute("data-app-status", "authenticated");
  });
});
