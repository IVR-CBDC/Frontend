

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
  kind: string; 
  name: string; 
  purpose: string; 
  status: DocumentStatus;
  rejectReason?: string; 
}




export interface TimelineEvent {
  seq: number;
  label: string; 
  actor: string; 
  status: "done" | "in_progress" | "pending" | "delayed";
  delayReason?: string;
  startedAt: string | null;
  finishedAt: string | null;
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
  
  
  
  version: number;
  commissionTotal: number | null;
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








export type DealEventType = "deal.updated" | "deal.created" | "notification.created";




export interface DealEvent {
  type: DealEventType;
  seq: number;
  dealId?: string;
  notificationId?: string;
  at: string;
}



export interface ConnectionAckFrame {
  type: "connection.ack";
}




export interface HeartbeatFrame {
  type: "heartbeat";
  at: string;
}

export type WsServerFrame = DealEvent | ConnectionAckFrame | HeartbeatFrame;
