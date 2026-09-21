"use client";

import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useDialog } from "@/lib/useDialog";
import { useRubrics } from "@/lib/eval/useRubrics";
import { rubricsForTab, type RubricInfo } from "@/lib/eval/rubrics";
import { guidesForTab, type Guide } from "@/lib/rules/guide";
import type { EvalKind } from "@/lib/eval/types";
import { EVAL_KINDS } from "@/lib/eval/kinds";
import { Icon } from "./Icon";

export type RubricPage = "trace" | "risk" | "compliance" | "citation";

const pct = (x: number) => `${Math.round(x * 100)}%`;
const SHORT_NAME: Record<EvalKind, string> = { risk: "Risk", compliance: "Compliance", citation: "Citations", reply: "Assistant reply" };
const Chip = ({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "neutral" | "good" }) => (
  <span
    className={`rounded-full border px-2 py-px text-[11px] font-bold tabular-nums ${
      tone === "good" ? "border-emerald-600/30 bg-emerald-600/10 text-emerald-800" : "border-border-strong text-secondary"
    }`}
  >
    {children}
  </span>
);
const H4 = ({ children }: { children: React.ReactNode }) => <h4 className="mb-2 text-xs font-bold uppercase tracking-wide text-muted">{children}</h4>;

/** One rubric: what it judges, its steps as a short label and summary each (the exact wording one click away), and what each score band means. */
function RubricSection({ rubric, headingId }: { rubric: RubricInfo; headingId: string }) {
  const passAt = rubric.passThreshold * 10;
  const outlined = rubric.outline.length === rubric.steps.length && rubric.outline.length > 0;
  return (
    <section id={`rubric-${rubric.id}`} aria-labelledby={headingId} className="scroll-mt-3 space-y-4 rounded-xl border border-border bg-elevated/50 p-4">
      <header className="space-y-1.5">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <h3 id={headingId} className="text-base font-extrabold text-deep">{rubric.title}</h3>
          <Chip>v{rubric.version}</Chip>
          <Chip tone="good">Pass at {Math.round(passAt)}/10 ({pct(rubric.passThreshold)})</Chip>
        </div>
        {rubric.taskLine && <p className="text-sm leading-relaxed text-secondary">{rubric.taskLine}</p>}
      </header>

      <div>
        <H4>Scoring steps</H4>
        <ol className="space-y-2">
          {rubric.steps.map((step, i) => (
            <li key={i} className="grid grid-cols-[1.5rem_minmax(0,1fr)] items-start gap-x-2.5">
              <span className="mt-px flex h-6 w-6 items-center justify-center rounded-full bg-fill text-xs font-extrabold tabular-nums text-on-fill" aria-hidden>
                {i + 1}
              </span>
              {outlined ? (
                <p className="text-sm leading-snug">
                  <span className="sr-only">Step {i + 1}: </span>
                  <span className="block font-bold text-foreground">{rubric.outline[i].label}</span>
                  <span className="text-secondary">{rubric.outline[i].summary}</span>
                </p>
              ) : (
                <p className="text-sm leading-relaxed text-foreground">{step}</p>
              )}
            </li>
          ))}
        </ol>
        {outlined && (
          <details className="group mt-3 rounded-lg border border-border bg-surface">
            <summary className="flex min-h-9 cursor-pointer list-none items-center justify-between gap-2 px-3 py-1.5 text-xs font-bold text-muted transition-colors hover:text-deep">
              Exact wording the judge follows
              <Icon name="chevron" size={14} className="transition-transform group-open:rotate-180" />
            </summary>
            <ol className="list-decimal space-y-2 border-t border-border py-2.5 pl-8 pr-3 text-xs leading-relaxed text-secondary">
              {rubric.steps.map((step, i) => (
                <li key={i}>{step}</li>
              ))}
            </ol>
          </details>
        )}
      </div>

      {rubric.bands.length > 0 && (
        <div>
          <H4>Score bands (0 to 10)</H4>
          <ul className="overflow-hidden rounded-lg border border-border bg-surface">
            {rubric.bands.map((b) => {
              const passes = b.low >= passAt;
              return (
                <li key={b.low} className="grid grid-cols-[4.25rem_minmax(0,1fr)] items-start gap-x-3 border-t border-border/70 px-3 py-2 first:border-t-0">
                  <span
                    className={`rounded-full border px-2 py-0.5 text-center text-xs font-bold tabular-nums ${
                      passes ? "border-emerald-600/30 bg-emerald-600/10 text-emerald-800" : "border-rose-600/30 bg-rose-600/10 text-rose-800"
                    }`}
                  >
                    {b.low}&ndash;{b.high}
                    <span className="sr-only">{passes ? " (passes)" : " (fails)"}</span>
                  </span>
                  <span className="text-sm leading-snug text-secondary">{b.outcome}</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}

/** One of Meridian's own rule guides: what it governs, then each rule with its weight, threshold or origin and any levels. */
function GuideSection({ guide, headingId }: { guide: Guide; headingId: string }) {
  return (
    <section id={`guide-${guide.id}`} aria-labelledby={headingId} className="scroll-mt-3 space-y-4 rounded-xl border border-border bg-elevated/50 p-4">
      <header className="space-y-1.5">
        <h3 id={headingId} className="text-base font-extrabold text-deep">{guide.title}</h3>
        <p className="text-sm leading-relaxed text-secondary">{guide.summary}</p>
      </header>
      {guide.groups.map((g) => (
        <div key={g.heading}>
          <H4>{g.heading}</H4>
          {g.note && <p className="-mt-1 mb-2 text-xs leading-relaxed text-muted">{g.note}</p>}
          <ul className="space-y-1.5">
            {g.items.map((item) => (
              <li key={item.title} className="rounded-lg border border-border bg-surface px-3 py-2">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="text-sm font-bold text-foreground">{item.title}</span>
                  {item.chips?.map((c) => (
                    <Chip key={c}>{c}</Chip>
                  ))}
                </div>
                <p className="mt-0.5 text-sm leading-snug text-secondary">{item.text}</p>
                {item.levels && (
                  <dl className="mt-1.5 space-y-1 border-t border-border/70 pt-1.5">
                    {item.levels.map((l) => (
                      <div key={l.label} className="grid grid-cols-[7rem_minmax(0,1fr)] items-baseline gap-x-2 text-xs leading-snug">
                        <dt className="font-bold tabular-nums text-muted">{l.label}</dt>
                        <dd className="text-secondary">{l.text}</dd>
                      </div>
                    ))}
                  </dl>
                )}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}

type View = "rubric" | "rules";

/**
 * The scoring rubric as a scrollable modal, in two parts. "How answers are scored" is the independent judge's fixed,
 * versioned rules, read from the evaluation service (the only place their wording lives). "How Meridian decides" is the
 * rules the application itself applies (risk dimensions, compliance checks, how citations are found, the guardrails), read
 * from the code that runs them. A page shows its own; Trace shows all of them.
 */
export function RubricModal({ open, onClose, page }: { open: boolean; onClose: () => void; page: RubricPage }) {
  const dialogRef = useDialog(open, onClose);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<View>("rubric");
  const kinds = rubricsForTab(page);
  const { state, retry } = useRubrics(open);
  if (!open || typeof document === "undefined") return null;

  const rubrics = state.status === "ready" ? state.rubrics.filter((r) => kinds.includes(r.id)) : [];
  const guides = guidesForTab(page);
  const chips = view === "rubric" ? rubrics.map((r) => ({ key: `rubric-${r.id}`, label: SHORT_NAME[r.id] })) : guides.map((g) => ({ key: `guide-${g.id}`, label: g.title }));

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-3 sm:p-4" onClick={onClose}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="rubric-title"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className="animate-in flex max-h-[90dvh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-xl outline-none"
      >
        <div className="flex shrink-0 items-start justify-between gap-3 px-5 pb-3 pt-4">
          <div className="min-w-0">
            <h2 id="rubric-title" className="flex items-center gap-2 text-lg font-extrabold text-foreground">
              <Icon name="book" size={20} className="text-deep" />
              Scoring Rubric
            </h2>
            <p className="mt-1 text-sm leading-relaxed text-muted">
              {view === "rubric"
                ? "The fixed rules the independent judge follows, every time and for both models, so scores are comparable."
                : "The rules Meridian itself applies, read from the code that runs them."}
            </p>
          </div>
          <button
            onClick={onClose}
            className="-mr-2 -mt-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-muted transition-colors hover:bg-surface-hover hover:text-foreground"
            aria-label="Close"
          >
            <Icon name="x" size={20} />
          </button>
        </div>

        <div className="shrink-0 space-y-2 border-b border-border px-5 pb-3">
          <div role="tablist" aria-label="Rubric sections" className="flex gap-1 rounded-full border border-border bg-elevated p-1">
            {([["rubric", "How answers are scored"], ["rules", "How Meridian decides"]] as const).map(([id, label]) => (
              <button
                key={id}
                role="tab"
                aria-selected={view === id}
                onClick={() => {
                  setView(id);
                  bodyRef.current?.scrollTo({ top: 0 });
                }}
                className={`flex-1 whitespace-nowrap rounded-full px-3 py-2 text-xs font-bold transition-colors sm:py-1.5 ${
                  view === id ? "bg-fill text-on-fill" : "text-secondary hover:bg-surface-hover hover:text-deep"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          {chips.length > 1 && (
            <nav aria-label="Jump to" className="flex gap-1.5 overflow-x-auto pb-0.5">
              {chips.map((c) => (
                <button
                  key={c.key}
                  onClick={() => bodyRef.current?.querySelector(`#${c.key}`)?.scrollIntoView({ behavior: "smooth", block: "start" })}
                  className="shrink-0 whitespace-nowrap rounded-full border border-border-strong bg-surface px-3 py-1 text-xs font-bold text-secondary transition-colors hover:border-deep/40 hover:text-deep"
                >
                  {c.label}
                </button>
              ))}
            </nav>
          )}
        </div>

        <div ref={bodyRef} tabIndex={0} role="region" aria-label="Scoring rubric rules" className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4 outline-none focus-visible:ring-2 focus-visible:ring-deep/50">
          {view === "rules" && guides.map((g) => <GuideSection key={g.id} guide={g} headingId={`guide-heading-${g.id}`} />)}
          {view === "rubric" && (
            <>
              {state.status === "loading" && (
                <p role="status" className="flex items-center gap-2 text-sm text-secondary">
                  <Icon name="loader" size={16} />
                  Loading the rubric{kinds.length > 1 ? "s" : ""}&hellip;
                </p>
              )}
              {state.status === "unavailable" && (
                <div role="status" className="space-y-2 rounded-xl border border-border bg-elevated/60 p-4 text-sm leading-relaxed text-secondary">
                  <p className="font-bold text-foreground">The rubric can&rsquo;t be shown right now.</p>
                  <p>
                    The judge&rsquo;s rubrics are read from the evaluation service, which isn&rsquo;t running. Start it with{" "}
                    <code className="text-accent-soft-ink">npm run eval-service</code> (<code className="text-accent-soft-ink">npm run meridian</code> starts it for you), then try
                    again. Meridian&rsquo;s own rules are still available under &ldquo;How Meridian decides&rdquo;.
                  </p>
                  <button onClick={retry} className="rounded-full border border-border-strong bg-surface px-3 py-1.5 text-xs font-bold text-secondary transition-colors hover:border-deep/40 hover:text-deep">
                    Try again
                  </button>
                  <ul className="space-y-1 border-t border-border pt-2 text-xs text-muted">
                    {kinds.map((k) => (
                      <li key={k}>
                        <span className="font-bold text-secondary">{EVAL_KINDS[k].title}:</span> {EVAL_KINDS[k].subtitle}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {rubrics.map((r) => (
                <RubricSection key={r.id} rubric={r} headingId={`rubric-heading-${r.id}`} />
              ))}
              {state.status === "ready" && rubrics.length === 0 && <p className="text-sm text-secondary">The evaluation service has no rubric for this view.</p>}
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
