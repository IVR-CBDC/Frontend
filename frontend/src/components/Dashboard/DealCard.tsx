import { Link } from "react-router-dom";
import type { DashboardCard } from "../../types/api";
import { ProgressBar } from "./ProgressBar";
import { StatusBadge } from "./StatusBadge";

const operationLabel = { import: "Импорт", export: "Экспорт" };

function formatAmount(amount: number, currency: string): string {
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(amount) + " " + currency;
}

export function DealCard({ deal }: { deal: DashboardCard }) {
  return (
    <Link
      to={`/deals/${deal.id}/tracking`}
      className="panel"
      style={{
        display: "block",
        padding: "16px 18px",
        color: "inherit",
        borderColor: deal.needsAttention ? "var(--amber-500)" : "var(--line)",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
        <div>
          <div className="mono" style={{ fontSize: 12, color: "var(--text-muted)" }}>
            {deal.displayId}
          </div>
          <div style={{ fontWeight: 600, fontSize: 15, marginTop: 2 }}>{deal.counterpartyName}</div>
          <div style={{ fontSize: 12.5, color: "var(--text-muted)", marginTop: 1 }}>
            {operationLabel[deal.operationType]} · {deal.counterpartyCountry}
          </div>
        </div>
        <StatusBadge stage={deal.stage} />
      </div>

      <div style={{ fontWeight: 600, fontSize: 16, marginBottom: 10 }}>
        {formatAmount(deal.amount, deal.currency)}
      </div>

      <ProgressBar percent={deal.progressPercent} tone={deal.needsAttention ? "attention" : "normal"} />

      {deal.needsAttention && (
        <div style={{ marginTop: 10, fontSize: 12.5, color: "var(--amber-500)" }}>
          ⚠ {deal.attentionReason ?? "Требуется действие"}
        </div>
      )}
    </Link>
  );
}
