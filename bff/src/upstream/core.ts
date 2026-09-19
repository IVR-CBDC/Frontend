import type { Config } from "../config.js";
import { callUpstream } from "./http.js";

// Формы, в которых service-core реально отдаёт данные (snake_case, как в его
// БД) — отдельно от контракта BFF↔SPA (camelCase, src/types.ts). Мапперы,
// переводящие одно в другое, живут рядом с маршрутами (routes/deals.ts,
// routes/notifications.ts), а не здесь: этот файл — тонкая обёртка над
// callUpstream и ничего не знает про то, как ответ будет показан на экране.

export interface CoreDealSummary {
  id: string;
  display_id: string;
  counterparty_name: string;
  counterparty_country: string;
  operation_type: "import" | "export";
  amount: number;
  currency: string;
  scenario: string | null;
  stage: string;
  progress_percent: number;
  needs_attention: boolean;
  attention_reason: string | null;
  commission_total: number | null;
  version: number;
  updated_at: string;
}

export interface CoreDocument {
  id: string;
  kind: string;
  title: string;
  purpose: string;
  status: string;
  reject_reason: string;
}

export interface CoreTimelineStep {
  seq: number;
  step: string;
  actor: string;
  status: string;
  delay_reason: string;
  started_at: string;
  finished_at: string;
}

// Полная сделка (GET по id, и то, что возвращают scenario/submit) — то же
// самое summary плюс created_at, documents и timeline.
export interface CoreDeal extends CoreDealSummary {
  created_at: string;
  documents: CoreDocument[];
  timeline: CoreTimelineStep[];
}

export interface CoreNotification {
  id: string;
  deal_id: string | null;
  severity: string;
  message: string;
  read: boolean;
  created_at: string;
}

export interface CreateDealBody {
  counterparty_country: string;
  counterparty_name: string;
  operation_type: "import" | "export";
  amount: number;
  currency: string;
}

function authHeaders(token: string, extra?: Record<string, string>): Record<string, string> {
  return { Authorization: `Bearer ${token}`, ...extra };
}

function withLimit(url: string, limit?: number): string {
  if (limit === undefined) return url;
  const withQuery = new URL(url);
  withQuery.searchParams.set("limit", String(limit));
  return withQuery.toString();
}

export function listDeals(
  config: Config,
  token: string,
  limit?: number,
): Promise<{ items: CoreDealSummary[]; count: number }> {
  return callUpstream(
    withLimit(`${config.coreUrl}/api/core/deals`, limit),
    { headers: authHeaders(token) },
    config.upstreamTimeoutMs,
  );
}

export function getDeal(config: Config, token: string, id: string): Promise<{ deal: CoreDeal }> {
  return callUpstream(
    `${config.coreUrl}/api/core/deals/${id}`,
    { headers: authHeaders(token) },
    config.upstreamTimeoutMs,
  );
}

export function createDeal(
  config: Config,
  token: string,
  body: CreateDealBody,
): Promise<{ deal: CoreDeal }> {
  return callUpstream(
    `${config.coreUrl}/api/core/deals`,
    {
      method: "POST",
      headers: authHeaders(token, { "Content-Type": "application/json" }),
      body: JSON.stringify(body),
    },
    config.upstreamTimeoutMs,
  );
}

export function chooseScenario(
  config: Config,
  token: string,
  id: string,
  body: { scenario: string; version: number },
): Promise<{ deal: CoreDeal }> {
  return callUpstream(
    `${config.coreUrl}/api/core/deals/${id}/scenario`,
    {
      method: "POST",
      headers: authHeaders(token, { "Content-Type": "application/json" }),
      body: JSON.stringify(body),
    },
    config.upstreamTimeoutMs,
  );
}

export function submitDocument(
  config: Config,
  token: string,
  dealId: string,
  documentId: string,
  body: { version: number },
): Promise<{ deal: CoreDeal }> {
  return callUpstream(
    `${config.coreUrl}/api/core/deals/${dealId}/documents/${documentId}/submit`,
    {
      method: "POST",
      headers: authHeaders(token, { "Content-Type": "application/json" }),
      body: JSON.stringify(body),
    },
    config.upstreamTimeoutMs,
  );
}

export function listNotifications(
  config: Config,
  token: string,
  limit?: number,
): Promise<{ items: CoreNotification[]; unread: number }> {
  return callUpstream(
    withLimit(`${config.coreUrl}/api/core/notifications`, limit),
    { headers: authHeaders(token) },
    config.upstreamTimeoutMs,
  );
}

// core отвечает 204 без тела — callUpstream() возвращает undefined на
// 204, что соответствует объявленному здесь Promise<void>.
export function markNotificationRead(config: Config, token: string, id: string): Promise<void> {
  return callUpstream(
    `${config.coreUrl}/api/core/notifications/${id}/read`,
    { method: "POST", headers: authHeaders(token) },
    config.upstreamTimeoutMs,
  );
}
