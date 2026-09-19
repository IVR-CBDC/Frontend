import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../api/client";
import type { DashboardCard } from "../../types/api";
import { DealCard } from "./DealCard";
import { useWebSocket } from "../../hooks/useWebSocket";

export function DashboardPage() {
  const [deals, setDeals] = useState<DashboardCard[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    api
      .getDashboard()
      .then((data) => setDeals(data.deals))
      .catch((e) => setError(e.message));
  };

  useEffect(load, []);
  useWebSocket((event) => {
    if (event.type === "deal.updated") load();
  });

  const attentionCount = deals?.filter((d) => d.needsAttention).length ?? 0;

  return (
    <div>
      <h1 className="page-title">Активные сделки</h1>
      <p className="page-subtitle">
        Общее состояние бизнеса: этапы, суммы и то, что требует вашего действия прямо сейчас.
      </p>

      {error && (
        <div className="panel" style={{ padding: 16, borderColor: "var(--red-600)", marginBottom: 20 }}>
          Не удалось загрузить данные: {error}. Убедитесь, что запущен BFF (npm run dev в папке backend).
        </div>
      )}

      {deals && (
        <div style={{ display: "flex", gap: 18, marginBottom: 22 }}>
          <SummaryStat label="Всего сделок" value={String(deals.length)} />
          <SummaryStat label="Требуют внимания" value={String(attentionCount)} tone={attentionCount > 0 ? "attention" : "normal"} />
          <Link to="/deals/new" className="btn btn-primary" style={{ marginLeft: "auto", alignSelf: "flex-start" }}>
            + Новая сделка
          </Link>
        </div>
      )}

      {!deals && !error && <div style={{ color: "var(--text-muted)" }}>Загрузка…</div>}

      {deals && deals.length === 0 && (
        <div className="panel" style={{ padding: 28, textAlign: "center" }}>
          <p style={{ marginBottom: 14 }}>Активных сделок пока нет.</p>
          <Link to="/deals/new" className="btn btn-primary">
            Создать первую сделку
          </Link>
        </div>
      )}

      {deals && deals.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 14 }}>
          {deals.map((deal) => (
            <DealCard key={deal.id} deal={deal} />
          ))}
        </div>
      )}
    </div>
  );
}

function SummaryStat({ label, value, tone = "normal" }: { label: string; value: string; tone?: "normal" | "attention" }) {
  return (
    <div className="panel" style={{ padding: "12px 18px", minWidth: 140 }}>
      <div style={{ fontSize: 11.5, color: "var(--text-muted)" }}>{label}</div>
      <div
        className="mono"
        style={{ fontSize: 22, fontWeight: 600, color: tone === "attention" ? "var(--amber-500)" : "var(--ink-900)" }}
      >
        {value}
      </div>
    </div>
  );
}
