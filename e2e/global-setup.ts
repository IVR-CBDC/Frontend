
























const SPA_URL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:8090";



const BFF_URL = process.env.E2E_BFF_URL ?? SPA_URL;




const CORE_URL = process.env.E2E_CORE_URL ?? "http://127.0.0.1:18081";

const STAND_HINT =
  "Подними стенд перед запуском e2e (из Backend-репозитория, /home/legors/Documents/IVR):\n" +
  "  make e2e-stand-up\n";

async function get(url: string, label: string): Promise<Response> {
  try {
    return await fetch(url);
  } catch (e) {
    const cause = e instanceof Error ? e.message : String(e);
    throw new Error(`${label} недоступен по ${url} (${cause}).\n${STAND_HINT}`);
  }
}

// SPA: любой HTTP-ответ значит, что nginx поднят и слушает порт.
async function checkSpa(): Promise<void> {
  await get(SPA_URL, "SPA");
}

// BFF — через тот же адрес, то есть через прокси nginx. Проверяем не
// «что-нибудь ответило», а что ответил именно BFF: `/api/auth/me` без
// cookie обязан дать 401. Если прокси не настроен (или адрес указывает не
// на SPA), nginx отдаст 200 с index.html по SPA-fallback — молчаливый
// зелёный, после которого тесты падали бы дальше и непонятно.
async function checkBffThroughSpa(): Promise<void> {
  const url = `${BFF_URL}/api/auth/me`;
  const res = await get(url, "BFF (через /api фронта)");
  if (res.status === 401) return;

  const body = (await res.text()).slice(0, 200);
  throw new Error(
    `BFF за ${url} ответил ${res.status}, ожидался 401 (запрос без сессии).\n` +
      (res.status === 200
        ? "200 здесь обычно значит, что /api не проксируется на BFF и nginx отдал index.html " +
          "по SPA-fallback: проверь, что E2E_BASE_URL указывает на образ SPA, а не на dev-сервер Vite " +
          "без прокси.\n"
        : "") +
      `Тело ответа: ${body}\n${STAND_HINT}`,
  );
}

// Режим эмулятора. Проверяется ДО тестов, потому что при неверном режиме
// падение произойдёт всё равно — просто позже и с бесполезным сообщением.
async function checkEmulatorManual(): Promise<void> {
  const url = `${CORE_URL}/health`;
  const res = await get(url, "service-core");
  let health: Record<string, unknown>;
  try {
    health = (await res.json()) as Record<string, unknown>;
  } catch {
    throw new Error(`${url} ответил ${res.status}, но не JSON — это не /health service-core.\n${STAND_HINT}`);
  }

  const manual = health.emulator_manual;
  if (manual === true) return;

  if (manual === undefined) {
    throw new Error(
      `${url} не отдаёт поле emulator_manual — образ service-core старше плана 08 (Task 4).\n` +
        "Режим эмулятора проверить нечем: пересобери стенд из актуального Backend\n" +
        `(make e2e-stand-up), либо запусти с E2E_SKIP_EMULATOR_CHECK=1, понимая, что\n` +
        "неверный режим проявится как 404 на /internal/emulator/tick посреди прогона.\n",
    );
  }

  throw new Error(
    `service-core поднят в АВТОМАТИЧЕСКОМ режиме эмулятора (emulator_manual=${String(manual)}).\n` +
      "e2e требуют ручного: они сами двигают время через POST /internal/emulator/tick,\n" +
      "а в автоматическом режиме этой ручки не существует (404) и сделки двигаются сами,\n" +
      "то есть прогон перестаёт быть детерминированным.\n" +
      "Чинить (из Backend-репозитория): make e2e-stand-up — ручной режим там свойство\n" +
      "набора compose-файлов (docker-compose.e2e.yml), а не префикса команды.\n",
  );
}

export default async function globalSetup(): Promise<void> {
  await checkSpa();
  await checkBffThroughSpa();
  if (process.env.E2E_SKIP_EMULATOR_CHECK !== "1") await checkEmulatorManual();
}
