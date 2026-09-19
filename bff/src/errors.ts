import type { Express, NextFunction, Request, Response } from "express";

// Единый конверт ошибок для всех ответов BFF: {code, error}. code —
// машиночитаемый (фронт ветвится по нему), error — человекочитаемое русское
// сообщение для показа пользователю.
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

// Регистрирует финальные обработчики приложения: 404 для неизвестных
// маршрутов и общий error-handler. Вызывать один раз, после того как
// смонтированы все настоящие маршруты — Express обходит middleware по
// порядку регистрации, а 4-арный обработчик ошибок должен идти последним.
export function installErrorHandler(app: Express): void {
  app.use((_req: Request, res: Response) => {
    res.status(404).json({ code: "NOT_FOUND", error: "Маршрут не найден" });
  });

  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- 4 аргумента обязательны, иначе Express не распознает это как error-handler
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof ApiError) {
      res.status(err.status).json({ code: err.code, error: err.message });
      return;
    }

    // Наружу текст/стек непойманного исключения не отдаём — это могут быть
    // детали реализации или секреты. Для диагностики пишем в лог сервиса.
    console.error(err);
    res.status(500).json({ code: "INTERNAL_ERROR", error: "Внутренняя ошибка сервиса" });
  });
}
