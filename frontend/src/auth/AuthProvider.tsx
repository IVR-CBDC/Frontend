import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api, authEvents, SESSION_EXPIRED_EVENT, type Company, type LoginInput, type RegisterInput } from "../api/client";

export type AuthStatus = "loading" | "authenticated" | "anonymous";

export interface AuthUser {
  userId: string;
  login: string;
  name: string;
}

interface AuthContextValue {
  status: AuthStatus;
  user: AuthUser | null;
  company: Company | null;
  login: (input: LoginInput) => Promise<void>;
  register: (input: RegisterInput) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [user, setUser] = useState<AuthUser | null>(null);
  const [company, setCompany] = useState<Company | null>(null);

  const clearSession = useCallback(() => {
    setUser(null);
    setCompany(null);
    setStatus("anonymous");
  }, []);

  const loadProfile = useCallback(async () => {
    const me = await api.auth.me();
    setUser({ userId: me.user_id, login: me.login, name: me.name });
    setCompany(me.company);
    setStatus("authenticated");
  }, []);

  // При старте приложения проверяем, есть ли ещё живая сессия по cookie.
  // 401 здесь — это норма («не вошли»), а не ошибка, которую нужно
  // показывать пользователю. Статус loading обязателен: без него защищённые
  // маршруты на миг решат, что пользователь anonymous, и моргнут редиректом
  // на /login при каждой перезагрузке страницы.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await loadProfile();
      } catch {
        if (!cancelled) clearSession();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadProfile, clearSession]);

  // Любой запрос где-либо в приложении, получивший 401
  // TOKEN_EXPIRED/INVALID_TOKEN/UNAUTHORIZED, сигналит через этот event bus
  // (см. api/client.ts) — BFF уже погасил cookie, нам остаётся только
  // перевести состояние в anonymous.
  useEffect(() => {
    const onSessionExpired = () => clearSession();
    authEvents.addEventListener(SESSION_EXPIRED_EVENT, onSessionExpired);
    return () => authEvents.removeEventListener(SESSION_EXPIRED_EVENT, onSessionExpired);
  }, [clearSession]);

  const login = useCallback(
    async (input: LoginInput) => {
      await api.auth.login(input);
      await loadProfile();
    },
    [loadProfile],
  );

  const register = useCallback(
    async (input: RegisterInput) => {
      await api.auth.register(input);
      await loadProfile();
    },
    [loadProfile],
  );

  const logout = useCallback(async () => {
    try {
      await api.auth.logout();
    } finally {
      // Логаут идемпотентен на стороне BFF (см. bff/src/routes/auth.ts) —
      // локальное состояние гасим в любом случае.
      clearSession();
    }
  }, [clearSession]);

  return (
    <AuthContext.Provider value={{ status, user, company, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth должен использоваться внутри AuthProvider");
  return ctx;
}
