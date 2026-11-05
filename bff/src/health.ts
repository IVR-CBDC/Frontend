import type { Config } from "./config.js";
import { isRedisSubscriberReady } from "./ws/hub.js";














const READY_CACHE_TTL_MS = 2_000;





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
