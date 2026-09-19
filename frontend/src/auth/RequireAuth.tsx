import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "./AuthProvider";

// Обёртка защищённого маршрута: пока идёт первичная проверка сессии — ничего
// не решаем (без этого при каждой перезагрузке страницы был бы виден
// редирект-моргание на /login, пока не пришёл ответ /auth/me).
export function RequireAuth({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const location = useLocation();

  // F13 (final review): при loading раньше рендерился null — страница была
  // пуста, и e2e (план 07) ждать было решительно нечего: ни узла, чтобы
  // проверить "приложение ещё грузится", ни узла, чтобы дождаться перехода
  // в готовность. data-app-status держит статус на одном и том же узле во
  // всех трёх состояниях (display: contents — обёртка не участвует в
  // layout, только несёт атрибут).
  return (
    <div data-app-status={status} style={{ display: "contents" }}>
      {status === "anonymous" && (
        // Запоминаем, куда шли, чтобы после входа вернуть пользователя туда же.
        <Navigate to="/login" replace state={{ from: location }} />
      )}
      {status === "authenticated" && children}
    </div>
  );
}
