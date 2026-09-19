import { useEffect, useRef } from "react";
import { useWsSubscribe } from "./WsProvider";
import type { DealEvent, WsServerFrame } from "../types/api";

/**
 * Единое правило перезапроса экрана (см. README «Контракт для SPA») —
 * действует на КАЖДОМ экране (F2, final review — раньше было закреплено
 * только за тремя из пяти):
 *
 * - при монтировании — обычная загрузка;
 * - на КАЖДЫЙ connection.ack, включая переподключения после разрыва — между
 *   разрывом и переподключением события теряются безвозвратно (у pub/sub
 *   нет истории), поэтому это единственный сигнал "вы могли что-то
 *   пропустить" и он безусловный, без matches;
 * - на DealEvent, для которого matches(event) вернул true — по умолчанию
 *   (matches не передан) реагирует на любой DealEvent, это безопасный
 *   дефолт для экранов без своего dealId (напр. дашборд).
 *
 * Экран никогда не патчит состояние из полей события — событие лишь
 * триггер, данные всегда приходят из того же REST-эндпоинта, что и при
 * обычной загрузке.
 *
 * Подписывается на единственный сокет приложения через WsProvider (F3,
 * final review) — не открывает свой собственный.
 */
export function useRefetch(reload: () => void, matches?: (event: DealEvent) => boolean): void {
  const reloadRef = useRef(reload);
  reloadRef.current = reload;
  const matchesRef = useRef(matches);
  matchesRef.current = matches;

  useEffect(() => {
    reloadRef.current();
    // Загрузка при монтировании не зависит от identity reload — иначе
    // не-мемоизированный колбэк из вызывающего компонента запускал бы
    // перезапрос на каждый его ре-рендер.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useWsSubscribe((frame: WsServerFrame) => {
    if (frame.type === "connection.ack") {
      reloadRef.current();
      return;
    }
    if (frame.type === "heartbeat") {
      return;
    }
    // Остаётся DealEvent (deal.updated | deal.created | notification.created).
    if (!matchesRef.current || matchesRef.current(frame)) {
      reloadRef.current();
    }
  });
}
