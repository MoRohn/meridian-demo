import type { Cell, CompareGroup, Tone } from "@/lib/compare/rows";
import { Icon } from "./Icon";

const BAR: Record<Tone | "accent", string> = {
  rose: "bg-rose-600",
  amber: "bg-amber-600",
  emerald: "bg-emerald-600",
  accent: "bg-deep",
};
const TEXT: Record<Tone, string> = { rose: "text-rose-800", amber: "text-amber-800", emerald: "text-emerald-800" };

function Match({ match }: { match: boolean | null }) {
  if (match == null) return <span className="text-muted" aria-label="not compared">&ndash;</span>;
  return (
    <span className={`inline-flex items-center gap-1 font-bold ${match ? "text-emerald-800" : "text-rose-800"}`}>
      <Icon name={match ? "check" : "x"} size={13} />
      <span className="max-[479px]:sr-only">{match ? "agrees" : "differs"}</span>
    </span>
  );
}

function CellView({ cell }: { cell: Cell }) {
  if (typeof cell === "string") return <span className="text-muted">{cell}</span>;
  return (
    <>
      <span className={`block break-words font-bold leading-snug ${cell.tone ? TEXT[cell.tone] : "text-foreground"}`}>{cell.main}</span>
      {cell.sub && <span className="block leading-snug text-muted">{cell.sub}</span>}
      {cell.bar && (
        <span className="mt-1 block h-1 overflow-hidden rounded-full bg-surface-hover" aria-hidden>
          <span className={`block h-full rounded-full ${BAR[cell.bar.tone]}`} style={{ width: `${Math.max(3, Math.round(cell.bar.value * 100))}%` }} />
        </span>
      )}
    </>
  );
}

/**
 * The one results table. Trace, Risk, Compliance and Citations all draw their comparison with this: items down the side
 * (grouped, each group under one header row), TypeSafe's answer to each, OpenAI's answer to the identical item, and whether
 * they agree. Each answer is a headline with its supporting figures and a small bar; anything longer is in the tooltip.
 * On a phone the Match column shrinks to an icon.
 */
export function ComparisonTable({
  groups,
  label,
  firstColumn,
  dimmed = false,
}: {
  groups: CompareGroup[];
  /** The table's accessible name. */
  label: string;
  /** The heading of the first column: "Question", "Dimension", "Check". */
  firstColumn: string;
  /** Marks rows the result did not rely on (Trace's speculative questions). */
  dimmed?: boolean;
}) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-surface">
      <table aria-label={label} className={`w-full table-fixed border-collapse text-xs ${dimmed ? "opacity-75" : ""}`}>
        <colgroup>
          <col />
          <col className="w-[31%] min-[480px]:w-[29%]" />
          <col className="w-[29%] min-[480px]:w-[22%]" />
          <col className="w-10 min-[480px]:w-[5.5rem]" />
        </colgroup>
        <thead>
          <tr className="border-b border-border bg-elevated text-left text-[11px] font-bold uppercase tracking-wide text-muted">
            <th scope="col" className="px-2.5 py-1.5">{firstColumn}</th>
            <th scope="col" className="px-2 py-1.5">TypeSafe</th>
            <th scope="col" className="px-2 py-1.5">OpenAI</th>
            <th scope="col" className="px-1 py-1.5 min-[480px]:px-2"><span className="max-[479px]:sr-only">Match</span></th>
          </tr>
        </thead>
        {groups.map((group) => (
          <tbody key={group.id} className="border-t border-border first:border-t-0">
            <tr className="bg-elevated/60">
              <th scope="colgroup" colSpan={4} className="px-2.5 py-1 text-left text-[11px] font-bold uppercase tracking-wide text-muted">
                {group.label}
                {group.note && <span className="ml-1.5 font-medium normal-case tracking-normal">{group.note}</span>}
              </th>
            </tr>
            {group.rows.map((row) => (
              <tr key={row.id} className="border-t border-border/60 align-top">
                <th scope="row" className="px-2.5 py-1.5 text-left font-normal">
                  {row.tag && <span className="block text-[10px] font-bold uppercase leading-snug tracking-wide text-muted">{row.tag}</span>}
                  <span className="block break-words text-[13px] font-bold leading-snug text-foreground">{row.title}</span>
                  {row.subtitle && (
                    <span
                      className={`block leading-snug text-muted ${row.mono ? "break-all font-mono text-[10.5px]" : "text-[11px]"}`}
                      title={row.mono ? "The question id sent to the model" : undefined}
                    >
                      {row.subtitle}
                    </span>
                  )}
                  {row.facts && (
                    <span className="mt-1 flex flex-wrap gap-1">
                      {row.facts.map((f) => (
                        <span key={f} className="rounded-full border border-border-strong bg-elevated px-1.5 py-px text-[10px] font-semibold leading-snug text-secondary">
                          {f}
                        </span>
                      ))}
                    </span>
                  )}
                  {row.evidence && (
                    <span className="mt-1 block border-l-2 border-border-strong pl-2 text-[11px] leading-snug text-secondary" title={row.evidence.quote}>
                      <span className="font-bold text-muted">{row.evidence.ref}</span>
                      <span className="line-clamp-3 italic">&ldquo;{row.evidence.quote}&rdquo;</span>
                    </span>
                  )}
                </th>
                <td className="px-2 py-1.5" title={typeof row.ts === "string" ? undefined : row.ts.detail}>
                  <CellView cell={row.ts} />
                </td>
                <td className="px-2 py-1.5">
                  <CellView cell={row.oa} />
                </td>
                <td className="px-2 py-1.5">
                  <Match match={row.match} />
                </td>
              </tr>
            ))}
          </tbody>
        ))}
      </table>
    </div>
  );
}
