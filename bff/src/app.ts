import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import type { Config } from "./config.js";
import { installErrorHandler } from "./errors.js";
import { checkOrigin } from "./session.js";
import { authRouter } from "./routes/auth.js";
import { dealsRouter } from "./routes/deals.js";
import { notificationsRouter } from "./routes/notifications.js";
import { pushRouter } from "./routes/push.js";
import { resolveRequestId, runWithRequestId } from "./requestContext.js";
import { getReadiness } from "./health.js";



export function createApp(config: Config): express.Express {
  const app = express();
  
  
  
  app.set("config", config);

  app.use(
    cors({
      
      
      origin: config.allowedOrigins,
      credentials: true,
    }),
  );
  app.use(cookieParser());
  app.use(express.json());
  app.use(checkOrigin);

  
  
  
  
  
  
  app.use((req, res, next) => {
    const requestId = resolveRequestId(req.header("x-request-id"));
    res.setHeader("X-Request-Id", requestId);
    runWithRequestId(requestId, next);
  });

  
  
  
  
  
  
  
  app.get("/health", (_req, res) => res.json({ ok: true }));

  
  
  
  
  app.get("/ready", async (req, res, next) => {
    try {
      const config = req.app.get("config") as Config;
      const body = await getReadiness(config);
      res.status(body.ok ? 200 : 503).json(body);
    } catch (err) {
      next(err);
    }
  });

  app.use("/api", authRouter);
  app.use("/api", dealsRouter);
  app.use("/api", notificationsRouter);
  app.use("/api", pushRouter);

  installErrorHandler(app);

  return app;
}
