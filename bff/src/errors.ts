import type { Express, NextFunction, Request, Response } from "express";
import { clearSession, readToken } from "./session.js";




export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function upstreamUnavailable(): ApiError {
  return new ApiError(503, "UPSTREAM_UNAVAILABLE", "Сервис временно недоступен, попробуйте позже");
}





export function installErrorHandler(app: Express): void {
  app.use((_req: Request, res: Response) => {
    res.status(404).json({ code: "NOT_FOUND", error: "Маршрут не найден" });
  });

  
  app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof ApiError) {
      
      
      
      
      
      
      
      if ((err.code === "TOKEN_EXPIRED" || err.code === "INVALID_TOKEN") && readToken(req)) {
        clearSession(res);
      }
      res.status(err.status).json({ code: err.code, error: err.message });
      return;
    }

    
    
    
    
    
    
    
    if (err instanceof SyntaxError && "body" in err) {
      res.status(400).json({ code: "VALIDATION_ERROR", error: "Некорректное тело запроса" });
      return;
    }

    
    
    
    
    
    const status = (err as { status?: unknown } | null | undefined)?.status;
    if (typeof status === "number" && status >= 400 && status < 500) {
      res.status(status).json({ code: "VALIDATION_ERROR", error: "Некорректный запрос" });
      return;
    }

    
    
    console.error(err);
    res.status(500).json({ code: "INTERNAL_ERROR", error: "Внутренняя ошибка сервиса" });
  });
}
