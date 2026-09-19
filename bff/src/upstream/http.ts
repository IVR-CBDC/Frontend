import { ApiError, upstreamUnavailable } from "../errors.js";

interface UpstreamErrorBody {
  code?: unknown;
  error?: unknown;
}

// Единая точка вызова HTTP-сервисов бэкенда (service-auth/service-core/...).
// Таймаут и сетевые ошибки превращаются в 503 UPSTREAM_UNAVAILABLE — фронту
// не нужны детали связности BFF с internal-сетью бэкенда.
export async function callUpstream<T>(url: string, init: RequestInit, timeoutMs: number): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetch(url, { ...init, signal: controller.signal });
  } catch {
    // Abort по таймауту или сетевая ошибка (сервис не поднят/недоступен) —
    // для фронта оба случая неотличимы от "сервис недоступен".
    throw upstreamUnavailable();
  } finally {
    clearTimeout(timer);
  }

  if (response.ok) {
    return (await response.json()) as T;
  }

  // 5xx от upstream — это сам upstream-сервис "лёг" (или недоступен позади
  // прокси), а не осмысленная бизнес-ошибка, которую стоит пересказывать
  // фронту как есть.
  if (response.status >= 500) {
    throw upstreamUnavailable();
  }

  const body = (await response.json().catch(() => null)) as UpstreamErrorBody | null;
  if (body && typeof body.code === "string" && typeof body.error === "string") {
    throw new ApiError(response.status, body.code, body.error);
  }

  // Ответ upstream не соответствует контракту {code, error} — трактуем как
  // недоступность, а не пытаемся угадать смысл произвольного тела.
  throw upstreamUnavailable();
}
