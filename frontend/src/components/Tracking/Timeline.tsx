import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { TimelineEvent } from "../../types/api";

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

const ESTIMATED_ROW_HEIGHT = 112;
const OVERSCAN = 280;

function TimelineRow({
  event,
  last,
  top,
  onHeight,
}: {
  event: TimelineEvent;
  last: boolean;
  top: number;
  onHeight: (seq: number, height: number) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const rowRef = useRef<HTMLLIElement>(null);

  useEffect(() => {
    const element = rowRef.current;
    if (!element) return;
    const measure = () => onHeight(event.seq, element.getBoundingClientRect().height);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [event.seq, onHeight, expanded]);

  const timestamp = event.finishedAt || event.startedAt;

  return (
    <li
      ref={rowRef}
      style={{
        position: "absolute",
        top,
        left: 0,
        right: 0,
        display: "flex",
        gap: 14,
        paddingBottom: 18,
        minHeight: ESTIMATED_ROW_HEIGHT,
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", flexShrink: 0 }}>
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
        {!last && <span style={{ width: 2, flex: 1, background: "var(--line)", marginTop: 2 }} />}
      </div>
      <div style={{ minWidth: 0, flex: 1, paddingBottom: 4 }}>
        <button
          type="button"
          className="timeline-event-toggle"
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
        >
          <span style={{ fontWeight: 600, fontSize: 14, textAlign: "left" }}>{event.label}</span>
          <span
            className="mono"
            style={{
              fontSize: 10.5,
              color: statusColor[event.status],
              border: `1px solid ${statusColor[event.status]}`,
              borderRadius: 3,
              padding: "1px 6px",
              whiteSpace: "nowrap",
            }}
          >
            {statusLabel[event.status]}
          </span>
          <span className="timeline-expand-indicator">{expanded ? "Скрыть" : "Подробнее"}</span>
        </button>
        {expanded && (
          <div className="timeline-event-details">
            <div>{event.actor}</div>
            {timestamp && <div>{new Date(timestamp).toLocaleString("ru-RU")}</div>}
            {event.status === "delayed" && event.delayReason && (
              <div className="timeline-delay">Причина задержки: {event.delayReason}</div>
            )}
          </div>
        )}
      </div>
    </li>
  );
}

export function Timeline({ events }: { events: TimelineEvent[] }) {
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(560);
  const [heights, setHeights] = useState<Record<number, number>>({});
  const viewportRef = useRef<HTMLDivElement>(null);

  const offsets = useMemo(() => {
    let position = 0;
    return events.map((event) => {
      const current = position;
      position += heights[event.seq] ?? ESTIMATED_ROW_HEIGHT;
      return current;
    });
  }, [events, heights]);

  const totalHeight = useMemo(
    () => events.reduce((sum, event) => sum + (heights[event.seq] ?? ESTIMATED_ROW_HEIGHT), 0),
    [events, heights],
  );

  const visible = useMemo(() => {
    const start = Math.max(0, offsets.findIndex((offset, index) => offset + (heights[events[index]?.seq] ?? ESTIMATED_ROW_HEIGHT) >= scrollTop - OVERSCAN));
    const endOffset = scrollTop + viewportHeight + OVERSCAN;
    let end = start;
    while (end < events.length && offsets[end] < endOffset) end += 1;
    return events.slice(start, Math.min(events.length, end + 1)).map((event, index) => ({
      event,
      index: start + index,
      top: offsets[start + index],
    }));
  }, [events, heights, offsets, scrollTop, viewportHeight]);

  const onHeight = useCallback((seq: number, height: number) => {
    setHeights((current) => current[seq] === height ? current : { ...current, [seq]: height });
  }, []);

  useEffect(() => {
    const element = viewportRef.current;
    if (!element) return;
    const update = () => setViewportHeight(element.clientHeight);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  if (events.length === 0) return <p className="empty-state">Событий пока нет.</p>;

  return (
    <div
      ref={viewportRef}
      className="timeline-viewport"
      onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
      style={{ maxHeight: 680, overflowY: events.length > 6 ? "auto" : "visible" }}
    >
      <ol style={{ listStyle: "none", padding: 0, margin: 0, height: totalHeight, position: "relative" }}>
        {visible.map(({ event, index, top }) => (
          <TimelineRow
            key={event.seq}
            event={event}
            last={index === events.length - 1}
            top={top}
            onHeight={onHeight}
          />
        ))}
      </ol>
    </div>
  );
}
