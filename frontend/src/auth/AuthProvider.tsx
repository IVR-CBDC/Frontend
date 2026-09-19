import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
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
  // Обработчику session-expired нужен АКТУАЛЬНЫЙ статус в момент события, а
  // не тот, что был на момент подписки — ref, а не замыкание на state.
  const statusRef = useRef(status);
  statusRef.current = status;

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

  // Любой запрос где-либо в приложении, получивший 401 (любой код — см.
  // api/client.ts), сигналит через этот event bus. Реагируем по текущему
  // статусу (F1, final review — раньше решение принимал client.ts по code,
  // а доминирующий в проде код истечения сессии — как раз UNAUTHORIZED):
  //
  // - status === "loading": это стартовый /auth/me непонятно ещё вошедшего
  //   пользователя — его собственный catch в эффекте ниже и так вызовет
  //   clearSession, реагировать здесь ещё раз не нужно (и не вредно, но
  //   избыточно);
  // - status === "authenticated": единственный случай, когда 401 значит
  //   "сессия была, но перестала быть валидной" — cookie уже мертва на
  //   стороне BFF, остаётся перевести приложение в anonymous;
  // - status === "anonymous": 401 при логине/регистрации — обычная бизнес-
  //   ошибка (неверный пароль и т.п.), её показывает форма через
  //   messageFor, а не этот механизм.
  useEffect(() => {
    const onSessionExpired = () => {
      if (statusRef.current === "authenticated") clearSession();
    };
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
