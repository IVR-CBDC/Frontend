import { useEffect, useRef } from "react";

type WsEvent =
  | { type: "connection.ack" }
  | { type: "heartbeat"; at: string }
  | { type: "deal.updated"; dealId: string }
  | { type: "notification.created"; notificationId: string };

/**
 * Opens a WebSocket connection to the BFF and calls `onEvent` for every
 * message received, so the dashboard and tracking screens can refresh
 * without the person having to reload the page.
 */
export function useWebSocket(onEvent: (event: WsEvent) => void): void {
  const handlerRef = useRef(onEvent);
  handlerRef.current = onEvent;

  useEffect(() => {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const socket = new WebSocket(`${protocol}//${window.location.host}/ws`);

    socket.onmessage = (message) => {
      try {
        const parsed = JSON.parse(message.data) as WsEvent;
        handlerRef.current(parsed);
      } catch {
        // Ignore malformed frames rather than crashing the UI.
      }
    };

    return () => socket.close();
  }, []);
}
