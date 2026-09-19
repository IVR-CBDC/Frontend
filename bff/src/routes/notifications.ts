import { Router, type Request } from "express";
import type { Config } from "../config.js";
import { readToken, requireSession } from "../session.js";
import * as coreUpstream from "../upstream/core.js";
import type { CoreNotification } from "../upstream/core.js";
import type { NotificationItem } from "../types.js";
import { parseLimit } from "../validation.js";

function getConfig(req: Request): Config {
  return req.app.get("config") as Config;
}

function toNotificationItem(notification: CoreNotification): NotificationItem {
  return {
    id: notification.id,
    dealId: notification.deal_id,
    severity: notification.severity as NotificationItem["severity"],
    message: notification.message,
    createdAt: notification.created_at,
    read: notification.read,
  };
}

export const notificationsRouter = Router();

// F4 (final review): см. тот же комментарий в routes/deals.ts —
// requireSession навешивается на конкретные маршруты, а не на весь
// роутер через .use(), иначе он перехватывает и несуществующие /api/*
// пути раньше финального 404.

notificationsRouter.get("/notifications", requireSession, async (req, res, next) => {
  try {
    const config = getConfig(req);
    const token = readToken(req) as string;
    const limit = parseLimit(req.query.limit);
    const { items, unread } = await coreUpstream.listNotifications(config, token, limit);
    res.json({ notifications: items.map(toNotificationItem), unread });
  } catch (err) {
    next(err);
  }
});

notificationsRouter.post("/notifications/:id/read", requireSession, async (req, res, next) => {
  try {
    const config = getConfig(req);
    const token = readToken(req) as string;
    await coreUpstream.markNotificationRead(config, token, req.params.id);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});
