import { createServer } from "node:http";
import { loadConfig } from "./config.js";
import { createApp } from "./app.js";
import { createProductionWsHubDeps, initWebSocketHub, closeWebSocketHub } from "./ws/hub.js";

const config = loadConfig();
const server = createServer(createApp(config));

















let wsHubDeps;
try {
  wsHubDeps = await createProductionWsHubDeps(config);
} catch (err) {
  console.error(
    `Не удалось подготовить окружение WebSocket-хаба (публичный ключ auth) — BFF не может проверять токены на апгрейде WebSocket и не запустится.`,
    err,
  );
  process.exit(1);
}

try {
  await initWebSocketHub(server, wsHubDeps);
} catch (err) {
  console.error(
    `Не удалось подписаться на Redis (REDIS_URL=${config.redisUrl}) — BFF не может доставлять живые события сделок и не запустится.`,
    err,
  );
  process.exit(1);
}

server.listen(config.port, () => {
  console.log(`Alfa CBDC Hub BFF listening on http://localhost:${config.port}`);
  console.log(`WebSocket endpoint: ws://localhost:${config.port}/ws`);
});

// F12 (final review): server.close() ждёт, пока отработают ВСЕ активные
// соединения, включая keep-alive HTTP, которые ничего не делают, но и не
// закрыты клиентом — без этого "graceful shutdown" мог просто никогда не
// вызвать колбэк, и SIGKILL по истечении grace period контейнера обрывал бы
// работу, а не давал процессу закончиться самому. closeIdleConnections()
// (Node 18.2+) обрывает именно такие простаивающие соединения сразу;
// SHUTDOWN_TIMEOUT_MS — финальная страховка на случай активных соединений,
// которые всё равно не закрываются вовремя (тот же приём, что и withTimeout
// в hub.ts для Redis-подписки).
const SHUTDOWN_TIMEOUT_MS = 10_000;

// Graceful shutdown: закрываем Redis-подписку и сокеты, чтобы контейнер не
// убивался SIGKILL-ом до того, как процесс успел освободить соединения.
process.on("SIGTERM", () => {
  void (async () => {
    await closeWebSocketHub();

    const forceExit = setTimeout(() => {
      console.error(
        `server.close() не завершился за ${SHUTDOWN_TIMEOUT_MS} мс — принудительный выход`,
      );
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
    forceExit.unref();

    server.close(() => {
      clearTimeout(forceExit);
      process.exit(0);
    });
    server.closeIdleConnections();
  })();
});
