// Единый конверт ошибок BFF — {code, error} (см. README «Контракт для SPA»).
// code — машиночитаемый, на нём должно строиться ветвление; error — русский
// текст, годится только как запасной вариант, если для code нет своего текста.

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

// Коды, которыми апстрим (через BFF) сигналит "cookie сессии больше не
// годится" — BFF уже погасил cookie на своей стороне (Set-Cookie с истёкшей
// датой), так что SPA остаётся только перевести приложение в anonymous и
// увести на /login, не пытаясь ничего восстановить.
const AUTH_ERROR_CODES = new Set(["UNAUTHORIZED", "TOKEN_EXPIRED", "INVALID_TOKEN"]);

export function isAuthError(e: unknown): boolean {
  return e instanceof ApiError && e.status === 401 && AUTH_ERROR_CODES.has(e.code);
}

// Человекочитаемые тексты по code — специально не по e.message/e.error,
// чтобы ветвление проверялось тестами именно по коду, а не по случайно
// совпавшей строке.
const MESSAGES_BY_CODE: Record<string, string> = {
  VALIDATION_ERROR: "Проверьте правильность заполнения формы",
  UNAUTHORIZED: "Войдите, чтобы продолжить",
  TOKEN_EXPIRED: "Сессия истекла, войдите снова",
  INVALID_TOKEN: "Сессия недействительна, войдите снова",
  FORBIDDEN_ORIGIN: "Запрос отклонён по соображениям безопасности",
  NOT_FOUND: "Запрошенные данные не найдены",
  INVALID_CREDENTIALS: "Неверный логин или пароль",
  UPSTREAM_CONTRACT_VIOLATION: "Сервис вернул неожиданный ответ, попробуйте позже",
  UPSTREAM_UNAVAILABLE: "Сервис временно недоступен, попробуйте позже",
  INTERNAL_ERROR: "Внутренняя ошибка сервиса, попробуйте позже",
};

export function messageFor(e: unknown): string {
  if (e instanceof ApiError) {
    return MESSAGES_BY_CODE[e.code] ?? e.message;
  }
  if (e instanceof Error) {
    return e.message;
  }
  return "Не удалось выполнить запрос";
}
