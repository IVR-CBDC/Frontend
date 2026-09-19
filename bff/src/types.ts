// Domain model for a foreign-trade deal ("сделка"), shared by every screen.

export type OperationType = "import" | "export";

export type SettlementScenario = "cbdc" | "bank_transfer" | "smart_contract" | "trade_finance";

export type DealStage =
  | "created"
  | "documents"
  | "compliance_check"
  | "settlement"
  | "completed"
  | "blocked";

export type DocumentStatus = "missing" | "uploaded" | "under_review" | "approved" | "rejected";

export interface RequiredDocument {
  id: string;
  kind: string; // machine-readable document type (core: "kind")
  name: string; // human-readable title (core: "title")
  purpose: string; // plain-language explanation of why it's needed
  status: DocumentStatus;
  rejectReason?: string; // present only когда status === "rejected"
}

// core отдаёт таймлайн без собственного id — только порядковый номер шага
// (seq) и две отдельные метки времени (started_at/finished_at) вместо одной
// timestamp, поэтому этот тип не 1:1 с прежней мок-версией.
export interface TimelineEvent {
  seq: number;
  label: string; // core: "step"
  actor: string; // who performed / owns this step
  status: "done" | "in_progress" | "pending" | "delayed";
  delayReason?: string;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface Deal {
  id: string;
  displayId: string; // human readable e.g. "DEAL-2026-0143"
  counterpartyCountry: string;
  counterpartyName: string;
  operationType: OperationType;
  amount: number;
  currency: string;
  scenario: SettlementScenario | null;
  stage: DealStage;
  createdAt: string;
  updatedAt: string;
  hasBlockers: boolean;
  blockerReason?: string;
  // version — оптимистическая блокировка core: её нужно вернуть в теле
  // POST .../scenario и POST .../documents/:id/submit, иначе core ответит
  // 409 VERSION_CONFLICT. SPA обязана прокидывать её как есть.
  version: number;
  commissionTotal: number | null;
  documents: RequiredDocument[];
  timeline: TimelineEvent[];
}

// Сводная карточка сделки для списков (дашборд, GET /api/deals) — те же
// агрегаты (progressPercent/needsAttention), что уже считает core для своего
// summary-эндпоинта, так что BFF их просто переименовывает в camelCase, не
// пересчитывая.
export interface DashboardCard {
  id: string;
  displayId: string;
  counterpartyName: string;
  counterpartyCountry: string;
  operationType: OperationType;
  amount: number;
  currency: string;
  stage: DealStage;
  progressPercent: number;
  needsAttention: boolean;
  attentionReason: string | null;
  updatedAt: string;
}

export interface ScenarioCommission {
  baseFee: number;
  percentageFee: number;
  percentageAmount: number;
  fixedFee: number;
  subtotal: number;
  clamped: boolean;
  multiplier: number;
  total: number;
}

// Карточка сценария расчёта — котировка commission для параметров конкретной
// сделки (в отличие от прежнего статического каталога ScenarioOption).
export interface ScenarioCard {
  id: SettlementScenario;
  title: string;
  description: string;
  etaLabel: string;
  limitations: string[];
  available: boolean;
  unavailableReason: string | null;
  commission: ScenarioCommission | null;
}

export interface NotificationItem {
  id: string;
  dealId: string | null;
  severity: "info" | "warning" | "critical";
  message: string;
  createdAt: string;
  read: boolean;
}

export interface CreateDealInput {
  counterpartyCountry: string;
  counterpartyName: string;
  operationType: OperationType;
  amount: number;
  currency: string;
}
