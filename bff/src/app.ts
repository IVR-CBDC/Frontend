import express from "express";
import cors from "cors";
import { dealsRouter } from "./routes/deals.js";

// Сборка express-приложения вынесена отдельно от index.ts, чтобы тесты могли
// поднимать приложение без сокета и открытого порта (см. tests/smoke.test.ts).
export function createApp(): express.Express {
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

  return app;
}
