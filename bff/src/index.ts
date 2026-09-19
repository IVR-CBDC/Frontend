import { createServer } from "node:http";
import { loadConfig } from "./config.js";
import { createApp } from "./app.js";
import { createProductionWsHubDeps, initWebSocketHub, closeWebSocketHub } from "./ws/hub.js";

const config = loadConfig();
const server = createServer(createApp(config));

// Ключ auth нужен до апгрейдов WS — иначе первые клиенты не смогут пройти
// проверку токена. initWebSocketHub() дожидается подтверждённой Redis-
// подписки (не только вызова psubscribe) прежде чем вернуть управление —
// поэтому ждём её здесь же, до server.listen(): так HTTP-порт открывается
// только когда подписка на deal-events:* уже реально подтверждена сервером
// Redis, и окна, в которое опубликованные события терялись бы, нет.
//
// Оба шага ограничены по времени (см. hub.ts: connectTimeout/retryStrategy
// боевого Redis-клиента и DEFAULT_SUBSCRIBE_TIMEOUT_MS в initWebSocketHub),
// поэтому недоступный auth или Redis не подвешивает процесс без диагностики —
// он падает здесь с понятным сообщением, а не зависает молча.
const wsHubDeps = await createProductionWsHubDeps(config);
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

// Graceful shutdown: закрываем Redis-подписку и сокеты, чтобы контейнер не
// убивался SIGKILL-ом до того, как процесс успел освободить соединения.
process.on("SIGTERM", () => {
  void (async () => {
    await closeWebSocketHub();
    server.close(() => process.exit(0));
  })();
});
