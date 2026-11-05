import type { Toast } from "../../hooks/useToasts";

const severityColor: Record<Toast["severity"], string> = {
  info: "var(--cyan-600)",
  warning: "var(--amber-500)",
  critical: "var(--red-600)",
};

interface Props {
  toasts: Toast[];
  onDismiss: (id: string) => void;
}

export function ToastContainer({ toasts, onDismiss }: Props) {
  if (toasts.length === 0) return null;

  return (
    <div
      style={{
        position: "fixed",
        bottom: 20,
        right: 20,
        display: "flex",
        flexDirection: "column",
        gap: 8,
        zIndex: 100,
        width: 320,
      }}
      role="status"
      aria-live="polite"
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className="panel"
          style={{
            padding: "12px 14px",
            borderLeft: `3px solid ${severityColor[toast.severity]}`,
            display: "flex",
            justifyContent: "space-between",
            gap: 10,
            boxShadow: "0 4px 14px rgba(11,31,58,0.12)",
          }}
        >
          <span style={{ fontSize: 13 }}>{toast.message}</span>
          <button
            className="btn-ghost"
            style={{ border: "none", background: "none", cursor: "pointer", color: "var(--text-muted)" }}
            onClick={() => onDismiss(toast.id)}
            aria-label="Скрыть уведомление"
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
