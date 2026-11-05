import { z } from "zod";
import { ApiError } from "./errors.js";











export function validateBody<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new ApiError(400, "VALIDATION_ERROR", "Некорректное тело запроса");
  }
  return result.data;
}






const limitSchema = z.coerce.number().int().positive().optional();

export function parseLimit(raw: unknown): number | undefined {
  const result = limitSchema.safeParse(raw);
  if (!result.success) {
    throw new ApiError(400, "VALIDATION_ERROR", "Некорректный параметр limit");
  }
  return result.data;
}
