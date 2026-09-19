import type { Server as HttpServer } from "node:http";
import { WebSocketServer, WebSocket } from "ws";

export type WsEvent =
  | { type: "deal.updated"; dealId: string }
  | { type: "notification.created"; notificationId: string };

let wss: WebSocketServer | null = null;

export function initWebSocketHub(server: HttpServer): void {
  wss = new WebSocketServer({ server, path: "/ws" });

  wss.on("connection", (socket) => {
    socket.send(JSON.stringify({ type: "connection.ack" }));

    const heartbeat = setInterval(() => {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: "heartbeat", at: new Date().toISOString() }));
      }
    }, 25_000);

    socket.on("close", () => clearInterval(heartbeat));
  });
}

export function broadcast(event: WsEvent): void {
  if (!wss) return;
  const payload = JSON.stringify(event);
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  }
}
