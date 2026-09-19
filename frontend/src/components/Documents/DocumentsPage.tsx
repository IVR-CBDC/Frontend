import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api } from "../../api/client";
import type { Deal, DocumentStatus } from "../../types/deal";

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

export function DocumentsPage() {
  const { dealId } = useParams<{ dealId: string }>();
  const [deal, setDeal] = useState<Deal | null>(null);
  const [busyDocId, setBusyDocId] = useState<string | null>(null);

  function load() {
    if (dealId) api.getDeal(dealId).then((d) => setDeal(d.deal));
  }
  useEffect(load, [dealId]);

  async function markUploaded(documentId: string) {
    if (!dealId) return;
    setBusyDocId(documentId);
    try {
      await api.setDocumentStatus(dealId, documentId, "uploaded");
      load();
    } finally {
      setBusyDocId(null);
    }
  }

  if (!deal) return <div style={{ color: "var(--text-muted)" }}>Загрузка…</div>;

  return (
    <div>
      <h1 className="page-title">Документооборот · {deal.displayId}</h1>
      <p className="page-subtitle">Что нужно, зачем это нужно и на каком этапе находится каждый файл.</p>

      <div className="panel">
        {deal.documents.map((doc, i) => (
          <div
            key={doc.id}
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
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <span
                className="mono"
                style={{ fontSize: 11.5, color: statusColor[doc.status], border: `1px solid ${statusColor[doc.status]}`, borderRadius: 3, padding: "2px 8px" }}
              >
                {statusLabel[doc.status]}
              </span>
              {doc.status === "missing" && (
                <button
                  className="btn btn-secondary"
                  onClick={() => markUploaded(doc.id)}
                  disabled={busyDocId === doc.id}
                >
                  {busyDocId === doc.id ? "Загружаем…" : "Загрузить"}
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
