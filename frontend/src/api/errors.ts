



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
  return "Нет связи с сервисом, проверьте подключение";
}
