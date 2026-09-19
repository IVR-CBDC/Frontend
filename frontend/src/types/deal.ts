export type OperationType = "import" | "export";

export type SettlementScenario = "cbdc" | "bank_transfer" | "smart_contract" | "trade_finance";

export type DealStage = "created" | "documents" | "compliance_check" | "settlement" | "completed" | "blocked";

export type DocumentStatus = "missing" | "uploaded" | "under_review" | "approved" | "rejected";

export interface RequiredDocument {
  id: string;
  name: string;
  purpose: string;
  status: DocumentStatus;
  updatedAt: string;
}

export interface TimelineEvent {
  id: string;
  label: string;
  actor: string;
  timestamp: string;
  status: "done" | "in_progress" | "pending" | "delayed";
  delayReason?: string;
}

export interface Deal {
  id: string;
  displayId: string;
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
  documents: RequiredDocument[];
  timeline: TimelineEvent[];
}

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

export interface ScenarioOption {
  id: SettlementScenario;
  title: string;
  description: string;
  etaLabel: string;
  costLabel: string;
  limitations: string[];
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
