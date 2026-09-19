import type { TimelineEvent } from "../../types/deal";

const statusColor: Record<TimelineEvent["status"], string> = {
  done: "var(--green-600)",
  in_progress: "var(--cyan-600)",
  pending: "var(--line-strong)",
  delayed: "var(--red-600)",
};

const statusLabel: Record<TimelineEvent["status"], string> = {
  done: "Завершено",
  in_progress: "В процессе",
  pending: "Ожидает",
  delayed: "Задержка",
};

export function Timeline({ events }: { events: TimelineEvent[] }) {
  return (
    <ol style={{ listStyle: "none", padding: 0, margin: 0 }}>
      {events.map((event, i) => (
        <li key={event.id} style={{ display: "flex", gap: 14, paddingBottom: i === events.length - 1 ? 0 : 22, position: "relative" }}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
            <span
              style={{
                width: 11,
                height: 11,
                borderRadius: "50%",
                background: event.status === "pending" ? "var(--paper-100)" : statusColor[event.status],
                border: `2px solid ${statusColor[event.status]}`,
                flexShrink: 0,
              }}
            />
            {i < events.length - 1 && (
              <span style={{ width: 2, flex: 1, background: "var(--line)", marginTop: 2 }} />
            )}
          </div>

          <div style={{ paddingBottom: 4 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontWeight: 600, fontSize: 14 }}>{event.label}</span>
              <span
                className="mono"
                style={{ fontSize: 10.5, color: statusColor[event.status], border: `1px solid ${statusColor[event.status]}`, borderRadius: 3, padding: "1px 6px" }}
              >
                {statusLabel[event.status]}
              </span>
            </div>
            <div style={{ fontSize: 12.5, color: "var(--text-muted)", marginTop: 2 }}>
              {event.actor}
              {event.timestamp && " · " + new Date(event.timestamp).toLocaleString("ru-RU")}
            </div>
            {event.status === "delayed" && event.delayReason && (
              <div style={{ fontSize: 12.5, color: "var(--red-600)", marginTop: 4 }}>
                Причина задержки: {event.delayReason}
              </div>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}
