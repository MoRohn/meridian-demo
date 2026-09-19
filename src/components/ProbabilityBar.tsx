export function ProbabilityBar({
  label,
  value,
  tone = "accent",
  highlight = false,
}: {
  label: string;
  value: number;
  tone?: "accent" | "amber" | "rose" | "emerald" | "slate";
  highlight?: boolean;
}) {
  const toneClasses: Record<string, string> = {
    accent: "bg-deep",
    amber: "bg-amber-600",
    rose: "bg-rose-600",
    emerald: "bg-emerald-600",
    slate: "bg-muted",
  };
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className={`w-36 shrink-0 truncate ${highlight ? "font-bold text-foreground" : "font-medium text-muted"}`}>
        {label}
      </span>
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface-hover">
        <div
          className={`h-full rounded-full transition-all duration-300 ${toneClasses[tone]}`}
          style={{ width: `${Math.max(2, Math.round(value * 100))}%` }}
        />
      </div>
      <span className="w-12 shrink-0 text-right font-semibold tabular-nums text-secondary">{Math.round(value * 100)}%</span>
    </div>
  );
}

export function ConfidenceBadge({ confidence }: { confidence: number }) {
  const tone =
    confidence >= 0.75
      ? "bg-emerald-600/10 text-emerald-800 border-emerald-600/25"
      : confidence >= 0.45
        ? "bg-amber-600/10 text-amber-800 border-amber-600/25"
        : "bg-rose-600/10 text-rose-800 border-rose-600/25";
  const label = confidence >= 0.75 ? "high confidence" : confidence >= 0.45 ? "medium confidence" : "low confidence — review";
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-bold ${tone}`}>
      {label} · {Math.round(confidence * 100)}%
    </span>
  );
}
