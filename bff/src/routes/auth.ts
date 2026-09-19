import { Router, type Request } from "express";
import type { Config } from "../config.js";
import { clearSession, readToken, requireSession, setSession } from "../session.js";
import * as authUpstream from "../upstream/auth.js";

function getConfig(req: Request): Config {
  return req.app.get("config") as Config;
}

export const authRouter = Router();

authRouter.post("/auth/register", async (req, res, next) => {
  try {
    const config = getConfig(req);
    const { token, ...body } = await authUpstream.register(config, req.body);
    setSession(res, token);
    // Токен наружу не отдаём — он живёт только в HttpOnly-cookie.
    res.json(body);
  } catch (err) {
    next(err);
  }
});

authRouter.post("/auth/login", async (req, res, next) => {
  try {
    const config = getConfig(req);
    const { token, ...body } = await authUpstream.login(config, req.body);
    setSession(res, token);
    res.json(body);
  } catch (err) {
    next(err);
  }
});

authRouter.post("/auth/logout", (_req, res) => {
  // Логаут гасит cookie независимо от того, была ли валидная сессия —
  // повторный вызов безопасен (идемпотентен).
  clearSession(res);
  res.status(204).end();
});

authRouter.get("/auth/me", requireSession, async (req, res, next) => {
  try {
    const config = getConfig(req);
    // requireSession уже гарантировал наличие cookie.
    const token = readToken(req) as string;
    const me = await authUpstream.me(config, token);
    res.json(me);
  } catch (err) {
    next(err);
  }
});
