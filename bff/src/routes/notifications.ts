import { Router, type Request } from "express";
import type { Config } from "../config.js";
import { readToken, requireSession } from "../session.js";
import * as coreUpstream from "../upstream/core.js";
import type { CoreNotification } from "../upstream/core.js";
import type { NotificationItem } from "../types.js";

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

notificationsRouter.use(requireSession);

notificationsRouter.get("/notifications", async (req, res, next) => {
  try {
    const config = getConfig(req);
    const token = readToken(req) as string;
    const limit = req.query.limit !== undefined ? Number(req.query.limit) : undefined;
    const { items, unread } = await coreUpstream.listNotifications(config, token, limit);
    res.json({ notifications: items.map(toNotificationItem), unread });
  } catch (err) {
    next(err);
  }
});

notificationsRouter.post("/notifications/:id/read", async (req, res, next) => {
  try {
    const config = getConfig(req);
    const token = readToken(req) as string;
    await coreUpstream.markNotificationRead(config, token, req.params.id);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});
