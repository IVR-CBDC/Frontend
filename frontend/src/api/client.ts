import type {
  CreateDealInput,
  Deal,
  DashboardCard,
  DocumentStatus,
  NotificationItem,
  ScenarioOption,
  SettlementScenario,
} from "../types/deal";
import { ApiError, isAuthError } from "./errors";

const BASE = "/api";

// Единая точка, через которую client.ts сообщает "наверху" о том, что
// сессия перестала быть валидной (BFF уже погасил cookie — см. README
// «Контракт для SPA», коды TOKEN_EXPIRED/INVALID_TOKEN). AuthProvider
// подписывается на это событие, чтобы перевести приложение в anonymous из
// любого места, а не только из вызовов, которые сам AuthProvider делает
// напрямую.
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

// register/login отдают только идентификаторы — сам токен сессии BFF кладёт
// в HttpOnly-cookie и наружу не отдаёт (см. bff/src/routes/auth.ts).
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
    // TOKEN_EXPIRED/INVALID_TOKEN/UNAUTHORIZED — cookie уже мертва (BFF её
    // погасил), продолжать считать пользователя вошедшим нельзя ни для
    // какого запроса, не только для тех, что делает сам AuthProvider.
    if (isAuthError(err)) {
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

  getDashboard: () =>
    request<{ deals: DashboardCard[]; unreadNotifications: number }>("/dashboard"),

  getNotifications: () => request<{ notifications: NotificationItem[] }>("/notifications"),

  markNotificationRead: (id: string) =>
    request<{ notification: NotificationItem }>(`/notifications/${id}/read`, { method: "POST" }),

  createDeal: (input: CreateDealInput) =>
    request<{ deal: Deal }>("/deals", { method: "POST", body: JSON.stringify(input) }),

  getDeal: (id: string) => request<{ deal: Deal }>(`/deals/${id}`),

  getScenarios: () => request<{ scenarios: ScenarioOption[] }>("/scenarios"),

  chooseScenario: (dealId: string, scenario: SettlementScenario) =>
    request<{ deal: Deal }>(`/deals/${dealId}/scenario`, {
      method: "POST",
      body: JSON.stringify({ scenario }),
    }),

  setDocumentStatus: (dealId: string, documentId: string, status: DocumentStatus) =>
    request<{ document: unknown }>(`/deals/${dealId}/documents/${documentId}`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
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
