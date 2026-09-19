import type { Application, NextFunction, Request, RequestHandler, Response } from "express";
import { decodeJwt } from "jose";
import type { Config } from "./config.js";
import { ApiError } from "./errors.js";

// Экспортируется, чтобы ws/hub.ts мог достать ту же cookie при апгрейде
// WebSocket без дублирования имени — cookie-parser там не подключён (это
// сырой http.IncomingMessage до Express), но имя cookie должно совпадать.
export const COOKIE_NAME = "session";
const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function getConfig(app: Application): Config {
  const config = app.get("config") as Config | undefined;
  if (!config) {
    throw new Error("createApp() не установил config в app — session.ts не может работать без него");
  }
  return config;
}

function cookieOptions(config: Config, maxAge?: number) {
  return {
    httpOnly: true,
    sameSite: "strict" as const,
    path: "/",
    secure: config.cookieSecure,
    ...(maxAge !== undefined ? { maxAge } : {}),
  };
}

// Кладёт токен auth в HttpOnly-cookie. Максимальный возраст cookie берём из
// exp токена: разбираем payload БЕЗ ПРОВЕРКИ ПОДПИСИ (jose.decodeJwt). Это
// осознанно, а не забытая проверка: подпись здесь не нужна, потому что токен
// только что получен от service-auth по внутренней сети, а его подлинность
// будут проверять сервисы, которым он предъявляется (service-core,
// service-commission) — BFF использует поле exp только чтобы cookie не
// пережила сам токен, а не как источник доверия.
export function setSession(res: Response, token: string): void {
  const config = getConfig(res.req.app);

  let exp: number | undefined;
  try {
    exp = decodeJwt(token).exp;
  } catch {
    exp = undefined;
  }

  const expiresInMs = exp !== undefined ? exp * 1000 - Date.now() : undefined;
  if (expiresInMs === undefined || expiresInMs <= 0) {
    // F9 (final review, дефект плана): раньше здесь был код
    // UPSTREAM_UNAVAILABLE с 502, хотя план в Global Constraints требует
    // 503 UPSTREAM_UNAVAILABLE для "сервис недоступен" — один код с двумя
    // статусами, SPA не может по нему ветвиться. Это другой случай: auth
    // ответил (сервис доступен), но выдал токен, которым нельзя
    // пользоваться дальше по цепочке — отдельный код, 502 оставлен как
    // статус (не 5xx "у нас всё упало", а "апстрим нарушил контракт").
    throw new ApiError(
      502,
      "UPSTREAM_CONTRACT_VIOLATION",
      "Сервис авторизации вернул некорректный токен",
    );
  }

  res.cookie(COOKIE_NAME, token, cookieOptions(config, expiresInMs));
}

export function clearSession(res: Response): void {
  const config = getConfig(res.req.app);
  // Опции (кроме maxAge/expires) должны совпадать с теми, что были при
  // установке cookie — иначе браузер её не сотрёт.
  res.clearCookie(COOKIE_NAME, cookieOptions(config));
}

export function readToken(req: Request): string | undefined {
  const cookies = req.cookies as Record<string, string> | undefined;
  return cookies?.[COOKIE_NAME];
}

export const requireSession: RequestHandler = (req, _res, next: NextFunction) => {
  if (!readToken(req)) {
    next(new ApiError(401, "UNAUTHORIZED", "Требуется авторизация"));
    return;
  }
  next();
};

// SPA всегда шлёт Origin на мутирующих запросах из браузера; отсутствие
// Origin на POST/PUT/PATCH/DELETE — признак не-браузерного клиента (curl,
// скрипт и т.п.), поэтому такие запросы отклоняем, а не пропускаем молча.
// GET/HEAD/OPTIONS Origin не проверяем — они не меняют состояние.
export const checkOrigin: RequestHandler = (req, _res, next) => {
  if (!MUTATING_METHODS.has(req.method)) {
    next();
    return;
  }

  const config = getConfig(req.app);
  const origin = req.header("Origin");
  if (!origin || !config.allowedOrigins.includes(origin)) {
    next(new ApiError(403, "FORBIDDEN_ORIGIN", "Запрос с недопустимого источника"));
    return;
  }

  next();
};
