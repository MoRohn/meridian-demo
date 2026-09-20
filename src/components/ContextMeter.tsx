import type { ContextStats } from "@/lib/orchestrator/run";
import { useState } from "react";
import { formatBytes } from "@/lib/formatBytes";
import { totalTally, type AnswerCallMetrics, type Tally } from "@/lib/contextMetrics";
import { useMediaQuery } from "@/lib/useMediaQuery";
import { Icon } from "./Icon";

export interface BackendContextMetrics {
  /** Which action produced this reading — "Analyze this contract", "Excerpt scan", "Citation check", ... */
  task: string;
  /** The judgments call: the typed questions this backend answered. */
  inputBytes: number;
  inputTokens: number;
  outputTokens: number;
  /** The call that wrote the chat reply, when a model wrote it. Counted in the row's totals. */
  answer?: AnswerCallMetrics;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <span className="flex min-w-0 items-baseline gap-1">
      <span className="shrink-0 text-muted">{label}</span>
      <span className="truncate font-bold tabular-nums text-foreground">{value}</span>
    </span>
  );
}

/** One call's figures: tokens in and out as the headline, the size of what was sent underneath. */
function Figures({ tally, strong = false }: { tally: Tally; strong?: boolean }) {
  return (
    <>
      <span className={`block whitespace-nowrap tabular-nums ${strong ? "font-bold text-foreground" : "text-secondary"}`}>
        {tally.inputTokens.toLocaleString()} in · {tally.outputTokens.toLocaleString()} out
      </span>
      <span className="block whitespace-nowrap tabular-nums text-muted">{formatBytes(tally.inputBytes)} sent</span>
    </>
  );
}

const HEAD = "px-3 py-1 text-[11px] font-bold uppercase tracking-wide text-muted";
const CELL = "px-3 py-1 align-top leading-snug";
/** The judgments/reply split needs room; a phone shows the total alone. */
const SPLIT = "max-sm:hidden";

function BackendRow({ name, metrics, showTask }: { name: string; metrics: BackendContextMetrics | null; showTask: boolean }) {
  return (
    <tr className="border-t border-border/60">
      <th scope="row" className={`${CELL} text-left`}>
        <span className="block text-xs font-bold uppercase tracking-wide text-secondary">{name}</span>
        {metrics && showTask && (
          <span className="block max-w-32 truncate font-normal text-muted" title={metrics.task}>
            {metrics.task}
          </span>
        )}
      </th>
      {metrics ? (
        <>
          <td className={`${CELL} ${SPLIT}`}>
            <Figures tally={metrics} />
          </td>
          <td className={`${CELL} ${SPLIT}`} title={metrics.answer?.model || undefined}>
            {metrics.answer ? <Figures tally={metrics.answer} /> : <span className="text-muted" title="No model wrote this result's reply">&ndash;</span>}
          </td>
          <td className={CELL}>
            <Figures tally={totalTally(metrics, metrics.answer)} strong />
          </td>
        </>
      ) : (
        <td colSpan={3} className={`${CELL} text-muted`}>
          not run yet
        </td>
      )}
    </tr>
  );
}

/**
 * A real, measured readout of what's actually in each model's context
 * window right now — not an estimate. Every number here is read straight
 * off an actual request/response: `ContextStats` for the memory-window and
 * document size (identical for both backends, since they're asked the
 * same `state`), and `BackendContextMetrics` for each backend's own
 * measured input size/tokens and output tokens on whichever action last
 * ran for it — a chat turn, an excerpt scan, or a citation check. A chat
 * turn is two calls per backend (the typed judgments, then the reply), shown
 * apart and added together in the Total column.
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

  // Both backends usually answered the same action, so it is said once; when they did not, each row says its own.
  const tasks = [typesafeMetrics?.task, openaiMetrics?.task].filter((t): t is string => Boolean(t));
  const sharedTask = tasks.length > 0 && tasks.every((t) => t === tasks[0]) ? tasks[0] : null;

  return (
    <div className="border-b border-border bg-elevated/60 px-4 py-2 text-xs short:hidden">
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
            className="-my-2 flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-muted transition-colors hover:bg-surface-hover hover:text-deep lg:hidden"
          >
            <Icon name="chevron" size={14} className={open ? "rotate-180" : ""} />
          </button>
        )}
      </div>
      {open && (
        <div className="mt-1.5">
          {sharedTask && (
            <p className="truncate text-muted" title={sharedTask}>
              Last action: <span className="text-secondary">{sharedTask}</span>
            </p>
          )}
          <div className="mt-1 overflow-x-auto">
            <table aria-label="Per-model usage" className="w-full max-w-2xl border-collapse text-left">
              <thead>
                <tr>
                  <th scope="col" className={HEAD}>
                    <span className="sr-only">Model</span>
                  </th>
                  <th scope="col" className={`${HEAD} ${SPLIT}`}>Judgments</th>
                  <th scope="col" className={`${HEAD} ${SPLIT}`}>Reply</th>
                  <th scope="col" className={HEAD}>Total</th>
                </tr>
              </thead>
              <tbody>
                <BackendRow name="TypeSafe" metrics={typesafeMetrics} showTask={!sharedTask} />
                <BackendRow name="OpenAI" metrics={openaiMetrics} showTask={!sharedTask} />
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
