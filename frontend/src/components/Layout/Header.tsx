import { useAuth } from "../../auth/AuthProvider";

interface HeaderProps {
  unreadCount: number;
  isLive: boolean;
  onOpenNotifications: () => void;
}

export function Header({ unreadCount, isLive, onOpenNotifications }: HeaderProps) {
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
      <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: "var(--text-muted)" }}>
        <span
          aria-hidden
          style={{
            width: 7,
            height: 7,
            borderRadius: "50%",
            background: isLive ? "var(--green-600)" : "var(--line-strong)",
          }}
        />
        {isLive ? "Соединение активно" : "Подключение…"}
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
