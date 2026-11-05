import { defineConfig, devices } from "@playwright/test";

const SPA_URL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:8090";

export default defineConfig({
  testDir: ".",
  testMatch: "**/*.spec.ts",
  
  
  
  fullyParallel: false,
  workers: 1,
  
  
  
  
  
  
  retries: process.env.CI ? 1 : 0,
  timeout: 120_000,
  expect: {
    timeout: 15_000,
  },
  reporter: [["list"], ["html", { open: "never" }]],
  
  
  
  
  
  
  
  
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
