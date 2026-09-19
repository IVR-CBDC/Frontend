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

    // F3 (final review): express.json() бросает SyntaxError со status: 400
    // на битом теле — до этой проверки он схлопывался в общий 500 ниже,
    // хотя это ровно "неверный ввод", а не "сервис упал". Разница важна:
    // план 06 будет ветвиться по этому статусу, а ложные 500 в логах на
    // каждый кривой запрос клиента маскируют настоящие внутренние ошибки.
    // "body" in err — способ, которым body-parser метит именно свою ошибку
    // разбора (а не любой случайный SyntaxError откуда-то ещё в коде).
    if (err instanceof SyntaxError && "body" in err) {
      res.status(400).json({ code: "VALIDATION_ERROR", error: "Некорректное тело запроса" });
      return;
    }

    // Шире: любая ошибка с числовым status в диапазоне 4xx (например, от
    // других middleware до наших собственных, не только body-parser) — это
    // тоже "неверный ввод", а не внутренний сбой. ApiError выше уже покрыл
    // случай, когда код при этом известен; здесь код неизвестен, поэтому
    // используем тот же VALIDATION_ERROR, что и для битого JSON.
    const status = (err as { status?: unknown } | null | undefined)?.status;
    if (typeof status === "number" && status >= 400 && status < 500) {
      res.status(status).json({ code: "VALIDATION_ERROR", error: "Некорректный запрос" });
      return;
    }

    // Наружу текст/стек непойманного исключения не отдаём — это могут быть
    // детали реализации или секреты. Для диагностики пишем в лог сервиса.
    console.error(err);
    res.status(500).json({ code: "INTERNAL_ERROR", error: "Внутренняя ошибка сервиса" });
  });
}
