import { useCallback, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../../api/client";
import { ApiError, messageFor } from "../../api/errors";
import type { ScenarioCard, SettlementScenario } from "../../types/api";
import { useRefetch } from "../../hooks/useRefetch";

function costLabel(option: ScenarioCard): string {
  if (!option.available) return option.unavailableReason ?? "Недоступно";
  if (!option.commission) return "Уточняется";
  return new Intl.NumberFormat("ru-RU").format(option.commission.total);
}

export function ScenarioPage() {
  const { dealId } = useParams<{ dealId: string }>();
  const navigate = useNavigate();
  const [scenarios, setScenarios] = useState<ScenarioCard[] | null>(null);
  // Версия сделки нужна для оптимистической блокировки при POST .../scenario
  // (иначе core отвечает 409 VERSION_CONFLICT) — берём её из GET .../deals/:id,
  // т.к. GET .../scenarios её не отдаёт (см. README «Контракт для SPA»).
  const [dealVersion, setDealVersion] = useState<number | null>(null);
  const [selected, setSelected] = useState<SettlementScenario | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Недоступность service-commission (503 UPSTREAM_UNAVAILABLE) — это
  // состояние всего экрана, а не отдельной карточки (план 05: BFF отвечает
  // 503 на весь ответ, карточками available:false такое не размечается),
  // поэтому у него отдельная ветка рендера с кнопкой "Повторить", а не общий
  // блок ошибки подтверждения.
  const [loadUnavailable, setLoadUnavailable] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!dealId) return;
    setLoadUnavailable(false);
    setLoadError(null);
    setScenarios(null);
    Promise.all([api.getDeal(dealId), api.getScenarios(dealId)])
      .then(([dealRes, scenariosRes]) => {
        setDealVersion(dealRes.deal.version);
        setScenarios(scenariosRes.scenarios);
      })
      .catch((e) => {
        if (e instanceof ApiError && e.code === "UPSTREAM_UNAVAILABLE") {
          setLoadUnavailable(true);
        } else {
          setLoadError(messageFor(e));
        }
      });
  }, [dealId]);

  // F2 (final review): раньше был голый useEffect — экран не видел ни
  // одного кадра WS. Сценарий подбирает данные, актуальные на момент
  // просмотра (котировка комиссии, version сделки), и оба протухают без
  // правила перезапроса — см. README «Контракт для SPA».
  useRefetch(load, (event) => "dealId" in event && event.dealId === dealId);

  async function confirm() {
    if (!selected || !dealId || dealVersion === null) return;
    setSubmitting(true);
    setError(null);
    try {
      await api.chooseScenario(dealId, selected, dealVersion);
      navigate(`/deals/${dealId}/tracking`);
    } catch (e) {
      if (e instanceof ApiError && e.code === "VERSION_CONFLICT") {
        // Кто-то другой изменил сделку, пока мы держали устаревшую version —
        // выбор нужно сделать заново на свежих данных, а не пытаться
        // повторить тот же запрос.
        setError("Сделка изменилась, данные обновлены — выберите сценарий ещё раз");
        setSelected(null);
        load();
      } else {
        setError(messageFor(e));
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (loadUnavailable) {
    return (
      <div>
        <h1 className="page-title">Выберите сценарий расчёта</h1>
        <div className="panel" style={{ padding: 18 }}>
          <p style={{ marginBottom: 12 }}>
            Сервис расчёта комиссии временно недоступен. Попробуйте ещё раз чуть позже.
          </p>
          <button className="btn btn-secondary" onClick={load}>
            Повторить
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <h1 className="page-title">Выберите сценарий расчёта</h1>
      <p className="page-subtitle">
        Сравните сроки, стоимость и ограничения — решение стоит принять осознанно, а не по умолчанию.
      </p>

      {loadError && <div className="field-error" style={{ marginBottom: 12 }}>{loadError}</div>}
      {!scenarios && !loadError && <div style={{ color: "var(--text-muted)" }}>Загрузка вариантов…</div>}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 14, marginBottom: 22 }}>
        {scenarios?.map((option) => {
          const isSelected = selected === option.id;
          return (
            <button
              key={option.id}
              type="button"
              onClick={() => setSelected(option.id)}
              disabled={!option.available}
              className="panel"
              style={{
                textAlign: "left",
                padding: 18,
                cursor: option.available ? "pointer" : "not-allowed",
                opacity: option.available ? 1 : 0.6,
                borderColor: isSelected ? "var(--cyan-500)" : "var(--line)",
                borderWidth: isSelected ? 2 : 1,
                background: isSelected ? "#f0fbfc" : "var(--paper-100)",
              }}
            >
              <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 6 }}>{option.title}</div>
              <p style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 12 }}>{option.description}</p>

              <div style={{ display: "flex", gap: 16, marginBottom: 10 }}>
                <StatBlock label="Срок" value={option.etaLabel} />
                <StatBlock label="Стоимость" value={costLabel(option)} />
              </div>

              <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12.5, color: "var(--text-muted)" }}>
                {option.limitations.map((l) => (
                  <li key={l}>{l}</li>
                ))}
              </ul>
            </button>
          );
        })}
      </div>

      {error && <div className="field-error" style={{ marginBottom: 12 }}>{error}</div>}

      <button className="btn btn-primary" onClick={confirm} disabled={!selected || submitting || dealVersion === null}>
        {submitting ? "Сохраняем…" : "Подтвердить сценарий"}
      </button>
    </div>
  );
}

function StatBlock({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{label}</div>
      <div className="mono" style={{ fontSize: 12.5, fontWeight: 600 }}>{value}</div>
    </div>
  );
}
