import { useEffect, useState } from "react";
import { api } from "../../api/client";
import { ApiError, messageFor } from "../../api/errors";
import type { NotificationItem } from "../../types/api";

const severityColor: Record<NotificationItem["severity"], string> = {
  info: "var(--cyan-600)",
  warning: "var(--amber-500)",
  critical: "var(--red-600)",
};

interface Props {
  open: boolean;
  onClose: () => void;
  refreshKey: number;
  // Сообщает наверх, что уведомление отмечено прочитанным — так шапка может
  // уменьшить бейдж непрочитанных, не гоняя из-за одного клика отдельный
  // перезапрос всего дашборда.
  onRead?: (id: string) => void;
}

export function NotificationsDrawer({ open, onClose, refreshKey, onRead }: Props) {
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  // F7 (final review): раньше getNotifications вызывался вообще без
  // .catch — при неудаче ящик молча оставался с пустым items и показывал
  // "Пока пусто", что хуже ошибки: это утверждение неправды (в реальности
  // список мог быть непустым, просто не загрузился).
  useEffect(() => {
    if (!open) return;
    setError(null);
    api
      .getNotifications()
      .then((d) => setItems(d.notifications))
      .catch((e) => setError(messageFor(e)));
  }, [open, refreshKey]);

  async function markRead(id: string) {
    try {
      await api.markNotificationRead(id);
    } catch (e) {
      // 404 — уведомление на бэкенде уже недоступно (например, устарело
      // между открытием дровера и кликом). Для пользователя результат тот
      // же: он его больше не видит непрочитанным, поэтому это не сбой.
      // Любая другая ошибка — не трогаем локальное состояние, пусть
      // пробует ещё раз.
      if (!(e instanceof ApiError && e.status === 404)) return;
    }
    setItems((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
    onRead?.(id);
  }

  if (!open) return null;

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        right: 0,
        bottom: 0,
        width: 340,
        background: "var(--paper-100)",
        borderLeft: "1px solid var(--line)",
        boxShadow: "-8px 0 20px rgba(11,31,58,0.08)",
        zIndex: 90,
        display: "flex",
        flexDirection: "column",
      }}
      role="dialog"
      aria-label="Уведомления"
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: 18, borderBottom: "1px solid var(--line)" }}>
        <strong>Уведомления</strong>
        <button className="btn btn-ghost" onClick={onClose} aria-label="Закрыть">✕</button>
      </div>

      <div style={{ overflowY: "auto", flex: 1 }}>
        {error && (
          <div className="field-error" role="alert" style={{ padding: 18 }}>
            {error}
          </div>
        )}
        {!error && items.length === 0 && (
          <div style={{ padding: 18, color: "var(--text-muted)" }}>Пока пусто.</div>
        )}
        {items.map((n) => (
          <div
            key={n.id}
            style={{
              padding: "14px 18px",
              borderBottom: "1px solid var(--line)",
              borderLeft: `3px solid ${severityColor[n.severity]}`,
              opacity: n.read ? 0.55 : 1,
            }}
          >
            <div style={{ fontSize: 13 }}>{n.message}</div>
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8 }}>
              <span className="mono" style={{ fontSize: 11, color: "var(--text-muted)" }}>
                {new Date(n.createdAt).toLocaleString("ru-RU")}
              </span>
              {!n.read && (
                <button className="btn btn-ghost" style={{ fontSize: 11.5, padding: "2px 6px" }} onClick={() => markRead(n.id)}>
                  Прочитано
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
