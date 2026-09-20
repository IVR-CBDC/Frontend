// globalSetup для Playwright: стенд живёт в Backend-репозитории и
// управляется снаружи (см. implementer-rules.md плана 07) — этот файл
// НЕ поднимает SPA/BFF через webServer, а лишь проверяет, что они уже
// отвечают, и падает с понятным сообщением вместо непонятного таймаута
// первого теста, если стенд не поднят.

const SPA_URL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:8090";
const BFF_URL = process.env.E2E_BFF_URL ?? "http://127.0.0.1:14000";

async function checkReachable(url: string, label: string): Promise<void> {
  try {
    // Любой HTTP-ответ (даже 404/500) значит, что процесс поднят и слушает
    // порт — падать нужно только когда соединение вообще не устанавливается
    // (ECONNREFUSED и подобное).
    await fetch(url);
  } catch (e) {
    const cause = e instanceof Error ? e.message : String(e);
    throw new Error(
      `${label} недоступен по ${url} (${cause}).\n` +
        "Подними стенд перед запуском e2e (из /home/legors/Documents/IVR):\n" +
        "  EMULATOR_MANUAL=true docker compose -f docker-compose.yml -f docker-compose.dev.yml " +
        "--profile bff --profile frontend up -d --wait\n" +
        "Если стенд уже поднят, но с EMULATOR_MANUAL=false, пересоздай только service-core:\n" +
        "  EMULATOR_MANUAL=true docker compose -f docker-compose.yml -f docker-compose.dev.yml " +
        "up -d --wait service-core",
    );
  }
}

export default async function globalSetup(): Promise<void> {
  await checkReachable(SPA_URL, "SPA");
  await checkReachable(`${BFF_URL}/health`, "BFF");
}
