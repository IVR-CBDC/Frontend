import express from "express";
import cors from "cors";
import { createServer } from "node:http";
import { dealsRouter } from "./routes/deals.js";
import { initWebSocketHub } from "./ws/hub.js";

const app = express();
app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => res.json({ status: "ok" }));
app.use("/api", dealsRouter);

// Fallback error handler so the BFF always returns JSON, never an HTML stack trace.
app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ error: "Внутренняя ошибка сервиса" });
});

const PORT = Number(process.env.PORT) || 4000;
const server = createServer(app);
initWebSocketHub(server);

server.listen(PORT, () => {
  console.log(`Alfa CBDC Hub BFF listening on http://localhost:${PORT}`);
  console.log(`WebSocket endpoint: ws://localhost:${PORT}/ws`);
});
