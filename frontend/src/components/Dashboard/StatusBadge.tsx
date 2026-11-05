import type { DealStage } from "../../types/api";

const stageLabel: Record<DealStage, string> = {
  created: "Создана",
  documents: "Сбор документов",
  compliance_check: "Комплаенс-проверка",
  settlement: "Идёт расчёт",
  completed: "Завершена",
  blocked: "Заблокирована",
};

const stageColor: Record<DealStage, string> = {
  created: "var(--text-muted)",
  documents: "var(--cyan-600)",
  compliance_check: "var(--amber-500)",
  settlement: "var(--cyan-600)",
  completed: "var(--green-600)",
  blocked: "var(--red-600)",
};

export function StatusBadge({ stage }: { stage: DealStage }) {
  const color = stageColor[stage];
  return (
    <span
      className="mono"
      data-testid="deal-stage"
      style={{
        fontSize: 11.5,
        color,
        border: `1px solid ${color}`,
        borderRadius: 3,
        padding: "2px 7px",
        whiteSpace: "nowrap",
      }}
    >
      {stageLabel[stage]}
    </span>
  );
}
