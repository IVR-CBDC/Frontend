import type {
  CreateDealInput,
  Deal,
  DashboardCard,
  DocumentStatus,
  NotificationItem,
  ScenarioOption,
  SettlementScenario,
} from "../types/deal";

const BASE = "/api";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: "Не удалось выполнить запрос" }));
    throw new Error(body.error ?? `Ошибка запроса: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
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
