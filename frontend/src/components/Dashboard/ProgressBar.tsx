interface Props {
  percent: number;
  tone?: "normal" | "attention";
}

export function ProgressBar({ percent, tone = "normal" }: Props) {
  const color = tone === "attention" ? "var(--amber-500)" : "var(--cyan-500)";
  return (
    <div
      role="progressbar"
      aria-valuenow={percent}
      aria-valuemin={0}
      aria-valuemax={100}
      style={{ height: 5, background: "var(--line)", borderRadius: 3, overflow: "hidden" }}
    >
      <div style={{ width: `${percent}%`, height: "100%", background: color }} />
    </div>
  );
}
