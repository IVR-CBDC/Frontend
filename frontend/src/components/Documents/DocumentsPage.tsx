import { useCallback, useState } from "react";
import { useParams } from "react-router-dom";
import { api } from "../../api/client";
import { ApiError, messageFor } from "../../api/errors";
import type { Deal, DocumentStatus } from "../../types/api";
import { useRefetch } from "../../hooks/useRefetch";

const statusLabel: Record<DocumentStatus, string> = {
  missing: "Не загружен",
  uploaded: "Загружен",
  under_review: "На проверке",
  approved: "Подтверждён",
  rejected: "Отклонён",
};

const statusColor: Record<DocumentStatus, string> = {
  missing: "var(--text-muted)",
  uploaded: "var(--cyan-600)",
  under_review: "var(--amber-500)",
  approved: "var(--green-600)",
  rejected: "var(--red-600)",
};

// Единственное действие SPA над документом — подать его на проверку.
// Остальные статусы (uploaded/under_review/approved) выставляет эмулятор
// service-core сам по ходу проверки — произвольный PATCH статуса был
// наследием мока и Task 3 его убирает.
const SUBMITTABLE_STATUSES: DocumentStatus[] = ["missing", "rejected"];

export function DocumentsPage() {
  const { dealId } = useParams<{ dealId: string }>();
  const [deal, setDeal] = useState<Deal | null>(null);
  const [busyDocId, setBusyDocId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!dealId) return;
    setLoadError(null);
    api
      .getDeal(dealId)
      .then((d) => setDeal(d.deal))
      .catch((e) => setLoadError(messageFor(e)));
  }, [dealId]);

  // F2 (final review): без правила перезапроса экран не видит ни одного
  // кадра WS — эмулятор гоняет uploaded → under_review → approved|rejected
  // ровно пока пользователь смотрит на экран, и без этого статус навсегда
  // застревал бы на "Загружен", а version в состоянии протухал бы (обычным
  // потоком становился «клик → 409 → попробуйте ещё раз»).
  useRefetch(load, (event) => "dealId" in event && event.dealId === dealId);

  async function submit(documentId: string) {
    if (!dealId || !deal) return;
    setBusyDocId(documentId);
    setError(null);
    try {
      await api.submitDocument(dealId, documentId, deal.version);
      load();
    } catch (e) {
      if (e instanceof ApiError && e.code === "VERSION_CONFLICT") {
        // Сделка изменилась под нами (устаревшая version) — подтягиваем
        // актуальные данные вместо того, чтобы молча падать.
        setError("Сделка изменилась, данные обновлены — попробуйте отправить документ ещё раз");
        load();
      } else {
        setError(messageFor(e));
      }
    } finally {
      setBusyDocId(null);
    }
  }

  // F4 (final review): ошибка загрузки — баннер НАД уже загруженными
  // данными, а не вместо них. Разовый 503 во время фонового перезапроса
  // (см. useRefetch) больше не заменяет весь экран красной надписью без
  // возможности вернуться — только пока данных ещё вообще не было, экрану
  // нечего показать под баннером.
  if (loadError && !deal) {
    return (
      <div className="field-error" role="alert">
        {loadError}{" "}
        <button className="btn btn-ghost" onClick={load} style={{ marginLeft: 8 }}>
          Повторить
        </button>
      </div>
    );
  }
  if (!deal) return <div style={{ color: "var(--text-muted)" }}>Загрузка…</div>;

  return (
    <div>
      <h1 className="page-title">Документооборот · {deal.displayId}</h1>
      <p className="page-subtitle">Что нужно, зачем это нужно и на каком этапе находится каждый файл.</p>

      {loadError && (
        <div className="field-error" role="alert" style={{ marginBottom: 12 }}>
          {loadError}{" "}
          <button className="btn btn-ghost" onClick={load} style={{ marginLeft: 8 }}>
            Повторить
          </button>
        </div>
      )}
      {error && <div className="field-error" role="alert" style={{ marginBottom: 12 }}>{error}</div>}

      <div className="panel">
        {deal.documents.map((doc, i) => (
          <div
            key={doc.id}
            data-testid="document-row"
            data-doc-kind={doc.kind}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "16px 18px",
              borderTop: i === 0 ? "none" : "1px solid var(--line)",
            }}
          >
            <div style={{ maxWidth: 420 }}>
              <div style={{ fontWeight: 600, fontSize: 14 }}>{doc.name}</div>
              <div style={{ fontSize: 12.5, color: "var(--text-muted)" }}>{doc.purpose}</div>
              {doc.status === "rejected" && doc.rejectReason && (
                <div className="field-error" style={{ marginTop: 4, fontSize: 12 }}>
                  {doc.rejectReason}
                </div>
              )}
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <span
                className="mono"
                data-testid="document-status"
                style={{ fontSize: 11.5, color: statusColor[doc.status], border: `1px solid ${statusColor[doc.status]}`, borderRadius: 3, padding: "2px 8px" }}
              >
                {statusLabel[doc.status]}
              </span>
              {SUBMITTABLE_STATUSES.includes(doc.status) && (
                <button
                  className="btn btn-secondary"
                  onClick={() => submit(doc.id)}
                  disabled={busyDocId === doc.id}
                  // F13 (final review): с одинаковым текстом на нескольких
                  // строк getByRole("button", {name: "Отправить на
                  // проверку"}) неоднозначен по построению — имя включает
                  // документ.
                  aria-label={`Отправить на проверку: ${doc.name}`}
                >
                  {busyDocId === doc.id ? "Отправляем…" : "Отправить на проверку"}
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
