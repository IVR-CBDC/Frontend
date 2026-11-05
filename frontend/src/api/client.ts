import type {
  CreateDealInput,
  Deal,
  DashboardCard,
  NotificationItem,
  ScenarioCard,
  SettlementScenario,
} from "../types/api";
import { ApiError } from "./errors";

const BASE = "/api";


















export const authEvents = new EventTarget();
export const SESSION_EXPIRED_EVENT = "session-expired";

export interface RegisterInput {
  login: string;
  password: string;
  name?: string;
  company_name: string;
  inn: string;
}

export interface LoginInput {
  login: string;
  password: string;
}



export interface AuthTokenResponse {
  user_id: string;
  company_id: string;
}

export interface Company {
  id: string;
  name: string;
  inn: string;
}

export interface MeResponse {
  user_id: string;
  login: string;
  name: string;
  company: Company;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    // Сессия живёт в HttpOnly-cookie (см. README «Контракт для SPA») — без
    // этого браузер не приложит её к запросу на /api.
    credentials: "same-origin",
    ...init,
  });

  if (res.status === 204) {
    return undefined as T;
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({ code: "UNKNOWN", error: "Не удалось выполнить запрос" }));
    const err = new ApiError(
      res.status,
      typeof body.code === "string" ? body.code : "UNKNOWN",
      typeof body.error === "string" ? body.error : `Ошибка запроса: ${res.status}`,
    );
    // Любой 401 — сигнал "наверх", решение принимает AuthProvider (см.
    // комментарий у authEvents выше).
    if (res.status === 401) {
      authEvents.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT));
    }
    throw err;
  }
  return res.json() as Promise<T>;
}

export const api = {
  auth: {
    register: (input: RegisterInput) =>
      request<AuthTokenResponse>("/auth/register", { method: "POST", body: JSON.stringify(input) }),

    login: (input: LoginInput) =>
      request<AuthTokenResponse>("/auth/login", { method: "POST", body: JSON.stringify(input) }),

    logout: () => request<void>("/auth/logout", { method: "POST" }),

    me: () => request<MeResponse>("/auth/me"),
  },

  getPushPublicKey: () => request<{ publicKey: string }>("/push/public-key"),
  savePushSubscription: (subscription: PushSubscriptionJSON) =>
    request<{ ok: boolean }>("/push/subscriptions", { method: "POST", body: JSON.stringify(subscription) }),
  removePushSubscription: (endpoint: string) =>
    request<void>("/push/subscriptions", { method: "DELETE", body: JSON.stringify({ endpoint }) }),

  getDashboard: () =>
    request<{ deals: DashboardCard[]; unreadNotifications: number }>("/dashboard"),

  // F14 (final review): BFF отдаёт unread вместе со списком
  // (bff/src/routes/notifications.ts) — раньше этот тип его терял, из-за
  // чего App.tsx был вынужден тянуть весь /api/dashboard только ради
  // счётчика непрочитанных.
  getNotifications: () => request<{ notifications: NotificationItem[]; unread: number }>("/notifications"),

  // F14 (final review): BFF отвечает 204 (см. bff/src/routes/notifications.ts) —
  // тело парсить не из чего, раньше тип обещал { notification }, которого
  // никогда не было.
  markNotificationRead: (id: string) => request<void>(`/notifications/${id}/read`, { method: "POST" }),

  createDeal: (input: CreateDealInput) =>
    request<{ deal: Deal }>("/deals", { method: "POST", body: JSON.stringify(input) }),

  getDeal: (id: string) => request<{ deal: Deal }>(`/deals/${id}`),

  // Котировки комиссии зависят от параметров конкретной сделки (коридор,
  // сумма) — эндпоинт всегда per-deal, глобального /scenarios в контракте
  // нет (см. README «Контракт для SPA», bff/src/routes/deals.ts).
  getScenarios: (dealId: string) =>
    request<{ corridorId: string; scenarios: ScenarioCard[] }>(`/deals/${dealId}/scenarios`),

  // version — оптимистическая блокировка core (см. types/api.ts Deal.version):
  // без неё core отвечает 409 VERSION_CONFLICT.
  chooseScenario: (dealId: string, scenario: SettlementScenario, version: number) =>
    request<{ deal: Deal }>(`/deals/${dealId}/scenario`, {
      method: "POST",
      body: JSON.stringify({ scenario, version }),
    }),

  // Единственное действие SPA над документом — подать на проверку; остальные
  // статусы (uploaded/under_review/approved) выставляет эмулятор core, а не
  // произвольный PATCH — это наследие мока, убранное в Task 3.
  uploadDocument: (dealId: string, documentId: string, file: File) =>
    request<{ filename: string; contentType: string; size: number }>(`/deals/${dealId}/documents/${documentId}/upload`, {
      method: "POST",
      headers: {
        "Content-Type": "application/octet-stream",
        "X-File-Name": encodeURIComponent(file.name),
        "X-File-Type": file.type || "application/octet-stream",
      },
      body: file,
    }),

  submitDocument: (dealId: string, documentId: string, version: number) =>
    request<{ deal: Deal }>(`/deals/${dealId}/documents/${documentId}/submit`, {
      method: "POST",
      body: JSON.stringify({ version }),
    }),

  getTracking: (dealId: string) =>
    request<{
      displayId: string;
      stage: string;
      hasBlockers: boolean;
      blockerReason: string | null;
      timeline: Deal["timeline"];
    }>(`/deals/${dealId}/tracking`),
};
