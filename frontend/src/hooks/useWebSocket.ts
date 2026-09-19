import { useEffect, useRef, useState } from "react";
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

/**
 * Открывает WebSocket к BFF и держит его живым: переподключается с
 * нарастающей задержкой при любом разрыве, кроме случая, когда BFF закрыл
 * соединение кодом 4401 (сессия недействительна — тогда путь один, на
 * логин, а не переподключение).
 *
 * `onEvent` получает КАЖДЫЙ кадр как есть — включая connection.ack и
 * heartbeat — потому что правило перезапроса экрана (см. useRefetch) само
 * решает, что с ним делать. Хук не пытается угадать за вызывающего.
 *
 * Возвращает isLive: true между connection.ack и следующим разрывом. Это
 * единственный источник правды для индикатора соединения в шапке — раньше
 * он выставлялся один раз и никогда не гас при разрыве, из-за чего
 * пользователь считал устаревшие данные свежими.
 */
export function useWebSocket(onEvent: (event: WsServerFrame) => void): boolean {
  const handlerRef = useRef(onEvent);
  handlerRef.current = onEvent;
  const [isLive, setIsLive] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let socket: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;

    function scheduleReconnect() {
      const delay = Math.min(INITIAL_BACKOFF_MS * 2 ** attempt, MAX_BACKOFF_MS);
      attempt += 1;
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
            setIsLive(true);
          }
          handlerRef.current(frame);
        } catch {
          // Битый кадр не должен ронять экран — просто игнорируем его.
        }
      };

      socket.onclose = (event) => {
        setIsLive(false);
        if (cancelled) return;

        if (event.code === SESSION_CLOSE_CODE) {
          // Хендшейк уже состоялся (Origin был допустимый), но сессия
          // недействительна — cookie BFF уже погасил на своей стороне,
          // переподключаться с ней бессмысленно.
          authEvents.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT));
          return;
        }

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

  return isLive;
}
