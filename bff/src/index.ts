import { createServer } from "node:http";
import { loadConfig } from "./config.js";
import { createApp } from "./app.js";
import { initWebSocketHub } from "./ws/hub.js";

const config = loadConfig();
const server = createServer(createApp(config));
initWebSocketHub(server);

server.listen(config.port, () => {
  console.log(`Alfa CBDC Hub BFF listening on http://localhost:${config.port}`);
  console.log(`WebSocket endpoint: ws://localhost:${config.port}/ws`);
});
