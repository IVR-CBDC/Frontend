import { useCallback, useState } from "react";

export interface Toast {
  id: string;
  severity: "info" | "warning" | "critical";
  message: string;
}

let counter = 0;

export function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const push = useCallback((severity: Toast["severity"], message: string) => {
    const id = `toast-${++counter}`;
    setToasts((prev) => [...prev, { id, severity, message }]);
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 6000);
  }, []);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return { toasts, push, dismiss };
}
