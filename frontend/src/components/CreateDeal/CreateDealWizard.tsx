import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../../api/client";
import type { CreateDealInput, OperationType } from "../../types/deal";

const countries = ["Китай", "Турция", "Индия", "ОАЭ", "Казахстан", "Беларусь", "Вьетнам"];
const currencies = ["RUB", "USD", "CNY", "AED", "INR"];

type Errors = Partial<Record<keyof CreateDealInput, string>>;

const steps = ["Страна контрагента", "Тип операции", "Сумма и валюта", "Данные контрагента"] as const;

export function CreateDealWizard() {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Errors>({});
  const [form, setForm] = useState<CreateDealInput>({
    counterpartyCountry: "",
    operationType: "import",
    amount: 0,
    currency: "RUB",
    counterpartyName: "",
  });

  function validateStep(current: number): boolean {
    const next: Errors = {};
    if (current === 0 && !form.counterpartyCountry) next.counterpartyCountry = "Выберите страну контрагента";
    if (current === 2) {
      if (!form.amount || form.amount <= 0) next.amount = "Укажите сумму больше нуля";
      if (!form.currency) next.currency = "Выберите валюту";
    }
    if (current === 3 && !form.counterpartyName.trim()) next.counterpartyName = "Укажите название контрагента";
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  function goNext() {
    if (!validateStep(step)) return;
    if (step < steps.length - 1) setStep(step + 1);
    else void submit();
  }

  async function submit() {
    setSubmitting(true);
    setSubmitError(null);
    try {
      const { deal } = await api.createDeal(form);
      navigate(`/deals/${deal.id}/scenario`);
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : "Не удалось создать сделку");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <h1 className="page-title">Новая сделка</h1>
      <p className="page-subtitle">Заполните данные по шагам — это снижает риск ошибки во вводе.</p>

      <ol style={{ display: "flex", gap: 6, listStyle: "none", padding: 0, marginBottom: 24 }}>
        {steps.map((label, i) => (
          <li
            key={label}
            className="mono"
            style={{
              fontSize: 11.5,
              padding: "5px 10px",
              borderRadius: 3,
              background: i === step ? "var(--ink-900)" : i < step ? "var(--paper-100)" : "transparent",
              color: i === step ? "white" : i < step ? "var(--green-600)" : "var(--text-muted)",
              border: i <= step ? "1px solid transparent" : "1px solid var(--line)",
            }}
          >
            {i + 1}. {label}
          </li>
        ))}
      </ol>

      <div className="panel" style={{ padding: 24, maxWidth: 480 }}>
        {step === 0 && (
          <div className="field">
            <label htmlFor="country">Страна контрагента</label>
            <select
              id="country"
              value={form.counterpartyCountry}
              onChange={(e) => setForm({ ...form, counterpartyCountry: e.target.value })}
            >
              <option value="">Выберите страну</option>
              {countries.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            {errors.counterpartyCountry && <span className="field-error">{errors.counterpartyCountry}</span>}
          </div>
        )}

        {step === 1 && (
          <div className="field">
            <label>Тип операции</label>
            <div style={{ display: "flex", gap: 10 }}>
              {(["import", "export"] as OperationType[]).map((type) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => setForm({ ...form, operationType: type })}
                  className={form.operationType === type ? "btn btn-primary" : "btn btn-secondary"}
                >
                  {type === "import" ? "Импорт" : "Экспорт"}
                </button>
              ))}
            </div>
          </div>
        )}

        {step === 2 && (
          <>
            <div className="field">
              <label htmlFor="amount">Сумма сделки</label>
              <input
                id="amount"
                type="number"
                min={0}
                value={form.amount || ""}
                onChange={(e) => setForm({ ...form, amount: Number(e.target.value) })}
              />
              {errors.amount && <span className="field-error">{errors.amount}</span>}
            </div>
            <div className="field">
              <label htmlFor="currency">Валюта</label>
              <select id="currency" value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })}>
                {currencies.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
          </>
        )}

        {step === 3 && (
          <div className="field">
            <label htmlFor="counterpartyName">Название контрагента</label>
            <input
              id="counterpartyName"
              type="text"
              placeholder="Например, Shenzhen Bay Trading Co."
              value={form.counterpartyName}
              onChange={(e) => setForm({ ...form, counterpartyName: e.target.value })}
            />
            {errors.counterpartyName && <span className="field-error">{errors.counterpartyName}</span>}
          </div>
        )}

        {submitError && <div className="field-error" style={{ marginBottom: 12 }}>{submitError}</div>}

        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8 }}>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => setStep(Math.max(0, step - 1))}
            disabled={step === 0}
          >
            Назад
          </button>
          <button type="button" className="btn btn-primary" onClick={goNext} disabled={submitting}>
            {step === steps.length - 1 ? (submitting ? "Создаём…" : "Создать сделку") : "Далее"}
          </button>
        </div>
      </div>
    </div>
  );
}
