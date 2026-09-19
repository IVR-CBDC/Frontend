import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "./AuthProvider";

// Обёртка защищённого маршрута: пока идёт первичная проверка сессии — ничего
// не решаем (без этого при каждой перезагрузке страницы был бы виден
// редирект-моргание на /login, пока не пришёл ответ /auth/me).
export function RequireAuth({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const location = useLocation();

  if (status === "loading") {
    return null;
  }

  if (status === "anonymous") {
    // Запоминаем, куда шли, чтобы после входа вернуть пользователя туда же.
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  return <>{children}</>;
}
