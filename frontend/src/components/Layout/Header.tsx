interface HeaderProps {
  unreadCount: number;
  isLive: boolean;
  onOpenNotifications: () => void;
}

export function Header({ unreadCount, isLive, onOpenNotifications }: HeaderProps) {
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
    </header>
  );
}
