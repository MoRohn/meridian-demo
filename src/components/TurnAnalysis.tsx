"use client";

import type { ReactNode } from "react";
import type { TraceEntry, ComplianceFlag } from "@/lib/orchestrator/run";
import type { TurnAnswer } from "@/lib/chat/answer";
import type { OpenAIRunOutcome, OpenAITurn } from "@/lib/openai/types";
import type { CompositeRisk } from "@/lib/skills/clauseRisk";
import { useActivities } from "@/lib/activity/hooks";
import { questionLabel } from "@/lib/trace/labels";
import {
  buildPath,
  certaintyProfile,
  CLOSE_CALL,
  compareOutcomes,
  coverageOf,
  distributionsFor,
  divergences,
  judgmentsFor,
  NEAR_CERTAIN,
  reasoningView,
  summarizeOutcome,
  typedAnswers,
  type Area,
  type Divergence,
  type PathStep,
  type ReasoningView,
  type Severity,
  type StepStatus,
} from "@/lib/trace/analysis";
import { renderBold } from "@/lib/renderBold";
import { Icon } from "./Icon";

const pct = (x: number) => `${Math.round(x * 100)}%`;

/** What the app knows about TypeSafe's turn beyond the trace itself. */
export interface TypesafeTurn {
  risk: CompositeRisk | null;
  flags: ComplianceFlag[];
  blocked: "privileged" | "injection" | null;
  answer: TurnAnswer | null;
  /** Set when a TypeSafe key was supplied but the demo heuristic answered anyway, and why. */
  fallbackReason?: string | null;
}

function Panel({ label, icon, hint, children }: { label: string; icon: "trace" | "scale" | "chart" | "shield" | "search" | "sliders"; hint?: string; children: ReactNode }) {
  return (
    <section aria-label={label} className="space-y-2 rounded-xl border border-border bg-elevated/50 p-3.5">
      <div>
        <h2 className="flex items-center gap-2 text-sm font-extrabold text-deep">
          <Icon name={icon} size={16} />
          {label}
        </h2>
        {hint && <p className="mt-1 text-xs leading-relaxed text-muted">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

/** The frame every table here shares: a header row naming the two models, and a scrollable wrapper so a narrow screen can still reach it. */
function ModelTable({ label, first, children }: { label: string; first: string; children: ReactNode }) {
  return (
    <div role="region" aria-label={`${label}, scrollable`} tabIndex={0} className="overflow-x-auto rounded-lg border border-border bg-surface outline-none focus-visible:ring-2 focus-visible:ring-deep/50">
      <table aria-label={label} className="w-full table-fixed border-collapse text-xs">
        <colgroup>
          <col className="w-[34%]" />
          <col className="w-[33%]" />
          <col className="w-[33%]" />
        </colgroup>
        <thead>
          <tr className="border-b border-border bg-elevated text-left text-[11px] font-bold uppercase tracking-wide text-muted">
            <th scope="col" className="px-2.5 py-1.5">{first}</th>
            <th scope="col" className="px-2 py-1.5">TypeSafe</th>
            <th scope="col" className="px-2 py-1.5">OpenAI</th>
          </tr>
        </thead>
        {children}
      </table>
    </div>
  );
}

const rowHead = "px-2.5 py-1.5 text-left align-top font-normal";
const cellCls = "px-2 py-1.5 align-top";

/** OpenAI's column when there is nothing to show: the same two phrases every tab uses. */
const noOpenAI = (configured: boolean) => (configured ? "no answer" : "not run");

// ---- final results ------------------------------------------------------------------------------------------------------

function Outcome({ headline, facts }: { headline: string; facts: ReturnType<typeof compareOutcomes>["facts"] }) {
  return (
    <>
      <p className="text-sm font-semibold leading-relaxed text-foreground">{headline}</p>
      {facts.length > 0 && (
        <ModelTable label="Results of the turn" first="Result">
          <tbody>
            {facts.map((f) => (
              <tr key={f.label} className="border-t border-border/60">
                <th scope="row" className={rowHead}>
                  <span className="block text-[13px] font-bold text-foreground">{f.label}</span>
                  <span className={`inline-flex items-center gap-1 font-bold ${f.same ? "text-emerald-800" : "text-rose-800"}`}>
                    <Icon name={f.same ? "check" : "x"} size={12} />
                    {f.same ? "same" : "differs"}
                  </span>
                </th>
                <td className={`${cellCls} break-words font-bold text-foreground`}>{f.typesafe}</td>
                <td className={`${cellCls} break-words font-bold text-foreground`}>{f.openai}</td>
              </tr>
            ))}
          </tbody>
        </ModelTable>
      )}
    </>
  );
}

// ---- the decision path ----------------------------------------------------------------------------------------------------

const STATUS: Record<StepStatus, { icon: "check" | "alert" | "info"; text: string; label: string }> = {
  pass: { icon: "check", text: "text-emerald-800", label: "continued" },
  stop: { icon: "alert", text: "text-amber-800", label: "ended the turn" },
  missing: { icon: "alert", text: "text-amber-800", label: "no answer" },
  skipped: { icon: "info", text: "text-muted", label: "not reached" },
};

function PathCell({ step }: { step: PathStep }) {
  const s = STATUS[step.status];
  return (
    <>
      <span className={`flex items-start gap-1 font-bold leading-snug ${s.text}`}>
        <Icon name={s.icon} size={12} className="mt-0.5 shrink-0" />
        <span className="break-words">
          <span className="sr-only">{s.label}: </span>
          {step.result}
        </span>
      </span>
      {step.reading !== "—" && <span className="mt-0.5 block break-words leading-snug text-muted">{step.reading}</span>}
      {step.near && step.margin != null && (
        <span className="mt-1 inline-block rounded-full border border-amber-600/30 bg-amber-600/10 px-1.5 py-px text-[11px] font-bold leading-snug text-amber-800">
          Close call: {Math.max(1, Math.round(step.margin * 100))} pt{Math.round(step.margin * 100) === 1 ? "" : "s"} from the line
        </span>
      )}
      {step.note && <span className="mt-0.5 block leading-snug text-muted">{step.note}</span>}
    </>
  );
}

function DecisionPath({ typesafe, openai, openaiConfigured }: { typesafe: PathStep[]; openai: PathStep[] | null; openaiConfigured: boolean }) {
  return (
    <ModelTable label="Decision path" first="Step">
      <tbody>
        {typesafe.map((ts) => {
          const oa = openai?.find((s) => s.key === ts.key);
          return (
            <tr key={ts.key} className="border-t border-border/60">
              <th scope="row" className={rowHead}>
                <span className="block text-[13px] font-bold leading-snug text-foreground">{ts.title}</span>
                <span className="block text-[11px] leading-snug text-muted">{ts.rule}</span>
              </th>
              <td className={cellCls}>
                <PathCell step={ts} />
              </td>
              <td className={cellCls}>{oa ? <PathCell step={oa} /> : openai ? <span className="text-muted">not reached</span> : <span className="text-muted">{noOpenAI(openaiConfigured)}</span>}</td>
            </tr>
          );
        })}
      </tbody>
    </ModelTable>
  );
}

// ---- probabilities behind the routing ---------------------------------------------------------------------------------------

function Distributions({ views, openaiConfigured }: { views: ReturnType<typeof distributionsFor>; openaiConfigured: boolean }) {
  return (
    <div className="space-y-2">
      {views.map((v) => (
        <div key={v.id} role="region" aria-label={`${v.label}, scrollable`} tabIndex={0} className="overflow-x-auto rounded-lg border border-border bg-surface outline-none focus-visible:ring-2 focus-visible:ring-deep/50">
          <table aria-label={`${v.label} probabilities`} className="w-full table-fixed border-collapse text-xs">
            <colgroup>
              <col className="w-[34%]" />
              <col className="w-[33%]" />
              <col className="w-[33%]" />
            </colgroup>
            <thead>
              <tr className="border-b border-border bg-elevated text-left text-[11px] font-bold uppercase tracking-wide text-muted">
                <th scope="col" className="px-2.5 py-1.5">{v.label}</th>
                <th scope="col" className="px-2 py-1.5">TypeSafe probability</th>
                <th scope="col" className="px-2 py-1.5">OpenAI pick</th>
              </tr>
            </thead>
            <tbody>
              {v.options.map((o) => (
                <tr key={o.key} className={`border-t border-border/60 ${o.tsPicked || o.oaPicked ? "" : "opacity-80"}`}>
                  <th scope="row" className={rowHead}>
                    <span className={`block break-words leading-snug ${o.tsPicked ? "font-bold text-foreground" : "font-semibold text-secondary"}`}>{o.key}</span>
                    {o.description && <span className="block break-words text-[11px] leading-snug text-muted">{o.description}</span>}
                  </th>
                  <td className={cellCls}>
                    <span className="flex items-center gap-2">
                      <span className="w-9 shrink-0 font-bold tabular-nums text-foreground">{pct(o.tsProbability)}</span>
                      <span className="block h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-surface-hover" aria-hidden>
                        <span className={`block h-full rounded-full ${o.tsPicked ? "bg-deep" : "bg-border-strong"}`} style={{ width: `${Math.max(2, Math.round(o.tsProbability * 100))}%` }} />
                      </span>
                    </span>
                    {o.tsPicked && <span className="block text-[11px] font-bold text-deep">picked</span>}
                  </td>
                  <td className={cellCls}>
                    {o.oaPicked ? (
                      <span className="block font-bold text-violet-800">
                        picked{v.oaStrength != null ? ` · self-reported ${pct(v.oaStrength)}` : " · no confidence reported"}
                      </span>
                    ) : o === v.options[0] && !v.oaAnswered ? (
                      <span className="text-muted">{noOpenAI(openaiConfigured)}</span>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}

// ---- how sure each model was ------------------------------------------------------------------------------------------------

function Certainty({ ts, oa, openaiConfigured }: { ts: ReturnType<typeof certaintyProfile>; oa: ReturnType<typeof certaintyProfile> | null; openaiConfigured: boolean }) {
  const of = (p: typeof ts) => (n: number) => `${n} of ${p.answered}`;
  const rows: { label: string; hint: string; ts: string; oa: string }[] = [
    { label: "Answers given", hint: "Every question in the call, including the risk and compliance ones", ts: String(ts.answered), oa: oa ? String(oa.answered) : noOpenAI(openaiConfigured) },
    {
      label: "Average confidence in its pick",
      hint: "TypeSafe: the probability it put on the option it picked. OpenAI: the number it wrote about itself",
      ts: ts.meanStrength == null ? "n/a" : pct(ts.meanStrength),
      oa: oa ? (oa.meanStrength == null ? "n/a" : pct(oa.meanStrength)) : noOpenAI(openaiConfigured),
    },
    { label: `Near-certain (${pct(NEAR_CERTAIN)} or more)`, hint: "Picks held with almost no doubt", ts: of(ts)(ts.nearCertain), oa: oa ? of(oa)(oa.nearCertain) : noOpenAI(openaiConfigured) },
    { label: `Close calls (under ${pct(CLOSE_CALL)})`, hint: "Picks held with real doubt", ts: of(ts)(ts.closeCalls), oa: oa ? of(oa)(oa.closeCalls) : noOpenAI(openaiConfigured) },
  ];
  if (oa && oa.unreported > 0) rows.push({ label: "No confidence reported", hint: "OpenAI left the confidence out; the pipeline treats it as neutral", ts: "—", oa: of(oa)(oa.unreported) });
  const least = (p: typeof ts) => (p.lowest ? `${p.lowest.label}: ${pct(p.lowest.strength ?? 0)}` : "n/a");
  rows.push({ label: "Least sure about", hint: "The pick it held the most loosely", ts: least(ts), oa: oa ? least(oa) : noOpenAI(openaiConfigured) });

  return (
    <>
      <ModelTable label="How sure each model was" first="Measure">
        <tbody>
          {rows.map((r) => (
            <tr key={r.label} className="border-t border-border/60">
              <th scope="row" className={rowHead}>
                <span className="block text-[13px] font-bold leading-snug text-foreground">{r.label}</span>
                <span className="block text-[11px] leading-snug text-muted">{r.hint}</span>
              </th>
              <td className={`${cellCls} break-words font-bold tabular-nums text-foreground`}>{r.ts}</td>
              <td className={`${cellCls} break-words font-bold tabular-nums text-foreground`}>{r.oa}</td>
            </tr>
          ))}
        </tbody>
      </ModelTable>
      <p className="text-xs leading-relaxed text-muted">
        TypeSafe&rsquo;s figures are probabilities it computed for every option. OpenAI&rsquo;s are a number the model wrote about its own answer, so a
        high figure there says how sure it claimed to be, not how often that kind of answer is right.
      </p>
    </>
  );
}

// ---- where they parted ways -----------------------------------------------------------------------------------------------------

const SEVERITY: Record<Severity, { label: string; chip: string; meaning: string }> = {
  firm: { label: "Firm", chip: "border-rose-600/30 bg-rose-600/10 text-rose-800", meaning: "TypeSafe was sure, and OpenAI went the other way." },
  leaning: { label: "Leaning", chip: "border-amber-600/30 bg-amber-600/10 text-amber-800", meaning: "TypeSafe leaned one way, without being sure." },
  "coin-flip": { label: "Coin flip", chip: "border-border-strong bg-elevated text-secondary", meaning: "TypeSafe itself was torn, so a different pick is not much of a conflict." },
};
const AREA_NOTE: Partial<Record<Area, string>> = { risk: "Risk tab", compliance: "Compliance tab" };

function Divergences({ list, compared }: { list: Divergence[]; compared: number }) {
  if (list.length === 0) return <p className="text-sm text-secondary">The models gave the same answer to all {compared} questions they both answered.</p>;
  return (
    <>
      <p className="text-xs text-muted">
        {list.length} of {compared} questions answered differently. The ones that steer what the app does next come first, then the firmest.
      </p>
      <ul className="space-y-1.5">
        {list.map((d) => {
          const sev = SEVERITY[d.severity];
          return (
            <li key={d.id} className="rounded-lg border border-border bg-surface px-3 py-2 text-xs leading-relaxed">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="text-[13px] font-bold text-foreground">{d.label}</span>
                <span className={`rounded-full border px-1.5 py-px text-[11px] font-bold ${sev.chip}`}>{sev.label}</span>
                {d.steers && <span className="rounded-full border border-deep/25 bg-deep/10 px-1.5 py-px text-[11px] font-bold text-deep">Steers the reply</span>}
                {AREA_NOTE[d.area] && <span className="text-muted">shown on the {AREA_NOTE[d.area]}</span>}
              </div>
              <p className="mt-1 text-secondary">
                <span className="font-bold text-foreground">TypeSafe</span> {d.typesafe.reading}
                <br />
                <span className="font-bold text-foreground">OpenAI</span> {d.openai.reading}
              </p>
              <p className="mt-0.5 text-muted">{sev.meaning}</p>
            </li>
          );
        })}
      </ul>
    </>
  );
}

// ---- how each model worked -----------------------------------------------------------------------------------------------------

function Anatomy({
  trace,
  outcome,
  source,
  tsModel,
  openaiConfigured,
}: {
  trace: TraceEntry[];
  outcome: OpenAIRunOutcome | null;
  source: "live" | "mock";
  tsModel: string | undefined;
  openaiConfigured: boolean;
}) {
  const coverage = coverageOf(trace, outcome);
  const speculative = trace.filter((e) => !e.used);
  const oaResult = outcome?.ok ? outcome.result : null;
  const reasoning = reasoningView(oaResult?.reasoning);
  const rows: { label: string; ts: ReactNode; oa: ReactNode }[] = [
    {
      label: "Model",
      ts: source === "live" ? (tsModel ?? "TypeSafe Jev") : "Local demo heuristic (no model call)",
      oa: oaResult ? (
        <>
          {oaResult.model}
          {oaResult.fallbackFrom && <span className="block font-normal text-amber-800">fell back from {oaResult.fallbackFrom}</span>}
        </>
      ) : (
        noOpenAI(openaiConfigured)
      ),
    },
    {
      label: "How it judges",
      ts: "Reads the state once and returns a probability for every option of every question",
      oa: oaResult
        ? reasoning.state === "on"
          ? "One forced function call. It thinks first, then gives a pick per question and a confidence it reports about itself"
          : "One forced function call: a single pick per question and a confidence it reports about itself"
        : noOpenAI(openaiConfigured),
    },
    {
      label: "Reasoning",
      ts: "None. It answers directly, with no reasoning step",
      oa: !oaResult
        ? noOpenAI(openaiConfigured)
        : reasoning.state === "on"
          ? `${reasoning.effort} effort${reasoning.tokens != null ? ` \u00b7 ${reasoning.tokens.toLocaleString("en-US")} reasoning tokens` : ""}`
          : reasoning.state === "off"
            ? "Off for this call"
            : "Not a reasoning model",
    },
    {
      label: "Questions answered",
      ts: `${coverage.asked} of ${coverage.asked}`,
      oa: oaResult ? `${coverage.openaiAnswered} of ${coverage.asked}` : noOpenAI(openaiConfigured),
    },
  ];
  return (
    <>
      <ModelTable label="How each model worked" first="Measure">
        <tbody>
          {rows.map((r) => (
            <tr key={r.label} className="border-t border-border/60">
              <th scope="row" className={`${rowHead} text-[13px] font-bold text-foreground`}>{r.label}</th>
              <td className={`${cellCls} break-words font-semibold text-foreground`}>{r.ts}</td>
              <td className={`${cellCls} break-words font-semibold text-foreground`}>{r.oa}</td>
            </tr>
          ))}
        </tbody>
      </ModelTable>
      {speculative.length > 0 && (
        <details className="group">
          <summary className="flex min-h-9 cursor-pointer list-none items-center gap-1.5 rounded-lg px-1 text-xs font-bold text-muted transition-colors hover:text-deep">
            <span className="transition-transform group-open:rotate-90" aria-hidden>&rsaquo;</span>
            {coverage.used} of {coverage.asked} answers were used by the reply; {speculative.length} speculative question{speculative.length === 1 ? "" : "s"} fetched in the same call but not needed
          </summary>
          <p className="px-1 pb-1 text-xs leading-relaxed text-muted">{speculative.map((e) => questionLabel(e.questionId)).join(", ")}</p>
        </details>
      )}
      <p className="text-xs leading-relaxed text-muted">Timings, tokens and cost for each call are in the Activity trace and Model performance above.</p>
    </>
  );
}

// ---- OpenAI's reasoning -----------------------------------------------------------------------------------------------------------

function OpenAIReasoningBody({ view }: { view: ReasoningView }) {
  if (view.state === "not-applicable") return <p className="text-sm text-secondary">This OpenAI model does not reason, so it answered straight away.</p>;
  if (view.state === "off") return <p className="text-sm text-secondary">{view.note}</p>;
  return (
    <>
      <p className="text-xs font-semibold text-secondary">
        {view.effort} effort
        {view.tokens != null && <> &middot; {view.tokens.toLocaleString("en-US")} reasoning tokens, counted in OpenAI&rsquo;s output tokens and cost</>}
      </p>
      {view.summary ? (
        <blockquote className="whitespace-pre-wrap border-l-2 border-violet-600/40 pl-3 text-sm leading-relaxed text-foreground">{renderBold(view.summary)}</blockquote>
      ) : (
        <p className="text-sm text-secondary">It reasoned, but OpenAI returned no summary of it for this call.</p>
      )}
      <p className="text-xs leading-relaxed text-muted">
        This is OpenAI&rsquo;s own summary of its reasoning for the whole call, not a line per question. OpenAI does not expose the raw chain of thought. The
        confidence figures beside each pick are still numbers the model wrote about itself.
      </p>
    </>
  );
}

// ---- the whole analysis ---------------------------------------------------------------------------------------------------------

/**
 * How each model got to its answers and what the app did with them, for the latest chat turn. It leaves out what the Risk
 * and Compliance tabs already show (the ratings and the flags themselves) and adds what they cannot: the path each model's
 * answers took through the app's rules, the probabilities behind the routing, how sure each model was across all its
 * answers, and exactly where and how firmly the two disagreed.
 */
export function TurnAnalysis({
  trace,
  turn,
  source,
  openaiOutcome,
  openaiTurn,
  openaiConfigured,
  hasDocument,
}: {
  trace: TraceEntry[];
  turn: TypesafeTurn;
  source: "live" | "mock";
  openaiOutcome: OpenAIRunOutcome | null;
  openaiTurn: OpenAITurn | null;
  openaiConfigured: boolean;
  hasDocument: boolean;
}) {
  const records = useActivities();
  const tsModel = [...records].reverse().find((r) => r.actor === "typesafe" && r.kind === "chat" && !r.simulated && r.model)?.model;

  const judged = judgmentsFor(trace, openaiOutcome);
  const typed = typedAnswers(trace, openaiOutcome);
  const oaAnswered = Boolean(openaiOutcome?.ok && openaiTurn);
  const reasoning = reasoningView(openaiOutcome?.ok ? openaiOutcome.result.reasoning : undefined);

  const tsPath = buildPath({ typed: typed.typesafe, judgments: judged.typesafe, basis: "calibrated", hasDocument, answer: turn.answer });
  const oaPath = oaAnswered && openaiTurn ? buildPath({ typed: typed.openai, judgments: judged.openai, basis: "self-reported", hasDocument, answer: openaiTurn.answer }) : null;

  const tsOutcome = summarizeOutcome({ blocked: turn.blocked, path: tsPath, risk: turn.risk, flags: turn.flags });
  const oaOutcome = oaPath && openaiTurn ? summarizeOutcome({ blocked: openaiTurn.blocked, path: oaPath, risk: openaiTurn.risk, flags: openaiTurn.complianceFlags }) : null;
  const { facts, headline } = compareOutcomes(tsOutcome, oaOutcome);

  const distributions = distributionsFor(trace, judged);
  const tsCertainty = certaintyProfile(Object.values(judged.typesafe));
  const oaCertainty = oaAnswered ? certaintyProfile(Object.values(judged.openai)) : null;
  const differing = divergences(trace, judged, openaiOutcome);
  const compared = Object.keys(judged.openai).length;

  return (
    <div className="space-y-3">
      <p className="flex items-start gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-xs leading-relaxed text-secondary">
        <Icon name="info" size={14} className="mt-0.5 shrink-0" />
        <span>
          The ratings and flags themselves are on the Risk and Compliance tabs. This tab traces how each model got to its answers and what the app did with
          them. TypeSafe has no reasoning step: it returns probabilities. OpenAI {reasoning.state === "on" ? "reasons before it answers and returns a summary of that reasoning" : "returns a pick with a confidence it reports about itself"}.
          Alongside that, the decision path shows how each set of answers moved through the app&rsquo;s rules, which is what decided the reply.
        </span>
      </p>
      {source === "mock" && (
        <p className="flex items-start gap-2 rounded-lg border border-amber-600/30 bg-amber-600/[0.08] px-3 py-2 text-xs leading-relaxed text-amber-900">
          <Icon name="alert" size={14} className="mt-0.5 shrink-0" />
          {turn.fallbackReason ? (
            <span>
              A TypeSafe key is set, but the live model did not answer, so these answers come from the local demo heuristic and its probabilities are illustrative.{" "}
              <strong>{turn.fallbackReason}</strong>
            </span>
          ) : (
            <span>TypeSafe&rsquo;s answers here come from the local demo heuristic, not the live model, so its probabilities are illustrative. Add a TypeSafe key in Settings to trace the real model.</span>
          )}
        </p>
      )}

      <Panel label="What each model decided" icon="scale" hint="The route each took and where it ended up.">
        <Outcome headline={headline} facts={facts} />
      </Panel>

      {openaiOutcome?.ok && (
        <Panel label="OpenAI's reasoning" icon="search">
          <OpenAIReasoningBody view={reasoning} />
        </Panel>
      )}

      <Panel label="Decision path" icon="trace" hint="The app's rules, applied in order to each model's answers. A rule that ends the turn skips the ones after it.">
        <DecisionPath typesafe={tsPath} openai={oaPath} openaiConfigured={openaiConfigured} />
      </Panel>

      {distributions.length > 0 && (
        <Panel label="Probabilities behind the routing" icon="chart" hint="Every option the models could have picked for the questions that steer the turn. OpenAI returns one pick, not a distribution, so its column can only mark the pick.">
          <Distributions views={distributions} openaiConfigured={openaiConfigured} />
        </Panel>
      )}

      <Panel label="How sure each model was" icon="sliders" hint="Across every answer in the call, risk and compliance included.">
        <Certainty ts={tsCertainty} oa={oaCertainty} openaiConfigured={openaiConfigured} />
      </Panel>

      {oaAnswered && (
        <Panel label="Where they differed" icon="search" hint="Each question the models answered differently, and how firmly TypeSafe stood behind its own pick.">
          <Divergences list={differing} compared={compared} />
        </Panel>
      )}

      <Panel label="How each model worked" icon="trace">
        <Anatomy trace={trace} outcome={openaiOutcome} source={source} tsModel={tsModel} openaiConfigured={openaiConfigured} />
      </Panel>
    </div>
  );
}
