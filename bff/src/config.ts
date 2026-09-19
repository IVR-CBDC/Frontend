// Конфигурация BFF, разобранная из переменных окружения.
export interface Config {
  port: number;
  authUrl: string;
  coreUrl: string;
  commissionUrl: string;
  redisUrl: string;
  cookieSecure: boolean;
  allowedOrigins: string[];
  upstreamTimeoutMs: number;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Не задана обязательная переменная окружения ${name}`);
  }
  return value;
}

// Разбирает переменные окружения в конфиг BFF и падает с понятным сообщением
// при старте, если не заданы переменные, без которых сервис не может
// безопасно работать: адрес service-auth (нужен уже в этой задаче — маршруты
// /api/auth/*) и список разрешённых Origin (без него checkOrigin не сможет
// решить, что пропускать, и cookie-сессия будет незащищённой).
//
// CORE_URL/COMMISSION_URL/REDIS_URL пока не используются ни одним
// реализованным маршрутом (deals — заглушка 501 из задачи 1, реальные
// маршруты появятся в задачах 3/5 этого плана), поэтому необязательны и по
// умолчанию пустые строки — сервис не должен падать при старте без них.
export function loadConfig(): Config {
  const authUrl = requireEnv("AUTH_URL");
  const allowedOrigins = requireEnv("ALLOWED_ORIGINS")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (allowedOrigins.length === 0) {
    throw new Error("ALLOWED_ORIGINS задан, но не содержит ни одного значения");
  }

  return {
    port: Number(process.env.PORT) || 4000,
    authUrl,
    coreUrl: process.env.CORE_URL ?? "",
    commissionUrl: process.env.COMMISSION_URL ?? "",
    redisUrl: process.env.REDIS_URL ?? "",
    cookieSecure: process.env.COOKIE_SECURE === "true",
    allowedOrigins,
    upstreamTimeoutMs: Number(process.env.UPSTREAM_TIMEOUT_MS) || 5000,
  };
}
