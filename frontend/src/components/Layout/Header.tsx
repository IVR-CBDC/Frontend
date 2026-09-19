import { useAuth } from "../../auth/AuthProvider";
import type { WsStatus } from "../../hooks/WsProvider";

interface HeaderProps {
  unreadCount: number;
  wsStatus: WsStatus;
  onOpenNotifications: () => void;
}

// F12 (final review): "stalled" — соединение не смогло подняться N попыток
// подряд ни разу не увидев connection.ack. Для обычного обрыва сети
// "Подключение…" достаточно (переподключение вот-вот сработает), но для
// зависшего состояния (например, недопустимый Origin, отклоняемый на
// апгрейде) пользователю нужно явно сказать, что данные могут быть
// устаревшими — иначе он бесконечно доверяет индикатору, который никогда
// не станет зелёным.
const STATUS_LABEL: Record<WsStatus, string> = {
  live: "Соединение активно",
  connecting: "Подключение…",
  stalled: "Нет соединения — данные могут быть устаревшими",
};

export function Header({ unreadCount, wsStatus, onOpenNotifications }: HeaderProps) {
  const { user, company, logout } = useAuth();

  return (
    <header
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "14px 32px",
        borderBottom: "1px solid var(--line)",
        background: "var(--paper-100)",
      }}
    >
      <div
        style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: "var(--text-muted)" }}
        role={wsStatus === "stalled" ? "alert" : undefined}
      >
        <span
          aria-hidden
          style={{
            width: 7,
            height: 7,
            borderRadius: "50%",
            background:
              wsStatus === "live" ? "var(--green-600)" : wsStatus === "stalled" ? "var(--red-600)" : "var(--line-strong)",
          }}
        />
        {STATUS_LABEL[wsStatus]}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
        {user && (
          <div style={{ textAlign: "right", fontSize: 12.5, lineHeight: 1.4 }}>
            <div style={{ fontWeight: 500 }}>{user.name || user.login}</div>
            {company && (
              <div className="mono" style={{ color: "var(--text-muted)", fontSize: 11.5 }}>
                {company.name}
              </div>
            )}
          </div>
        )}

        <button
          className="btn btn-ghost"
          onClick={onOpenNotifications}
          aria-label={`Уведомления, непрочитанных: ${unreadCount}`}
        >
          Уведомления
          {unreadCount > 0 && (
            <span
              className="mono"
              style={{
                background: "var(--red-600)",
                color: "white",
                borderRadius: 10,
                fontSize: 11,
                padding: "1px 7px",
              }}
            >
              {unreadCount}
            </span>
          )}
        </button>

        <button className="btn btn-secondary" onClick={() => void logout()}>
          Выйти
        </button>
      </div>
    </header>
  );
}
