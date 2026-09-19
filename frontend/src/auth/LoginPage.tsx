import { useState, type FormEvent } from "react";
import { Navigate, useLocation, useNavigate, Link } from "react-router-dom";
import { useAuth } from "./AuthProvider";
import { messageFor } from "../api/errors";

interface LocationState {
  from?: { pathname: string };
}

export function LoginPage() {
  const { status, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [loginValue, setLoginValue] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (status === "authenticated") {
    const from = (location.state as LocationState | null)?.from?.pathname ?? "/";
    return <Navigate to={from} replace />;
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await login({ login: loginValue, password });
      const from = (location.state as LocationState | null)?.from?.pathname ?? "/";
      navigate(from, { replace: true });
    } catch (err) {
      setError(messageFor(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={{ display: "flex", minHeight: "100%", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div className="panel" style={{ padding: 32, width: "100%", maxWidth: 380 }}>
        <h1 className="page-title">Вход</h1>
        <p className="page-subtitle">Личный кабинет для сопровождения внешнеэкономических сделок.</p>

        <form onSubmit={onSubmit} noValidate>
          <div className="field">
            <label htmlFor="login">Логин</label>
            <input
              id="login"
              type="text"
              autoComplete="username"
              value={loginValue}
              onChange={(e) => setLoginValue(e.target.value)}
              required
            />
          </div>

          <div className="field">
            <label htmlFor="password">Пароль</label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>

          {error && <p className="field-error" role="alert">{error}</p>}

          <button type="submit" className="btn btn-primary" disabled={submitting} style={{ width: "100%" }}>
            {submitting ? "Входим…" : "Войти"}
          </button>
        </form>

        <p style={{ marginTop: 18, fontSize: 13, color: "var(--text-muted)" }}>
          Нет учётной записи? <Link to="/register">Зарегистрировать компанию</Link>
        </p>
      </div>
    </div>
  );
}
