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
  retries: 0,
  timeout: 120_000,
  expect: {
    timeout: 15_000,
  },
  reporter: [["list"], ["html", { open: "never" }]],
  // Стенд живёт в Backend-репозитории и поднимается снаружи — намеренно
  // без webServer. globalSetup только проверяет доступность и падает с
  // понятным сообщением, если стенд не поднят.
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
