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
// безопасно работать: адрес service-auth (маршруты /api/auth/*), список
// разрешённых Origin (без него checkOrigin не сможет решить, что пропускать,
// и cookie-сессия будет незащищённой), а также адреса service-core и
// service-commission — с Task 3 их читают реальные маршруты /api/deals/*,
// /api/notifications/*.
//
// CORE_URL/COMMISSION_URL раньше были необязательны и по умолчанию пустые —
// это было безопасно, пока маршруты, которые их используют, были 501-заглушкой
// из задачи 1. Теперь пустая строка вместо адреса привела бы к тому, что
// fetch() внутри callUpstream бросает TypeError на невалидном относительном
// URL — эта ошибка неотличима на выходе от "upstream недоступен" (обе
// схлопываются в 503 UPSTREAM_UNAVAILABLE), и отсутствие переменной окружения
// обнаружилось бы только при первом реальном запросе, а не при старте
// процесса. requireEnv здесь превращает это в понятную ошибку сразу при
// запуске, а не в неотличимый от сетевого сбоя 503 на первый живой запрос.
//
// REDIS_URL прошёл по такому же пути в задаче 4: раньше был необязательным и
// по умолчанию пустой строкой, потому что WS-хаб был мок-заглушкой и Redis не
// трогал. Теперь initWebSocketHub() поднимает по нему ioredis-подписчика —
// пустая строка привела бы либо к падению уже во время старта сервера в
// неудобном месте, либо (в зависимости от того, как ioredis трактует пустую
// строку) к тихой попытке подключиться к localhost:6379, что для сервиса,
// который обязан доставлять события сделок, хуже честного отказа при старте.
export function loadConfig(): Config {
  const authUrl = requireEnv("AUTH_URL");
  const coreUrl = requireEnv("CORE_URL");
  const commissionUrl = requireEnv("COMMISSION_URL");
  const redisUrl = requireEnv("REDIS_URL");
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
    coreUrl,
    commissionUrl,
    redisUrl,
    cookieSecure: process.env.COOKIE_SECURE === "true",
    allowedOrigins,
    upstreamTimeoutMs: Number(process.env.UPSTREAM_TIMEOUT_MS) || 5000,
  };
}
