import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";








const requestIdStorage = new AsyncLocalStorage<string>();




export function resolveRequestId(incoming: string | undefined): string {
  const trimmed = incoming?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : randomUUID();
}



export function runWithRequestId<T>(requestId: string, fn: () => T): T {
  return requestIdStorage.run(requestId, fn);
}

export function getRequestId(): string | undefined {
  return requestIdStorage.getStore();
}
