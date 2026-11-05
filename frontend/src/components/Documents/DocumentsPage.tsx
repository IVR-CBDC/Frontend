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

const SUBMITTABLE_STATUSES: DocumentStatus[] = ["missing", "rejected"];
const MAX_FILE_SIZE = 15 * 1024 * 1024;
const ACCEPTED_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);

export function DocumentsPage() {
  const { dealId } = useParams<{ dealId: string }>();
  const [deal, setDeal] = useState<Deal | null>(null);
  const [busyDocId, setBusyDocId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [uploadedFiles, setUploadedFiles] = useState<Record<string, string>>({});

  const load = useCallback(() => {
    if (!dealId) return;
    setLoadError(null);
    return api
      .getDeal(dealId)
      .then((d) => setDeal(d.deal))
      .catch((e) => setLoadError(messageFor(e)));
  }, [dealId]);

  useRefetch(load, (event) => "dealId" in event && event.dealId === dealId);

  async function uploadAndSubmit(documentId: string, file?: File) {
    if (!dealId || !deal || !file) return;
    if (file.size > MAX_FILE_SIZE) {
      setError("Размер файла не должен превышать 15 МБ");
      return;
    }
    if (!ACCEPTED_TYPES.has(file.type)) {
      setError("Поддерживаются PDF, JPG, PNG, DOCX и XLSX");
      return;
    }
    setBusyDocId(documentId);
    setError(null);
    try {
      const uploaded = await api.uploadDocument(dealId, documentId, file);
      setUploadedFiles((current) => ({ ...current, [documentId]: uploaded.filename }));
      await api.submitDocument(dealId, documentId, deal.version);
      await load();
    } catch (e) {
      if (e instanceof ApiError && e.code === "VERSION_CONFLICT") {
        setError("Сделка изменилась, данные обновлены — попробуйте отправить документ ещё раз");
        await load();
      } else {
        setError(messageFor(e));
      }
    } finally {
      setBusyDocId(null);
    }
  }

  if (loadError && !deal) {
    return (
      <div className="field-error" role="alert">
        {loadError}{" "}
        <button className="btn btn-ghost" onClick={load} style={{ marginLeft: 8 }}>Повторить</button>
      </div>
    );
  }
  if (!deal) return <div style={{ color: "var(--text-muted)" }}>Загрузка…</div>;

  return (
    <div>
      <h1 className="page-title">Документооборот · {deal.displayId}</h1>
      <p className="page-subtitle">Загрузите обязательные документы и отправьте их на проверку. Поддерживаются PDF, JPG, PNG, DOCX и XLSX до 15 МБ.</p>
      {loadError && <div className="field-error" role="alert" style={{ marginBottom: 12 }}>{loadError} <button className="btn btn-ghost" onClick={load}>Повторить</button></div>}
      {error && <div className="field-error" role="alert" style={{ marginBottom: 12 }}>{error}</div>}
      <div className="panel document-list">
        {deal.documents.map((doc, i) => (
          <div key={doc.id} data-testid="document-row" data-doc-kind={doc.kind} className="document-row" style={{ borderTop: i === 0 ? "none" : "1px solid var(--line)" }}>
            <div className="document-description">
              <div style={{ fontWeight: 600, fontSize: 14 }}>{doc.name}</div>
              <div style={{ fontSize: 12.5, color: "var(--text-muted)" }}>{doc.purpose}</div>
              {doc.status === "rejected" && doc.rejectReason && <div className="field-error" style={{ marginTop: 4, fontSize: 12 }}>{doc.rejectReason}</div>}
              {uploadedFiles[doc.id] && <div className="document-file-name">Файл: {uploadedFiles[doc.id]}</div>}
              {doc.status !== "missing" && (
                <a className="document-download" href={`/api/deals/${dealId}/documents/${doc.id}/file`} download>
                  Скачать загруженный файл
                </a>
              )}
            </div>
            <div className="document-actions">
              <span className="mono document-status" data-testid="document-status" style={{ color: statusColor[doc.status], borderColor: statusColor[doc.status] }}>
                {statusLabel[doc.status]}
              </span>
              {SUBMITTABLE_STATUSES.includes(doc.status) && (
                <label className="btn btn-secondary document-upload">
                  {busyDocId === doc.id ? "Загружаем…" : "Выбрать и отправить файл"}
                  <input
                    type="file"
                    accept=".pdf,.jpg,.jpeg,.png,.docx,.xlsx"
                    disabled={busyDocId === doc.id}
                    aria-label={`Выбрать файл: ${doc.name}`}
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file) void uploadAndSubmit(doc.id, file);
                      event.currentTarget.value = "";
                    }}
                  />
                </label>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
