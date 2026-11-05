import { createContext, useContext, useEffect, useRef, useSyncExternalStore, type ReactNode } from "react";
import { authEvents, SESSION_EXPIRED_EVENT } from "../api/client";
import type { WsServerFrame } from "../types/api";




const INITIAL_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 30_000;




const SESSION_CLOSE_CODE = 4401;








const STALLED_AFTER_ATTEMPTS = 5;

export type WsStatus = "connecting" | "live" | "stalled";

interface WsContextValue {
  subscribe: (handler: (frame: WsServerFrame) => void) => () => void;
  getStatus: () => WsStatus;
  subscribeStatus: (onChange: () => void) => () => void;
}

const WsContext = createContext<WsContextValue | null>(null);









export function WsProvider({ children }: { children: ReactNode }) {
  const handlersRef = useRef(new Set<(frame: WsServerFrame) => void>());
  const statusRef = useRef<WsStatus>("connecting");
  const listenersRef = useRef(new Set<() => void>());

  useEffect(() => {
    let cancelled = false;
    let socket: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;

    function setStatus(next: WsStatus) {
      if (statusRef.current === next) return;
      statusRef.current = next;
      listenersRef.current.forEach((l) => l());
    }

    function scheduleReconnect() {
      const delay = Math.min(INITIAL_BACKOFF_MS * 2 ** attempt, MAX_BACKOFF_MS);
      attempt += 1;
      if (attempt >= STALLED_AFTER_ATTEMPTS) setStatus("stalled");
      reconnectTimer = setTimeout(connect, delay);
    }

    function connect() {
      if (cancelled) return;
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      socket = new WebSocket(`${protocol}//${window.location.host}/ws`);

      socket.onmessage = (message) => {
        try {
          const frame = JSON.parse(message.data) as WsServerFrame;
          if (frame.type === "connection.ack") {
            attempt = 0; 
            setStatus("live");
          }
          handlersRef.current.forEach((h) => h(frame));
        } catch {
          
        }
      };

      socket.onclose = (event) => {
        if (cancelled) return;

        if (event.code === SESSION_CLOSE_CODE) {
          
          
          
          authEvents.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT));
          return;
        }

        setStatus(statusRef.current === "live" ? "connecting" : statusRef.current);
        scheduleReconnect();
      };

      
      
      
      socket.onerror = () => {};
    }

    connect();

    return () => {
      cancelled = true;
      if (reconnectTimer !== undefined) clearTimeout(reconnectTimer);
      socket?.close();
    };
  }, []);

  
  
  
  
  const valueRef = useRef<WsContextValue>({
    subscribe: (handler) => {
      handlersRef.current.add(handler);
      return () => handlersRef.current.delete(handler);
    },
    getStatus: () => statusRef.current,
    subscribeStatus: (onChange) => {
      listenersRef.current.add(onChange);
      return () => listenersRef.current.delete(onChange);
    },
  });

  return <WsContext.Provider value={valueRef.current}>{children}</WsContext.Provider>;
}

function useWsContext(): WsContextValue {
  const ctx = useContext(WsContext);
  if (!ctx) throw new Error("useWs* должен использоваться внутри WsProvider");
  return ctx;
}


export function useWsSubscribe(onEvent: (event: WsServerFrame) => void): void {
  const ctx = useWsContext();
  const handlerRef = useRef(onEvent);
  handlerRef.current = onEvent;

  useEffect(() => {
    return ctx.subscribe((frame) => handlerRef.current(frame));
    
    
    
  }, []);
}





export function useWsStatus(): WsStatus {
  const ctx = useWsContext();
  return useSyncExternalStore(ctx.subscribeStatus, ctx.getStatus);
}
