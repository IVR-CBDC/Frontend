import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

// F7 (final review): спека §6 требует пробрасывать x-request-id в сервисы —
// без этого сбой, который видит пользователь в SPA, нельзя проследить в
// логах service-core/service-auth/service-commission. AsyncLocalStorage, а не
// параметр, добавляемый в сигнатуру каждой функции upstream/*.ts и каждого
// маршрута — иначе пришлось бы протащить requestId через все call site'ы
// routes/*.ts -> upstream/*.ts -> callUpstream, хотя это чисто сквозная
// (cross-cutting) забота, не часть бизнес-логики этих функций.
const requestIdStorage = new AsyncLocalStorage<string>();

// Берёт X-Request-Id клиента, если он есть и не пустой, иначе генерирует
// новый — так запрос трассируется от SPA до самого глубокого сервиса, даже
// если клиент вообще не прислал заголовок.
export function resolveRequestId(incoming: string | undefined): string {
  const trimmed = incoming?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : randomUUID();
}

// Выполняет fn в контексте с заданным requestId — все callUpstream() внутри
// (прямо или через несколько async-переходов) увидят его через getRequestId().
export function runWithRequestId<T>(requestId: string, fn: () => T): T {
  return requestIdStorage.run(requestId, fn);
}

export function getRequestId(): string | undefined {
  return requestIdStorage.getStore();
}
