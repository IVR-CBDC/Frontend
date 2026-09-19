import { useState, type FormEvent } from "react";
import { Navigate, Link, useNavigate } from "react-router-dom";
import { useAuth } from "./AuthProvider";
import { messageFor } from "../api/errors";

const INN_PATTERN = /^\d{10}$/;

export function RegisterPage() {
  const { status, register } = useAuth();
  const navigate = useNavigate();

  const [loginValue, setLoginValue] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [inn, setInn] = useState("");
  const [innError, setInnError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (status === "authenticated") {
    return <Navigate to="/" replace />;
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();

    if (!INN_PATTERN.test(inn)) {
      setInnError("ИНН должен состоять из 10 цифр");
      return;
    }
    setInnError(null);

    setSubmitting(true);
    setError(null);
    try {
      await register({
        login: loginValue,
        password,
        name: name.trim() || undefined,
        company_name: companyName,
        inn,
      });
      navigate("/", { replace: true });
    } catch (err) {
      setError(messageFor(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={{ display: "flex", minHeight: "100%", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div className="panel" style={{ padding: 32, width: "100%", maxWidth: 420 }}>
        <h1 className="page-title">Регистрация компании</h1>
        <p className="page-subtitle">Создайте учётную запись компании, чтобы вести сделки в личном кабинете.</p>

        <form onSubmit={onSubmit} noValidate>
          <div className="field">
            <label htmlFor="companyName">Название компании</label>
            <input
              id="companyName"
              type="text"
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              required
            />
          </div>

          <div className="field">
            <label htmlFor="inn">ИНН</label>
            <input
              id="inn"
              type="text"
              inputMode="numeric"
              value={inn}
              onChange={(e) => {
                setInn(e.target.value);
                // Подсказка про формат ИНН иначе висит до следующего submit,
                // даже когда пользователь уже её исправляет.
                if (innError) setInnError(null);
              }}
              required
            />
            {innError && <span className="field-error">{innError}</span>}
          </div>

          <div className="field">
            <label htmlFor="name">Имя контактного лица (необязательно)</label>
            <input id="name" type="text" value={name} onChange={(e) => setName(e.target.value)} />
          </div>

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
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>

          {error && <p className="field-error" role="alert">{error}</p>}

          <button type="submit" className="btn btn-primary" disabled={submitting} style={{ width: "100%" }}>
            {submitting ? "Регистрируем…" : "Зарегистрироваться"}
          </button>
        </form>

        <p style={{ marginTop: 18, fontSize: 13, color: "var(--text-muted)" }}>
          Уже есть учётная запись? <Link to="/login">Войти</Link>
        </p>
      </div>
    </div>
  );
}
