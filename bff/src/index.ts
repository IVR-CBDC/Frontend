import { createServer } from "node:http";
import { createApp } from "./app.js";
import { initWebSocketHub } from "./ws/hub.js";

const server = createServer(createApp());
initWebSocketHub(server);

const PORT = Number(process.env.PORT) || 4000;

server.listen(PORT, () => {
  console.log(`Alfa CBDC Hub BFF listening on http://localhost:${PORT}`);
  console.log(`WebSocket endpoint: ws://localhost:${PORT}/ws`);
});
