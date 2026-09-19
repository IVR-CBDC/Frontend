import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import type { Config } from "./config.js";
import { installErrorHandler } from "./errors.js";
import { checkOrigin } from "./session.js";
import { authRouter } from "./routes/auth.js";
import { dealsRouter } from "./routes/deals.js";
import { notificationsRouter } from "./routes/notifications.js";
import { resolveRequestId, runWithRequestId } from "./requestContext.js";
import { getReadiness } from "./health.js";

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

  // F7 (final review): спека §6 — x-request-id должен доехать до service-
  // core/auth/commission. Принимаем чужой (SPA может прислать свой, чтобы
  // проследить цепочку end-to-end) или генерируем новый как можно раньше
  // (до всех маршрутов), кладём в AsyncLocalStorage (см. requestContext.ts —
  // callUpstream читает его оттуда) и возвращаем клиенту тем же заголовком,
  // чтобы он тоже мог им воспользоваться.
  app.use((req, res, next) => {
    const requestId = resolveRequestId(req.header("x-request-id"));
    res.setHeader("X-Request-Id", requestId);
    runWithRequestId(requestId, next);
  });

  // F10 (final review): раньше /health отвечал {status:"ok"} безусловно и
  // считался и живостью, и (в docker-compose healthcheck) готовностью —
  // честно только на словах, спека §9 прямо требует, чтобы bff проверял
  // Redis. Теперь /health — только живость процесса: без сети, без await,
  // не может зависнуть или зафлапать здоровье контейнера из-за медленного
  // апстрима. Форма ответа ({ok, ...}) — как у остальных сервисов стенда
  // (auth/core), которые тоже грепает их compose-healthcheck.
  app.get("/health", (_req, res) => res.json({ ok: true }));

  // /ready — настоящая готовность: Redis-подписка В МОМЕНТЕ (см.
  // isRedisSubscriberReady, F10) плюс достижимость auth/core/commission,
  // с коротким TTL-кешем (health.ts) — это то, что должен проверять
  // healthcheck compose/readinessProbe k3s (план 08), не /health.
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

  installErrorHandler(app);

  return app;
}
