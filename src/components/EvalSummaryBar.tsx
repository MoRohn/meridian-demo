export interface SummaryStat {
  label: string;
  value: string;
  tone?: "rose" | "amber" | "emerald" | "neutral";
}

const TONE_TEXT: Record<NonNullable<SummaryStat["tone"]>, string> = {
  rose: "text-rose-700",
  amber: "text-amber-700",
  emerald: "text-emerald-700",
  neutral: "text-foreground",
};

/**
 * A compact "dashboard" header for the top of an evaluation tab: one
 * headline plus a row of at-a-glance stats (agreement rate, flagged count,
 * question count, ...). Every tab that shows a TypeSafe/OpenAI comparison
 * gets one of these so the reader sees the shape of the result before
 * scrolling into the per-item detail below it.
 */
export function EvalSummaryBar({
  icon,
  headline,
  stats,
}: {
  icon: string;
  headline: string;
  stats: SummaryStat[];
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-xl border border-border bg-elevated px-4 py-3">
      <div className="flex min-w-0 items-center gap-2">
        <span className="text-xl leading-none" aria-hidden>
          {icon}
        </span>
        <span className="truncate text-sm font-extrabold text-foreground">{headline}</span>
      </div>
      {stats.length > 0 && (
        <div className="flex flex-1 flex-wrap items-center justify-end gap-x-4 gap-y-1 text-xs">
          {stats.map((s) => (
            <span key={s.label} className="flex items-baseline gap-1 whitespace-nowrap">
              <span className="text-muted">{s.label}</span>
              <span className={`font-bold tabular-nums ${TONE_TEXT[s.tone ?? "neutral"]}`}>{s.value}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
