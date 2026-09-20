import type { ContextStats } from "@/lib/orchestrator/run";
import { useState } from "react";
import { formatBytes } from "@/lib/formatBytes";
import { useMediaQuery } from "@/lib/useMediaQuery";
import { Icon } from "./Icon";

export interface BackendContextMetrics {
  /** Which action produced this reading — "Analyze this contract", "Excerpt scan", "Citation check", ... */
  task: string;
  inputBytes: number;
  inputTokens: number;
  outputTokens: number;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <span className="flex min-w-0 items-baseline gap-1">
      <span className="shrink-0 text-muted">{label}</span>
      <span className="truncate font-bold tabular-nums text-foreground">{value}</span>
    </span>
  );
}

function BackendRow({ name, metrics }: { name: string; metrics: BackendContextMetrics | null }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-0.5 pl-0.5">
      <span className="w-16 shrink-0 text-xs font-bold uppercase tracking-wide text-secondary">{name}</span>
      {metrics ? (
        <>
          <span className="min-w-0 truncate text-muted" title={metrics.task}>
            {metrics.task}
          </span>
          <Stat label="in:" value={`${formatBytes(metrics.inputBytes)} (${metrics.inputTokens.toLocaleString()} tok)`} />
          <Stat label="out:" value={`${metrics.outputTokens.toLocaleString()} tok`} />
        </>
      ) : (
        <span className="text-muted">not run yet</span>
      )}
    </div>
  );
}

/**
 * A real, measured readout of what's actually in each model's context
 * window right now — not an estimate. Every number here is read straight
 * off an actual request/response: `ContextStats` for the memory-window and
 * document size (identical for both backends, since they're asked the
 * same `state`), and `BackendContextMetrics` for each backend's own
 * measured input size/tokens and output tokens on whichever action last
 * ran for it — a chat turn, an excerpt scan, or a citation check.
 */
export function ContextMeter({
  stats,
  typesafeMetrics,
  openaiMetrics,
}: {
  stats: ContextStats | null;
  typesafeMetrics: BackendContextMetrics | null;
  openaiMetrics: BackendContextMetrics | null;
}) {
  const isDesktop = useMediaQuery("(min-width: 1024px)");
  const [manual, setManual] = useState<boolean | null>(null);
  const hasDetail = Boolean(typesafeMetrics || openaiMetrics);
  // Open by default where there is room; a phone keeps the one-line summary until asked.
  const open = hasDetail && (manual ?? isDesktop);

  return (
    <div className="border-b border-border bg-elevated/60 px-4 py-1.5 text-xs short:hidden">
      <div className="flex items-center gap-x-4">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-1">
          <span className="shrink-0 font-bold uppercase tracking-wide text-muted">Context window</span>
          {stats ? (
            <>
              <Stat
                label="memory:"
                value={`${stats.historyTurnsIncluded}/${stats.historyTurnsTotal} turn${stats.historyTurnsTotal === 1 ? "" : "s"}${
                  stats.historyTurnsIncluded >= stats.historyTurnsTotal ? "" : " (trimmed)"
                }`}
              />
              <Stat label="document:" value={stats.documentBytes > 0 ? formatBytes(stats.documentBytes) : "none loaded"} />
            </>
          ) : (
            <span className="text-muted">Send a message to measure it.</span>
          )}
        </div>
        {hasDetail && (
          <button
            onClick={() => setManual(!open)}
            aria-expanded={open}
            aria-label={open ? "Hide per-model usage" : "Show per-model usage"}
            className="-my-1.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-muted transition-colors hover:bg-surface-hover hover:text-deep lg:hidden"
          >
            <Icon name="chevron" size={14} className={open ? "rotate-180" : ""} />
          </button>
        )}
      </div>
      {open && (
        <div className="mt-1 space-y-0.5">
          <BackendRow name="TypeSafe" metrics={typesafeMetrics} />
          <BackendRow name="OpenAI" metrics={openaiMetrics} />
        </div>
      )}
    </div>
  );
}
