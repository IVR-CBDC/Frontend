import { Router, type Request } from "express";
import { z } from "zod";
import { decodeJwt } from "jose";
import { requireSession, readToken } from "../session.js";
import { ApiError } from "../errors.js";
import type { Config } from "../config.js";
import * as coreUpstream from "../upstream/core.js";
import { getVapidPublicKey, removePushSubscription, savePushSubscription } from "../services/push.js";

const subscriptionSchema = z.object({
  endpoint: z.string().url().refine((value) => new URL(value).protocol === "https:"),
  expirationTime: z.number().nullable().optional(),
  keys: z.object({ p256dh: z.string().min(40), auth: z.string().min(16) }),
});

async function companyId(req: Request): Promise<string> {
  const token = readToken(req);
  if (!token) throw new ApiError(401, "UNAUTHORIZED", "Требуется авторизация");
  const config = req.app.get("config") as Config;
  await coreUpstream.listDeals(config, token, 1);
  const claims = decodeJwt(token);
  if (typeof claims.company_id !== "string") throw new ApiError(403, "FORBIDDEN", "Не удалось определить компанию пользователя");
  return claims.company_id;
}

export const pushRouter = Router();

pushRouter.get("/push/public-key", requireSession, (_req, res) => {
  const publicKey = getVapidPublicKey();
  if (!publicKey) {
    res.status(503).json({ code: "PUSH_NOT_CONFIGURED", error: "Push-уведомления пока не настроены на сервере" });
    return;
  }
  res.json({ publicKey });
});

pushRouter.post("/push/subscriptions", requireSession, async (req, res, next) => {
  try {
    const subscription = subscriptionSchema.parse(req.body);
    await savePushSubscription(await companyId(req), {
      endpoint: subscription.endpoint,
      expirationTime: subscription.expirationTime ?? null,
      keys: subscription.keys,
    });
    res.status(201).json({ ok: true });
  } catch (error) {
    next(error);
  }
});

pushRouter.delete("/push/subscriptions", requireSession, async (req, res, next) => {
  try {
    const endpoint = z.string().url().refine((value) => new URL(value).protocol === "https:").parse(req.body?.endpoint);
    await removePushSubscription(await companyId(req), endpoint);
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});
