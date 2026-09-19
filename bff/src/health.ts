import type { Config } from "./config.js";
import { isRedisSubscriberReady } from "./ws/hub.js";

// F10 (final review): спека §9 требует, чтобы bff проверял Redis — раньше
// /health всегда отвечал {status:"ok"} без единой сетевой проверки, что было
// честно только на словах (docker-compose healthcheck грепал именно этот
// эндпоинт). Разделяем: /health — живость процесса (дёшево, без сети, см.
// app.ts), /ready — настоящая готовность ниже.
//
// TTL кеша: healthcheck дергает /ready каждые 5с (docker-compose.yml,
// Backend-репозиторий) — без кеша это три сетевых запроса к auth/core/
// commission НА КАЖДЫЙ тик healthcheck, а на кратковременном блипе одного
// апстрима готовность будет флапать туда-сюда на каждый следующий тик, пока
// блип не пройдёт. 2 секунды — заметно меньше интервала healthcheck (следующий
// реальный тик всё равно переспросит свежее состояние), но гасит и лишний
// сетевой трафик, и флап на одиночный кратковременный сбой.
const READY_CACHE_TTL_MS = 2_000;

// Таймаут одной проверки апстрима — короче upstreamTimeoutMs обычных запросов
// (это не полноценный запрос, а probe: нам не нужен ответ с телом, только
// факт доступности), чтобы недоступный апстрим не задерживал /ready дольше,
// чем разумно для healthcheck с timeout: 3s в compose.
const PROBE_TIMEOUT_MS = 2_000;

export interface ReadyBody {
  ok: boolean;
  redis: boolean;
  auth: boolean;
  core: boolean;
  commission: boolean;
}

let cached: { result: ReadyBody; expiresAt: number } | null = null;
let inFlight: Promise<ReadyBody> | null = null;

async function probe(url: string): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function computeReadiness(config: Config): Promise<ReadyBody> {
  // Redis — синхронная проверка состояния уже установленного подписчика
  // (см. ws/hub.ts), а не отдельный сетевой запрос: сам факт живой
  // psubscribe-подписки важнее пинга Redis, который ничего не говорит о том,
  // доставляет ли хаб события прямо сейчас.
  const redis = isRedisSubscriberReady();
  const [auth, core, commission] = await Promise.all([
    probe(`${config.authUrl}/health`),
    probe(`${config.coreUrl}/health`),
    probe(`${config.commissionUrl}/health`),
  ]);
  return { ok: redis && auth && core && commission, redis, auth, core, commission };
}

// Возвращает готовность, кешируя результат на READY_CACHE_TTL_MS. Дедуплицирует
// параллельные вызовы (например, несколько одновременных запросов /ready,
// пока предыдущий расчёт ещё не завершился) в один расчёт, а не по одному
// пробнику апстримов на каждый параллельный вызов.
export async function getReadiness(config: Config): Promise<ReadyBody> {
  const now = Date.now();
  if (cached && cached.expiresAt > now) {
    return cached.result;
  }
  if (inFlight) {
    return inFlight;
  }

  inFlight = computeReadiness(config)
    .then((result) => {
      cached = { result, expiresAt: Date.now() + READY_CACHE_TTL_MS };
      return result;
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

// Только для тестов — иначе результат одного теста кешировался бы и был бы
// виден следующему.
export function _resetReadinessCacheForTests(): void {
  cached = null;
  inFlight = null;
}
