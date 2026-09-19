import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../../api/client";
import type { ScenarioCard, SettlementScenario } from "../../types/api";

// Мех��ническое обновление под новый контракт (ScenarioCard вместо старого
// мок-типа ScenarioOption): costLabel в контракте нет, вместо неё —
// commission (котировка service-commission) и available/unavailableReason.
// Полноценный редизайн карточек — задача Task 3/4, здесь только то, что
// нужно, чтобы дерево типов оставалось зелёным.
function costLabel(option: ScenarioCard): string {
  if (!option.available) return option.unavailableReason ?? "Недоступно";
  if (!option.commission) return "Уточняется";
  return `${new Intl.NumberFormat("ru-RU").format(option.commission.total)}`;
}

export function ScenarioPage() {
  const { dealId } = useParams<{ dealId: string }>();
  const navigate = useNavigate();
  const [scenarios, setScenarios] = useState<ScenarioCard[] | null>(null);
  const [selected, setSelected] = useState<SettlementScenario | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.getScenarios().then((data) => setScenarios(data.scenarios));
  }, []);

  async function confirm() {
    if (!selected || !dealId) return;
    setSubmitting(true);
    setError(null);
    try {
      await api.chooseScenario(dealId, selected);
      navigate(`/deals/${dealId}/tracking`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось сохранить выбор");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <h1 className="page-title">Выберите сценарий расчёта</h1>
      <p className="page-subtitle">
        Сравните сроки, стоимость и ограничения — решение стоит принять осознанно, а не по умолчанию.
      </p>

      {!scenarios && <div style={{ color: "var(--text-muted)" }}>Загрузка вариантов…</div>}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 14, marginBottom: 22 }}>
        {scenarios?.map((option) => {
          const isSelected = selected === option.id;
          return (
            <button
              key={option.id}
              type="button"
              onClick={() => setSelected(option.id)}
              className="panel"
              style={{
                textAlign: "left",
                padding: 18,
                cursor: "pointer",
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

      <button className="btn btn-primary" onClick={confirm} disabled={!selected || submitting}>
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
