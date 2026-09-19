import type { Config } from "../../src/config.js";

// Небольшой хелпер для тестов: собирает валидный Config без обращения к
// переменным окружения, чтобы тесты не зависели от порядка выполнения друг
// друга и могли свободно переопределять отдельные поля (например
// cookieSecure). Не входит в список файлов задачи из брифа, но избавляет
// три тестовых файла от дублирования одного и того же объекта-заглушки.
export function testConfig(overrides: Partial<Config> = {}): Config {
  return {
    port: 4000,
    authUrl: "http://auth.test",
    coreUrl: "",
    commissionUrl: "",
    redisUrl: "",
    cookieSecure: false,
    allowedOrigins: ["http://localhost:5173"],
    upstreamTimeoutMs: 1000,
    ...overrides,
  };
}
