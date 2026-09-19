import { z } from "zod";
import { ApiError } from "./errors.js";

// F12 (final review): zod был в зависимостях и не использовался (спека §6
// предполагает его для валидации). Применяем его здесь, а не выкидываем —
// заодно закрывает F12's "req.body as ..." (три места в routes/deals.ts,
// невалидированные приведения типов) и F11's "нечисловой limit уходит в
// core строкой NaN" — оба по сути один и тот же класс проблемы (вход от
// клиента не проверен, прежде чем уйти дальше по цепочке).

// Общий помощник: парсит unknown по схеме, на неудаче бросает тот же
// VALIDATION_ERROR (F3), которым отвечает и battered JSON, и любой err.status
// в диапазоне 4xx — SPA видит один код на весь класс "неверный ввод".
export function validateBody<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new ApiError(400, "VALIDATION_ERROR", "Некорректное тело запроса");
  }
  return result.data;
}

// query.limit из Express — string | string[] | ParsedQs | ParsedQs[] |
// undefined; коэрсим в число и проверяем диапазон одним местом для
// /api/deals и /api/notifications, а не Number(...) без проверки (что
// раньше отправляло в core буквально "?limit=NaN" на нечисловой ввод —
// F11).
const limitSchema = z.coerce.number().int().positive().optional();

export function parseLimit(raw: unknown): number | undefined {
  const result = limitSchema.safeParse(raw);
  if (!result.success) {
    throw new ApiError(400, "VALIDATION_ERROR", "Некорректный параметр limit");
  }
  return result.data;
}
