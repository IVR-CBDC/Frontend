import { useCallback, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../../api/client";
import { messageFor } from "../../api/errors";
import type { Deal } from "../../types/api";
import { StatusBadge } from "../Dashboard/StatusBadge";
import { Timeline } from "./Timeline";
import { useRefetch } from "../../hooks/useRefetch";

export function TrackingPage() {
  const { dealId } = useParams<{ dealId: string }>();
  const [deal, setDeal] = useState<Deal | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!dealId) return;
    // F4 (final review): сброс на каждую попытку — иначе разовый сбой
    // фонового перезапроса (см. useRefetch) навсегда остаётся висеть.
    setError(null);
    api
      .getDeal(dealId)
      .then((d) => setDeal(d.deal))
      .catch((e) => setError(messageFor(e)));
  }, [dealId]);

  // Ключевой экран трекинга — без перезапроса на connection.ack (в т.ч.
  // после переподключения) любые изменения сделки, случившиеся во время
  // разрыва, остались бы незамеченными: у pub/sub нет истории событий.
  useRefetch(load, (event) => "dealId" in event && event.dealId === dealId);

  // F4 (final review): баннер НАД уже загруженными данными, а не вместо
  // них — только пока данных ещё вообще не было, экрану нечего показать
  // под баннером.
  if (error && !deal) {
    return (
      <div className="field-error" role="alert">
        {error}{" "}
        <button className="btn btn-ghost" onClick={load} style={{ marginLeft: 8 }}>
          Повторить
        </button>
      </div>
    );
  }
  if (!deal) return <div style={{ color: "var(--text-muted)" }}>Загрузка…</div>;

  return (
    <div>
      {error && (
        <div className="field-error" role="alert" style={{ marginBottom: 12 }}>
          {error}{" "}
          <button className="btn btn-ghost" onClick={load} style={{ marginLeft: 8 }}>
            Повторить
          </button>
        </div>
      )}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 4 }}>
        <h1 className="page-title" style={{ margin: 0 }}>
          {deal.displayId}
        </h1>
        <StatusBadge stage={deal.stage} />
      </div>
      <p className="page-subtitle">
        {deal.counterpartyName} · {deal.counterpartyCountry} · {deal.operationType === "import" ? "Импорт" : "Экспорт"}
      </p>

      {deal.hasBlockers && (
        <div
          className="panel"
          style={{ padding: "14px 18px", borderColor: "var(--red-600)", marginBottom: 22, background: "#fdf2f1" }}
        >
          <strong style={{ color: "var(--red-600)" }}>Сделка требует внимания.</strong>{" "}
          <span style={{ color: "var(--text-primary)" }}>{deal.blockerReason}</span>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 260px", gap: 24 }}>
        <div className="panel" style={{ padding: 22 }}>
          <h2 style={{ fontSize: 14, fontWeight: 600, margin: "0 0 18px" }}>Таймлайн сделки</h2>
          <Timeline events={deal.timeline} />
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div className="panel" style={{ padding: 16 }}>
            <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginBottom: 4 }}>Сумма</div>
            <div className="mono" style={{ fontSize: 18, fontWeight: 600 }}>
              {new Intl.NumberFormat("ru-RU").format(deal.amount)} {deal.currency}
            </div>
          </div>

          <div className="panel" style={{ padding: 16 }}>
            <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginBottom: 4 }}>Сценарий расчёта</div>
            <div style={{ fontSize: 13.5 }}>{deal.scenario ?? "Не выбран"}</div>
            {!deal.scenario && (
              <Link to={`/deals/${deal.id}/scenario`} className="btn btn-secondary" style={{ marginTop: 10, width: "100%", justifyContent: "center" }}>
                Выбрать сценарий
              </Link>
            )}
          </div>

          <Link to={`/deals/${deal.id}/documents`} className="btn btn-secondary" style={{ justifyContent: "center" }}>
            Документооборот
          </Link>
        </div>
      </div>
    </div>
  );
}
