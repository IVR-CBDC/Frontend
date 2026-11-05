import { ApiError, upstreamUnavailable } from "../errors.js";
import { getRequestId } from "../requestContext.js";

interface UpstreamErrorBody {
  code?: unknown;
  error?: unknown;
}




export async function callUpstream<T>(url: string, init: RequestInit, timeoutMs: number): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  
  
  
  
  
  const headers: Record<string, string> = { ...(init.headers as Record<string, string> | undefined) };
  const requestId = getRequestId();
  if (requestId) {
    headers["X-Request-Id"] = requestId;
  }

  let response: Response;
  try {
    response = await fetch(url, { ...init, headers, signal: controller.signal });
  } catch {
    
    
    throw upstreamUnavailable();
  } finally {
    clearTimeout(timer);
  }

  if (response.ok) {
    
    
    
    if (response.status === 204) {
      return undefined as T;
    }
    return (await response.json()) as T;
  }

  
  
  
  if (response.status >= 500) {
    throw upstreamUnavailable();
  }

  const body = (await response.json().catch(() => null)) as UpstreamErrorBody | null;
  if (body && typeof body.code === "string" && typeof body.error === "string") {
    throw new ApiError(response.status, body.code, body.error);
  }

  
  
  throw upstreamUnavailable();
}
