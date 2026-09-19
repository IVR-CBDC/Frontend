import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../../api/client";
import { COUNTRIES, CURRENCIES } from "../../constants/countries";
import type { CreateDealInput, OperationType } from "../../types/api";
import { ApiError, messageFor } from "../../api/errors";

// Черновик мастера переживает перезагрузку страницы (незакоммиченная форма
// на середине шага — обычная потеря для многошагового мастера) и стирается
// после успешного создания сделки, чтобы не подсовывать пользователю старые
// данные при следующем визите на /deals/new.
const DRAFT_KEY = "draft:new-deal";

type Errors = Partial<Record<keyof CreateDealInput, string>>;

const steps = ["Страна контрагента", "Тип операции", "Сумма и валюта", "Данные контрагента"] as const;

const EMPTY_FORM: CreateDealInput = {
  counterpartyCountry: "",
  operationType: "import",
  amount: 0,
  currency: "RUB",
  counterpartyName: "",
};

function loadDraft(): { form: CreateDealInput; step: number } | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { form: CreateDealInput; step: number };
    if (!parsed || typeof parsed !== "object" || !parsed.form) return null;
    return parsed;
  } catch {
    // Битый JSON в localStorage не должен ронять мастер — просто начинаем с чистого листа.
    return null;
  }
}

// Сумма приходит из <input type="number">, поэтому строим строку сами, а не
// парсим event.target.value — так надёжнее ловим "больше двух знаков после
// запятой" независимо от того, как браузер округлил число внутри.
function amountError(amount: number, raw: string): string | null {
  if (!amount || amount <= 0) return "Укажите сумму больше нуля";
  // F14 (final review): раньше count шёл по raw.split(".") — для
  // экспоненциальной записи ("1e-5", валидной для <input type="number">)
  // там нет точки вовсе, и проверка молча пропускала пять фактических
  // знаков после запятой.
  if (/e/i.test(raw)) return "Сумма: укажите число без экспоненциальной записи";
  const decimals = raw.includes(".") ? raw.split(".")[1]?.length ?? 0 : 0;
  if (decimals > 2) return "Сумма: не более двух знаков после запятой";
  return null;
}

export function CreateDealWizard() {
  const navigate = useNavigate();
  // F14 (final review): loadDraft() парсит localStorage и JSON.parse на
  // каждый рендер компонента — незачем, черновик читается ровно один раз,
  // при монтировании.
  const [draft] = useState(() => loadDraft());
  const [step, setStep] = useState(draft?.step ?? 0);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Errors>({});
  const [form, setForm] = useState<CreateDealInput>(draft?.form ?? EMPTY_FORM);
  const [amountRaw, setAmountRaw] = useState(draft?.form.amount ? String(draft.form.amount) : "");

  // Сохраняем черновик на каждое изменение формы/шага — восстановление
  // работает при пере-монтировании компонента (переход на другой экран и
  // обратно) и при полной перезагрузке страницы.
  useEffect(() => {
    localStorage.setItem(DRAFT_KEY, JSON.stringify({ form, step }));
  }, [form, step]);

  function validateStep(current: number): boolean {
    const next: Errors = {};
    if (current === 0 && !form.counterpartyCountry) next.counterpartyCountry = "Выберите страну контрагента";
    if (current === 2) {
      const err = amountError(form.amount, amountRaw);
      if (err) next.amount = err;
      if (!form.currency) next.currency = "Выберите валюту";
    }
    if (current === 3 && !form.counterpartyName.trim()) next.counterpartyName = "Укажите название контрагента";
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  function goNext() {
    if (!validateStep(step)) return;
    if (step < steps.length - 1) {
      setStep(step + 1);
      return;
    }
    // F14 (final review): проверяем ВСЕ шаги перед отправкой, не только
    // текущий (последний) — восстановленный черновик мог быть сохранён на
    // шаге 3 с пустым полем более раннего шага (например, страна),
    // и такой черновик раньше уходил на сервер как есть.
    for (let s = 0; s < steps.length; s++) {
      if (!validateStep(s)) {
        setStep(s);
        return;
      }
    }
    void submit();
  }

  async function submit() {
    setSubmitting(true);
    setSubmitError(null);
    try {
      const { deal } = await api.createDeal(form);
      localStorage.removeItem(DRAFT_KEY);
      navigate(`/deals/${deal.id}/scenario`);
    } catch (e) {
      // F9 (final review): ветвимся по code, а не по инстансу Error —
      // messageFor существует именно для того, чтобы не тащить в интерфейс
      // произвольный e.message (для не-ApiError он был бы на английском,
      // см. api/errors.ts). Для VALIDATION_ERROR нужен текст, который
      // прислал BFF (в нём разные причины: неподдерживаемый коридор,
      // дробная сумма и т.д.) — ApiError.message это и есть body.error
      // сервера (см. api/client.ts).
      setSubmitError(e instanceof ApiError && e.code === "VALIDATION_ERROR" ? e.message : messageFor(e));
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

      {/* F14 (final review): раньше это был не <form> — Enter в поле ничего
          не делал. Кнопки шагов вперёд/отправки теперь submit, "Назад" —
          явно type="button", чтобы не триггерить submit. */}
      <form
        className="panel"
        style={{ padding: 24, maxWidth: 480 }}
        onSubmit={(e) => {
          e.preventDefault();
          goNext();
        }}
        noValidate
      >
        {step === 0 && (
          <div className="field">
            <label htmlFor="country">Страна контрагента</label>
            <select
              id="country"
              value={form.counterpartyCountry}
              onChange={(e) => {
                setForm({ ...form, counterpartyCountry: e.target.value });
                // F14 (final review): подсказка об ошибке иначе висит до
                // следующего submit, даже когда пользователь её уже исправляет
                // (тот же паттерн, что на экране регистрации).
                if (errors.counterpartyCountry) setErrors({ ...errors, counterpartyCountry: undefined });
              }}
              aria-invalid={!!errors.counterpartyCountry}
              aria-describedby={errors.counterpartyCountry ? "country-error" : undefined}
            >
              <option value="">Выберите страну</option>
              {COUNTRIES.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name}
                </option>
              ))}
            </select>
            {errors.counterpartyCountry && (
              <span id="country-error" className="field-error" role="alert">
                {errors.counterpartyCountry}
              </span>
            )}
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
                step="0.01"
                value={amountRaw}
                onChange={(e) => {
                  const raw = e.target.value;
                  setAmountRaw(raw);
                  setForm({ ...form, amount: Number(raw) || 0 });
                  if (errors.amount) setErrors({ ...errors, amount: undefined });
                }}
                aria-invalid={!!errors.amount}
                aria-describedby={errors.amount ? "amount-error" : undefined}
              />
              {errors.amount && (
                <span id="amount-error" className="field-error" role="alert">
                  {errors.amount}
                </span>
              )}
            </div>
            <div className="field">
              <label htmlFor="currency">Валюта</label>
              <select id="currency" value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })}>
                {CURRENCIES.map((c) => (
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
              onChange={(e) => {
                setForm({ ...form, counterpartyName: e.target.value });
                if (errors.counterpartyName) setErrors({ ...errors, counterpartyName: undefined });
              }}
              aria-invalid={!!errors.counterpartyName}
              aria-describedby={errors.counterpartyName ? "counterpartyName-error" : undefined}
            />
            {errors.counterpartyName && (
              <span id="counterpartyName-error" className="field-error" role="alert">
                {errors.counterpartyName}
              </span>
            )}
          </div>
        )}

        {submitError && (
          <div className="field-error" role="alert" style={{ marginBottom: 12 }}>
            {submitError}
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8 }}>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => setStep(Math.max(0, step - 1))}
            disabled={step === 0}
          >
            Назад
          </button>
          <button type="submit" className="btn btn-primary" disabled={submitting}>
            {step === steps.length - 1 ? (submitting ? "Создаём…" : "Создать сделку") : "Далее"}
          </button>
        </div>
      </form>
    </div>
  );
}
