import { useEffect, useRef } from "react";
import { useWsSubscribe } from "./WsProvider";
import type { DealEvent, WsServerFrame } from "../types/api";






















export function useRefetch(reload: () => void, matches?: (event: DealEvent) => boolean): void {
  const reloadRef = useRef(reload);
  reloadRef.current = reload;
  const matchesRef = useRef(matches);
  matchesRef.current = matches;

  useEffect(() => {
    reloadRef.current();
    
    
    
    
  }, []);

  useWsSubscribe((frame: WsServerFrame) => {
    if (frame.type === "connection.ack") {
      reloadRef.current();
      return;
    }
    if (frame.type === "heartbeat") {
      return;
    }
    
    if (!matchesRef.current || matchesRef.current(frame)) {
      reloadRef.current();
    }
  });
}
