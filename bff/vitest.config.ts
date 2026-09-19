import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // globals выключены намеренно: describe/it/expect импортируются явно,
    // чтобы не тянуть неявный глобальный API vitest в прикладной код.
    globals: false,
    include: ["tests/**/*.test.ts"],
  },
});
