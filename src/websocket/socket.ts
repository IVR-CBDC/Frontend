import { io } from "socket.io-client";
export const socket = io(import.meta.env.VITE_WS_URL, {
  transports: ["websocket"],
  reconnection: true,
  reconnectionAttempts: 10,
  reconnectionDelay: 2000
});
