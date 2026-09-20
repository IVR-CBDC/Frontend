import { useCallback, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../api/client";
import { messageFor } from "../../api/errors";
import type { DashboardCard } from "../../types/api";
import { DealCard } from "./DealCard";
import { useRefetch } from "../../hooks/useRefetch";

export function DashboardPage() {
  const [deals, setDeals] = useState<DashboardCard[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    // F4 (final review): сброс на каждую попытку — иначе один случайный
    // 503 во время фонового перезапроса (см. useRefetch) навсегда остаётся
    // висеть, даже когда следующий перезапрос уже прошёл успешно.
    setError(null);
    api
      .getDashboard()
      .then((data) => setDeals(data.deals))
      .catch((e) => setError(messageFor(e)));
  }, []);

  // Без matches — дашборд не привязан к одной сделке, любой DealEvent (новая
  // сделка, изменение существующей) для него релевантен. connection.ack
  // (в т.ч. после переподключения) перезапрашивает список безусловно —
  // см. useRefetch.
  useRefetch(load);

  const attentionCount = deals?.filter((d) => d.needsAttention).length ?? 0;

  return (
    <div>
      <h1 className="page-title">Активные сделки</h1>
      <p className="page-subtitle">
        Общее состояние бизнеса: этапы, суммы и то, что требует вашего действия прямо сейчас.
      </p>

      {error && (
        <div className="panel" role="alert" style={{ padding: 16, borderColor: "var(--red-600)", marginBottom: 20 }}>
          {/* F8 (final review): инструкция разработчика ("npm run dev в
              папке backend") уезжала в продакшн-образ и вдобавок была
              неверной (папка bff, команда pnpm dev) — обычному пользователю
              это ничем не поможет. */}
          Не удалось загрузить данные: {error}
          <button className="btn btn-ghost" onClick={load} style={{ marginLeft: 12 }}>
            Повторить
          </button>
        </div>
      )}

      {deals && (
        <div style={{ display: "flex", gap: 18, marginBottom: 22 }}>
          <SummaryStat label="Всего сделок" value={String(deals.length)} testId="deals-total-count" />
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

function SummaryStat({
  label,
  value,
  tone = "normal",
  testId,
}: {
  label: string;
  value: string;
  tone?: "normal" | "attention";
  testId?: string;
}) {
  return (
    <div className="panel" style={{ padding: "12px 18px", minWidth: 140 }}>
      <div style={{ fontSize: 11.5, color: "var(--text-muted)" }}>{label}</div>
      <div
        className="mono"
        data-testid={testId}
        style={{ fontSize: 22, fontWeight: 600, color: tone === "attention" ? "var(--amber-500)" : "var(--ink-900)" }}
      >
        {value}
      </div>
    </div>
  );
}
