import type { Config } from "../../src/config.js";






export function testConfig(overrides: Partial<Config> = {}): Config {
  return {
    port: 4000,
    authUrl: "http://auth.test",
    coreUrl: "http://core.test",
    commissionUrl: "http://commission.test",
    redisUrl: "redis://redis.test:6379",
    cookieSecure: false,
    allowedOrigins: ["http://localhost:5173"],
    upstreamTimeoutMs: 1000,
    ...overrides,
  };
}
