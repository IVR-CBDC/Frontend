import { createServer } from "node:http";
import { loadConfig } from "./config.js";
import { createApp } from "./app.js";
import { createProductionWsHubDeps, initWebSocketHub, closeWebSocketHub } from "./ws/hub.js";

const config = loadConfig();
const server = createServer(createApp(config));

// Ключ auth и подписка на Redis нужны до того, как хаб начнёт принимать
// апгрейды — иначе первые клиенты либо не смогут пройти проверку токена,
// либо пропустят события, опубликованные до того, как psubscribe встал.
const wsHubDeps = await createProductionWsHubDeps(config);
initWebSocketHub(server, wsHubDeps);

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
