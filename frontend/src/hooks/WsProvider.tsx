import { createContext, useContext, useEffect, useRef, useSyncExternalStore, type ReactNode } from "react";
import { authEvents, SESSION_EXPIRED_EVENT } from "../api/client";
import type { WsServerFrame } from "../types/api";

// Потолок и первая задержка экспоненциального backoff'а переподключения.
// Без потолка и без роста задержки обрыв сети превращается в плотный цикл
// переподключений (и заодно в бесполезный DDoS собственного BFF).
const INITIAL_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 30_000;

// Прикладной код закрытия "сессия недействительна" (см. README «Контракт
// для SPA»). Переподключаться с тем же протухшим cookie бессмысленно —
// нужно на экран входа.
const SESSION_CLOSE_CODE = 4401;

// F12 (final review): недопустимый Origin отклоняется прямо на апгрейде
// (403) — клиент никогда не видит 4401 и не получает connection.ack, поэтому
// без потолка попыток индикатор в шапке крутился бы "Подключение…" вечно, а
// это уже не сетевой сбой, а ошибка конфигурации (и план 08 с Traefik
// перед SPA рискует в неё упереться). После стольких подряд неудач без
// единого connection.ack считаем соединение подвисшим и сообщаем об этом,
// не переставая при этом пытаться реконнектиться — сеть может ожить.
const STALLED_AFTER_ATTEMPTS = 5;

export type WsStatus = "connecting" | "live" | "stalled";

interface WsContextValue {
  subscribe: (handler: (frame: WsServerFrame) => void) => () => void;
  getStatus: () => WsStatus;
  subscribeStatus: (onChange: () => void) => () => void;
}

const WsContext = createContext<WsContextValue | null>(null);

/**
 * Единственный WebSocket на всё приложение (F3, final review): раньше
 * AppShell и каждый экран через useRefetch открывали СВОЙ сокет — два
 * сокета, два таймера backoff, удвоенные heartbeat и две волны перезапросов
 * на каждое переподключение. Теперь сокет живёт здесь, а подписчики
 * (useRefetch, шапка со счётчиком непрочитанных) просто регистрируют
 * обработчик через subscribe().
 */
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
            attempt = 0; // успешное подключение — backoff сбрасывается
            setStatus("live");
          }
          handlersRef.current.forEach((h) => h(frame));
        } catch {
          // Битый кадр не должен ронять экран — просто игнорируем его.
        }
      };

      socket.onclose = (event) => {
        if (cancelled) return;

        if (event.code === SESSION_CLOSE_CODE) {
          // Хендшейк уже состоялся (Origin был допустимый), но сессия
          // недействительна — cookie BFF уже погасил на своей стороне,
          // переподключаться с ней бессмысленно.
          authEvents.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT));
          return;
        }

        setStatus(statusRef.current === "live" ? "connecting" : statusRef.current);
        scheduleReconnect();
      };

      // onerror у браузерного WebSocket идёт перед onclose и сам по себе не
      // несёт полезной информации — реального реагирования дожидаемся в
      // onclose, здесь достаточно не дать необработанному событию всплыть.
      socket.onerror = () => {};
    }

    connect();

    return () => {
      cancelled = true;
      if (reconnectTimer !== undefined) clearTimeout(reconnectTimer);
      socket?.close();
    };
  }, []);

  // value не пересоздаётся на каждый рендер (useRef, не useState) — сокет
  // шлёт кадры/heartbeat часто, а identity контекста не должна из-за этого
  // скакать и перерендеривать всё дерево. Статус для конкретных подписчиков
  // (useWsStatus) идёт через useSyncExternalStore, а не через сам value.
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

/** Подписка на кадры единственного сокета — используется useRefetch. */
export function useWsSubscribe(onEvent: (event: WsServerFrame) => void): void {
  const ctx = useWsContext();
  const handlerRef = useRef(onEvent);
  handlerRef.current = onEvent;

  useEffect(() => {
    return ctx.subscribe((frame) => handlerRef.current(frame));
    // ctx.subscribe стабилен на весь жизненный цикл WsProvider — подписка
    // не должна пересоздаваться на каждый ре-рендер вызывающего компонента.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

/**
 * Статус соединения для индикатора в шапке — единственный компонент,
 * которому нужно знать сам факт "живо / нет / подвисло", а не кадры.
 */
export function useWsStatus(): WsStatus {
  const ctx = useWsContext();
  return useSyncExternalStore(ctx.subscribeStatus, ctx.getStatus);
}
