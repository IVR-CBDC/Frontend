import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import type { Config } from "./config.js";
import { installErrorHandler } from "./errors.js";
import { checkOrigin } from "./session.js";
import { authRouter } from "./routes/auth.js";
import { dealsRouter } from "./routes/deals.js";

// Сборка express-приложения вынесена отдельно от index.ts, чтобы тесты могли
// поднимать приложение без сокета и открытого порта (см. tests/*.test.ts).
export function createApp(config: Config): express.Express {
  const app = express();
  // Config кладём в settings приложения, а не в замыкание — так к нему можно
  // достучаться из middleware/роутов через req.app.get("config") без лишнего
  // прокидывания параметра через каждую сигнатуру.
  app.set("config", config);

  app.use(
    cors({
      // Сужено до allowedOrigins (а не "*"): с credentials:true браузер
      // требует конкретный Origin, иначе cookie сессии не уедет с запросом.
      origin: config.allowedOrigins,
      credentials: true,
    }),
  );
  app.use(cookieParser());
  app.use(express.json());
  app.use(checkOrigin);

  app.get("/health", (_req, res) => res.json({ status: "ok" }));
  app.use("/api", authRouter);
  app.use("/api", dealsRouter);

  installErrorHandler(app);

  return app;
}
