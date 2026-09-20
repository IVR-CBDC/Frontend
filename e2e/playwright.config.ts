import { defineConfig, devices } from "@playwright/test";

const SPA_URL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:8090";

export default defineConfig({
  testDir: ".",
  testMatch: "**/*.spec.ts",
  // Стенд общий (одна БД, один эмулятор в ручном режиме) — параллельные
  // прогоны будут драться за POST /internal/emulator/tick и путать друг
  // друга своими tick'ами, поэтому один воркер и без fullyParallel.
  fullyParallel: false,
  workers: 1,
  // F3 (final fix wave): recovery.spec.ts гоняет реальное настенное время на
  // каждой из до 40 попыток — редкий, но не нулевой шанс, что CI-раннер
  // притормозит достаточно, чтобы даже поднятого test.setTimeout не хватило.
  // Один повторный прогон в CI отличает такую флуктуацию инфраструктуры от
  // настоящей регрессии; локально (retries: 0) красный тест остаётся
  // красным сразу — так и должно быть при разработке.
  retries: process.env.CI ? 1 : 0,
  timeout: 120_000,
  expect: {
    timeout: 15_000,
  },
  reporter: [["list"], ["html", { open: "never" }]],
  // Стенд живёт в Backend-репозитории и поднимается снаружи — намеренно
  // без webServer. globalSetup только проверяет стенд и падает с понятным
  // сообщением, если он не поднят или поднят не в том режиме.
  //
  // План 08 (Task 4): проверок там три — SPA отвечает, BFF отвечает ЧЕРЕЗ
  // тот же адрес (nginx проксирует /api), и service-core в ручном режиме
  // эмулятора (`emulator_manual` в его /health). Третья — лечение ловушки
  // плана 07: раньше неверный режим проявлялся как 404 посреди прогона.
  globalSetup: "./global-setup.ts",
  use: {
    baseURL: SPA_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
