import type { Answer, QuestionSpec } from "../typesafe/types";
import type { OpenAIFieldAnswer, OpenAIReasoning, OpenAIRunOutcome } from "../openai/types";
import type { TraceEntry } from "../orchestrator/run";
import type { TurnAnswer } from "../chat/answer";
import { CONTRACT_TYPE_CONFIDENCE_FLOOR, GUARDRAIL_TRIGGER, INTENT_CONFIDENCE_FLOOR } from "../orchestrator/compose";
import { RISK_BAND_LABELS, RISK_DIMENSIONS, riskBand } from "../skills/clauseRisk";
import { COMPLIANCE_CHECKS } from "../skills/complianceGuard";
import { CONTRACT_TYPES } from "../skills/contractType";
import type { Intent } from "../skills/intakeRouter";
import { openaiAnswersToTyped } from "../openai/answers";
import { formatElapsed } from "../activity/log";
import { agrees, openaiAnswerFor } from "../compare/agreement";
import { questionLabel } from "./labels";

/**
 * What the Trace tab says about HOW each model reached its answers, as opposed to WHAT the answers were (Risk and Compliance
 * show those). Everything here is a pure function of what the two backends actually returned:
 *
 *  - TypeSafe returns a probability for every option of every question.
 *  - OpenAI returns one pick per question and a confidence it reports about itself, from a single forced function call.
 *    A reasoning model thinks first and returns a summary of that reasoning (never the raw chain of thought); TypeSafe
 *    has no reasoning step. Beside whatever OpenAI summarizes, the "thinking" shown is the decision path the app's own
 *    code takes from each backend's answers, which is the part that decides what the reader is told.
 */

const pct = (x: number) => `${Math.round(x * 100)}%`;

/** A pick held with less than this much probability (or reported confidence) is a close call. */
export const CLOSE_CALL = 0.65;
/** A pick held at least this firmly is near-certain. */
export const NEAR_CERTAIN = 0.95;
/** A reading within this distance of the threshold that decided it could easily have gone the other way. */
export const NEAR_GATE = 0.1;
/** TypeSafe's probability on its pick at or above which a disagreement with OpenAI is firm rather than a lean. */
const FIRM = 0.8;

export type Basis = "calibrated" | "self-reported";

/** Which part of the app a question feeds. Risk and compliance answers are shown on their own tabs. */
export type Area = "guardrail" | "routing" | "classification" | "risk" | "compliance" | "other";

export function areaOf(id: string): Area {
  if (id === "contains_privileged_content" || id === "is_injection_attempt") return "guardrail";
  if (id === "intent" || id === "urgency") return "routing";
  if (id === "contract_type") return "classification";
  if (id in RISK_DIMENSIONS) return "risk";
  if (id in COMPLIANCE_CHECKS) return "compliance";
  return "other";
}

/** Guardrail and routing answers steer what the app does next; the rest only feed a rating or a flag. */
const steers = (area: Area) => area === "guardrail" || area === "routing" || area === "classification";

// ---- one answer, read the same way for both backends -------------------------------------------------------------------

export interface Judgment {
  id: string;
  label: string;
  area: Area;
  basis: Basis;
  /** The raw pick: an option key, a level, or "yes"/"no". */
  pick: string;
  /** The pick in words. */
  decision: string;
  /** How firmly the backend stood behind its pick: TypeSafe's probability on it, or the confidence OpenAI reported. Null when OpenAI reported none. */
  strength: number | null;
  /** One line: the pick and the figure behind it. */
  reading: string;
  /** Every option with its probability, most likely first. TypeSafe only. */
  distribution: { option: string; probability: number }[] | null;
  /** Gap between the two most likely options. TypeSafe only. */
  margin: number | null;
}

function marginOf(distribution: { probability: number }[]): number | null {
  const sorted = [...distribution].sort((a, b) => b.probability - a.probability);
  return sorted.length >= 2 ? sorted[0].probability - sorted[1].probability : null;
}

export function typesafeJudgment(id: string, answer: Answer): Judgment {
  const base = { id, label: questionLabel(id), area: areaOf(id), basis: "calibrated" as const };
  if (answer.type === "noul") {
    const yes = answer.noul >= 0.5;
    const strength = yes ? answer.noul : 1 - answer.noul;
    const distribution = [
      { option: "Yes", probability: answer.noul },
      { option: "No", probability: 1 - answer.noul },
    ].sort((a, b) => b.probability - a.probability);
    return { ...base, pick: yes ? "yes" : "no", decision: yes ? "Yes" : "No", strength, reading: `${yes ? "Yes" : "No"} · ${pct(answer.noul)} probability of yes`, distribution, margin: marginOf(distribution) };
  }
  const distribution = Object.entries(answer.probabilities)
    .map(([option, probability]) => ({ option, probability }))
    .sort((a, b) => b.probability - a.probability);
  if (answer.type === "choice") {
    const strength = answer.probabilities[answer.choice] ?? answer.confidence;
    return { ...base, pick: answer.choice, decision: answer.choice, strength, reading: `${answer.choice} · ${pct(strength)}, confidence ${pct(answer.confidence)}`, distribution, margin: marginOf(distribution) };
  }
  const level = Math.round(answer.score);
  const strength = answer.probabilities[String(level)] ?? null;
  return {
    ...base,
    pick: String(level),
    decision: `Level ${level}`,
    strength,
    reading: `Level ${level} (score ${answer.score.toFixed(2)})${strength != null ? ` · ${pct(strength)}` : ""}`,
    distribution,
    margin: marginOf(distribution),
  };
}

export function openaiJudgment(id: string, spec: QuestionSpec, field: OpenAIFieldAnswer): Judgment {
  const base = { id, label: questionLabel(id), area: areaOf(id), basis: "self-reported" as const, distribution: null, margin: null };
  const strength = field.selfReportedConfidence;
  const tail = strength != null ? ` · self-reported ${pct(strength)}` : " · no confidence reported";
  if (spec.type === "noul") {
    const yes = Boolean(field.value);
    return { ...base, pick: yes ? "yes" : "no", decision: yes ? "Yes" : "No", strength, reading: `${yes ? "Yes" : "No"}${tail}` };
  }
  if (spec.type === "score") {
    return { ...base, pick: String(field.value), decision: `Level ${field.value}`, strength, reading: `Level ${field.value}${tail}` };
  }
  return { ...base, pick: String(field.value), decision: String(field.value), strength, reading: `${field.value}${tail}` };
}

export interface Judgments {
  typesafe: Record<string, Judgment>;
  /** Empty when OpenAI has not answered. */
  openai: Record<string, Judgment>;
}

export function judgmentsFor(trace: readonly TraceEntry[], outcome: OpenAIRunOutcome | null): Judgments {
  const typesafe: Record<string, Judgment> = {};
  const openai: Record<string, Judgment> = {};
  for (const entry of trace) {
    typesafe[entry.questionId] = typesafeJudgment(entry.questionId, entry.answer);
    const oa = openaiAnswerFor(outcome, entry.questionId);
    if (oa) openai[entry.questionId] = openaiJudgment(entry.questionId, entry.question, oa);
  }
  return { typesafe, openai };
}

// ---- the decision path -------------------------------------------------------------------------------------------------

export const INTENT_ACTIONS: Record<Intent, string> = {
  analyze_contract: "score the three risk dimensions and run the compliance checks",
  check_compliance: "run the four compliance checks",
  verify_citation: "point the reader to the Citations tab",
  summarize_context: "recap the session so far",
  ask_legal_question: "decline: open-ended legal Q&A is outside this demo's scope",
  small_talk: "greet the reader and offer next steps",
};

export type StepKey = "injection" | "privileged" | "intent" | "contract_type" | "reply";
/** pass: the step let the turn continue. stop: it ended the turn. skipped: an earlier step ended it. missing: the backend gave no answer for it. */
export type StepStatus = "pass" | "stop" | "skipped" | "missing";

export interface PathStep {
  key: StepKey;
  title: string;
  /** What the backend returned for this step. */
  reading: string;
  /** The app's own rule applied to that reading. */
  rule: string;
  /** What the rule did with it. */
  result: string;
  status: StepStatus;
  /** How far the reading was from the threshold that decided it (TypeSafe only, where the reading is a probability). */
  margin: number | null;
  /** The reading was close enough to the threshold that a small change would have flipped the result. */
  near: boolean;
  /** One more fact worth showing under the result. */
  note?: string;
}

function step(partial: Pick<PathStep, "key" | "title" | "rule" | "result" | "status"> & Partial<PathStep>): PathStep {
  return { reading: "\u2014", margin: null, near: false, ...partial };
}

function guardStep(key: "injection" | "privileged", title: string, id: string, typed: Record<string, Answer>, judged: Record<string, Judgment>, basis: Basis, halted: boolean): PathStep {
  const rule =
    basis === "calibrated"
      ? `Blocks the turn at ${pct(GUARDRAIL_TRIGGER)} probability of yes or more`
      : "Blocks the turn on a yes (OpenAI's yes/no counts as 0% or 100%)";
  if (halted) return step({ key, title, rule, result: "Not reached: an earlier screen already ended the turn", status: "skipped" });
  const answer = typed[id];
  if (answer?.type !== "noul") return step({ key, title, rule, reading: "no answer", result: "No answer, so it could not block the turn", status: "missing" });
  const tripped = answer.noul >= GUARDRAIL_TRIGGER;
  const margin = basis === "calibrated" ? Math.abs(answer.noul - GUARDRAIL_TRIGGER) : null;
  return step({
    key,
    title,
    reading: judged[id]?.reading ?? "no answer",
    rule,
    result: tripped ? "Blocked: the reply is a fixed refusal" : "Cleared",
    status: tripped ? "stop" : "pass",
    margin,
    near: margin != null && margin < NEAR_GATE,
  });
}

/** What the reader is told about the writer: which model wrote the reply, how long it took, or why no model did. */
export function replyStep(answer: TurnAnswer | null | undefined, blocked: boolean): PathStep {
  const base = { key: "reply" as const, title: "Reply written", rule: "The wording is written from the findings above; the model is not asked to judge anything" };
  if (blocked) return step({ ...base, reading: "Guardrail refusal", result: "Fixed wording. No model writes a refused reply", status: "pass" });
  if (!answer) return step({ ...base, reading: "no reply recorded", result: "No reply recorded", status: "missing" });
  if (answer.source === "model") {
    const tokens = answer.usage ? ` · ${answer.usage.input_tokens.toLocaleString("en-US")} in / ${answer.usage.output_tokens.toLocaleString("en-US")} out` : "";
    return step({ ...base, reading: `${answer.model ?? "A model"}${answer.elapsedMs != null ? ` · ${formatElapsed(answer.elapsedMs)}` : ""}${tokens}`, result: "Written by a model from the document and the findings", status: "pass", note: answer.note });
  }
  if (answer.source === "document") return step({ ...base, reading: "No model", result: "Quoted the document's own clauses", status: "pass", note: answer.note });
  return step({ ...base, reading: "No model", result: "Meridian's own template wording", status: "pass", note: answer.note });
}

/**
 * The steps the app's code takes, in order, from one backend's answers to the reply: the guardrail screens, the
 * confidence-gated intent route, the contract-type memory, and who wrote the reply. It mirrors the gates in
 * orchestrator/compose.ts using that file's own thresholds (a test holds the two together), so the path is the real
 * reasoning the reply followed and not a description of it.
 */
export function buildPath(args: {
  typed: Record<string, Answer>;
  judgments: Record<string, Judgment>;
  basis: Basis;
  hasDocument: boolean;
  answer: TurnAnswer | null | undefined;
}): PathStep[] {
  const { typed, judgments, basis, hasDocument, answer } = args;
  const injection = guardStep("injection", "Prompt-injection screen", "is_injection_attempt", typed, judgments, basis, false);
  const privileged = guardStep("privileged", "Privileged-content screen", "contains_privileged_content", typed, judgments, basis, injection.status === "stop");
  const halted = injection.status === "stop" || privileged.status === "stop";
  const steps: PathStep[] = [injection, privileged];

  const intentRule = `Routes at ${pct(INTENT_CONFIDENCE_FLOOR)} confidence or more; below that the reader is asked to clarify`;
  const intent = typed.intent;
  if (halted) {
    steps.push(step({ key: "intent", title: "Intent route", rule: intentRule, result: "Not reached: the turn was blocked", status: "skipped" }));
  } else if (intent?.type !== "choice") {
    steps.push(step({ key: "intent", title: "Intent route", rule: intentRule, reading: "no answer", result: "No answer: the reader is asked what they want to do", status: "missing" }));
  } else {
    const routed = intent.confidence >= INTENT_CONFIDENCE_FLOOR;
    const margin = Math.abs(intent.confidence - INTENT_CONFIDENCE_FLOOR);
    const choice = intent.choice as Intent;
    const needsDocument = choice === "analyze_contract" || choice === "check_compliance";
    const next = judgments.intent?.distribution?.[1];
    steps.push(
      step({
        key: "intent",
        title: "Intent route",
        reading: judgments.intent?.reading ?? intent.choice,
        rule: intentRule,
        result: !routed ? "Too unsure to route: the reader is asked what they want to do" : needsDocument && !hasDocument ? `Routed to ${choice}, but no document is loaded, so the reader is asked to load one` : `Routed to ${choice}: ${INTENT_ACTIONS[choice] ?? "no action defined"}`,
        status: routed ? "pass" : "stop",
        // Confidence is a probability on TypeSafe's side; on OpenAI's it is only what it said about itself.
        margin: basis === "calibrated" ? margin : null,
        near: basis === "calibrated" && margin < NEAR_GATE,
        note: basis === "calibrated" && next ? `Next most likely: ${next.option} at ${pct(next.probability)}` : undefined,
      }),
    );

    const type = typed.contract_type;
    if (type?.type === "choice") {
      const remembered = type.confidence >= CONTRACT_TYPE_CONFIDENCE_FLOOR;
      const typeMargin = Math.abs(type.confidence - CONTRACT_TYPE_CONFIDENCE_FLOOR);
      const named = CONTRACT_TYPES[type.choice as keyof typeof CONTRACT_TYPES] ?? type.choice;
      steps.push(
        step({
          key: "contract_type",
          title: "Contract type",
          reading: judgments.contract_type?.reading ?? type.choice,
          rule: `Remembered for the session at ${pct(CONTRACT_TYPE_CONFIDENCE_FLOOR)} confidence or more`,
          result: remembered ? `Remembered as: ${named}` : "Too unsure: not remembered, asked again next time",
          status: remembered ? "pass" : "stop",
          margin: basis === "calibrated" ? typeMargin : null,
          near: basis === "calibrated" && typeMargin < NEAR_GATE,
        }),
      );
    }
  }

  steps.push(replyStep(answer, injection.status === "stop" || privileged.status === "stop"));
  return steps;
}

/** The typed answers the app's own code reads for one backend: TypeSafe's as returned, OpenAI's as translated by the shared pipeline. */
export function typedAnswers(trace: readonly TraceEntry[], outcome: OpenAIRunOutcome | null): { typesafe: Record<string, Answer>; openai: Record<string, Answer> } {
  const typesafe: Record<string, Answer> = {};
  const questions: Record<string, QuestionSpec> = {};
  for (const e of trace) {
    typesafe[e.questionId] = e.answer;
    questions[e.questionId] = e.question;
  }
  return { typesafe, openai: outcome?.ok ? openaiAnswersToTyped(outcome.result.answers, questions) : {} };
}

// ---- probability detail for the questions Risk and Compliance do not show --------------------------------------------

export interface DistributionOption {
  key: string;
  /** What choosing this option means, from the question's own criteria. */
  description: string | null;
  tsProbability: number;
  tsPicked: boolean;
  oaPicked: boolean;
}

export interface DistributionView {
  id: string;
  label: string;
  instructions: string;
  options: DistributionOption[];
  /** OpenAI's confidence in its pick, or null when it reported none or did not answer. */
  oaStrength: number | null;
  oaAnswered: boolean;
}

const text = (v: unknown) => (typeof v === "string" ? v : v == null ? null : JSON.stringify(v));

/** The full distribution behind every routing and classification question: intent, urgency and contract type. */
export function distributionsFor(trace: readonly TraceEntry[], judgments: Judgments): DistributionView[] {
  const views: DistributionView[] = [];
  for (const entry of trace) {
    const { questionId: id, question, answer } = entry;
    const area = areaOf(id);
    if ((area !== "routing" && area !== "classification") || question.type === "noul" || answer.type === "noul") continue;
    const oa = judgments.openai[id];
    const tsPick = judgments.typesafe[id]?.pick;
    let options: DistributionOption[];
    if (question.type === "choice" && answer.type === "choice") {
      options = Object.entries(question.criteria)
        .map(([key, description]) => ({ key, description: text(description), tsProbability: answer.probabilities[key] ?? 0, tsPicked: key === tsPick, oaPicked: oa?.pick === key }))
        .sort((a, b) => b.tsProbability - a.tsProbability);
    } else if (question.type === "score" && answer.type === "score") {
      options = question.criteria.map((description, level) => ({ key: `Level ${level}`, description: text(description), tsProbability: answer.probabilities[String(level)] ?? 0, tsPicked: String(level) === tsPick, oaPicked: oa?.pick === String(level) }));
    } else continue;
    views.push({ id, label: questionLabel(id), instructions: text(question.instructions) ?? "", options, oaStrength: oa?.strength ?? null, oaAnswered: Boolean(oa) });
  }
  return views;
}

// ---- how sure each model was, across every answer -------------------------------------------------------------------

export interface CertaintyProfile {
  answered: number;
  /** Average of `strength` over the answers that have one. */
  meanStrength: number | null;
  /** Answers held at NEAR_CERTAIN or more. */
  nearCertain: number;
  /** Answers held at less than CLOSE_CALL. */
  closeCalls: number;
  /** Answers with no confidence at all (OpenAI left it out). */
  unreported: number;
  lowest: Judgment | null;
}

export function certaintyProfile(judgments: readonly Judgment[]): CertaintyProfile {
  const withStrength = judgments.filter((j): j is Judgment & { strength: number } => j.strength != null);
  let lowest: (Judgment & { strength: number }) | null = null;
  for (const j of withStrength) if (lowest == null || j.strength < lowest.strength) lowest = j;
  return {
    answered: judgments.length,
    meanStrength: withStrength.length ? withStrength.reduce((sum, j) => sum + j.strength, 0) / withStrength.length : null,
    nearCertain: withStrength.filter((j) => j.strength >= NEAR_CERTAIN).length,
    closeCalls: withStrength.filter((j) => j.strength < CLOSE_CALL).length,
    unreported: judgments.length - withStrength.length,
    lowest,
  };
}

// ---- where the two models parted ways ----------------------------------------------------------------------------------

/**
 * How much a disagreement says. A coin-flip is TypeSafe itself being torn (its pick held under CLOSE_CALL), so OpenAI's
 * different pick is a threshold artifact more than a real conflict. Firm means TypeSafe was sure and OpenAI went the other way.
 */
export type Severity = "coin-flip" | "leaning" | "firm";

export interface Divergence {
  id: string;
  label: string;
  area: Area;
  typesafe: Judgment;
  openai: Judgment;
  severity: Severity;
  /** The question steers what the app does next, so the two models were sent down different paths. */
  steers: boolean;
}

export function severityOf(typesafe: Judgment): Severity {
  const s = typesafe.strength;
  return s == null ? "leaning" : s < CLOSE_CALL ? "coin-flip" : s >= FIRM ? "firm" : "leaning";
}

const SEVERITY_RANK: Record<Severity, number> = { firm: 0, leaning: 1, "coin-flip": 2 };

/** Every question the two models answered differently, the ones that steer the app first and the firmest first. */
export function divergences(trace: readonly TraceEntry[], judgments: Judgments, outcome: OpenAIRunOutcome | null): Divergence[] {
  const out: Divergence[] = [];
  for (const entry of trace) {
    const oa = judgments.openai[entry.questionId];
    const ts = judgments.typesafe[entry.questionId];
    const raw = openaiAnswerFor(outcome, entry.questionId);
    if (!oa || !ts || !raw || agrees(entry.answer, raw.value)) continue;
    out.push({ id: entry.questionId, label: ts.label, area: ts.area, typesafe: ts, openai: oa, severity: severityOf(ts), steers: steers(ts.area) });
  }
  return out.sort((a, b) => Number(b.steers) - Number(a.steers) || SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
}

// ---- final results, side by side ---------------------------------------------------------------------------------------

export interface TurnOutcome {
  /** Compares equal when two backends took the same route. */
  routeKey: string;
  route: string;
  riskOverall: number | null;
  riskLabel: string | null;
  /** Labels of the compliance flags that tripped; null when the turn ran no compliance checks. */
  flagsTripped: string[] | null;
}

export function summarizeOutcome(args: {
  blocked: "privileged" | "injection" | null;
  path: readonly PathStep[];
  risk: { overall: number } | null;
  flags: readonly { label: string; flagged: boolean }[];
}): TurnOutcome {
  const { blocked, path, risk, flags } = args;
  const intent = path.find((s) => s.key === "intent");
  const routed = intent?.status === "pass" ? /^Routed to (\w+)/.exec(intent.result)?.[1] : undefined;
  const routeKey = blocked ? `blocked:${blocked}` : (routed ?? "unrouted");
  return {
    routeKey,
    route: blocked ? `Blocked (${blocked === "injection" ? "prompt injection" : "privileged content"})` : routed ? routed : "Could not route",
    riskOverall: risk?.overall ?? null,
    riskLabel: risk ? RISK_BAND_LABELS[riskBand(risk.overall)] : null,
    flagsTripped: flags.length ? flags.filter((f) => f.flagged).map((f) => f.label) : null,
  };
}

export interface OutcomeFact {
  label: string;
  typesafe: string;
  openai: string;
  same: boolean;
}

export function compareOutcomes(ts: TurnOutcome, oa: TurnOutcome | null): { facts: OutcomeFact[]; headline: string } {
  if (!oa) return { facts: [], headline: "Only TypeSafe answered this turn, so there is nothing to compare it with." };
  const facts: OutcomeFact[] = [{ label: "Route taken", typesafe: ts.route, openai: oa.route, same: ts.routeKey === oa.routeKey }];
  if (ts.riskOverall != null || oa.riskOverall != null) {
    const show = (o: TurnOutcome) => (o.riskOverall == null ? "no score" : `${pct(o.riskOverall)} · ${o.riskLabel}`);
    facts.push({ label: "Overall risk", typesafe: show(ts), openai: show(oa), same: ts.riskLabel === oa.riskLabel });
  }
  if (ts.flagsTripped != null || oa.flagsTripped != null) {
    const show = (o: TurnOutcome) => (o.flagsTripped == null ? "not run" : o.flagsTripped.length === 0 ? "none tripped" : `${o.flagsTripped.length} tripped`);
    const a = [...(ts.flagsTripped ?? [])].sort().join("|");
    const b = [...(oa.flagsTripped ?? [])].sort().join("|");
    facts.push({ label: "Compliance flags", typesafe: show(ts), openai: show(oa), same: a === b });
  }
  const apart = facts.filter((f) => !f.same).map((f) => f.label.toLowerCase());
  return {
    facts,
    headline: apart.length === 0 ? "Both models took the same route and reached the same results." : `The models parted ways on: ${apart.join(", ")}.`,
  };
}

// ---- coverage of the one shared call -------------------------------------------------------------------------------------

export interface Coverage {
  /** Questions in the call (every one TypeSafe answered). */
  asked: number;
  openaiAnswered: number;
  /** Questions the reply relied on. */
  used: number;
  /** Questions fetched speculatively in the same call that this turn did not need. */
  speculative: number;
}

export function coverageOf(trace: readonly TraceEntry[], outcome: OpenAIRunOutcome | null): Coverage {
  const used = trace.filter((e) => e.used).length;
  return {
    asked: trace.length,
    openaiAnswered: outcome?.ok ? trace.filter((e) => openaiAnswerFor(outcome, e.questionId)).length : 0,
    used,
    speculative: trace.length - used,
  };
}

// ---- OpenAI's reasoning -------------------------------------------------------------------------------------------------------

export type ReasoningView =
  /** The model does not reason (the fallback model, for instance). */
  | { state: "not-applicable" }
  /** A reasoning model that did not reason: turned off, or the API refused it. */
  | { state: "off"; note: string }
  | { state: "on"; effort: string; tokens: number | null; summary: string | null };

export function reasoningView(reasoning: OpenAIReasoning | undefined): ReasoningView {
  if (!reasoning) return { state: "not-applicable" };
  if (reasoning.effort === "none") return { state: "off", note: reasoning.note ?? "Reasoning was off for this call." };
  return { state: "on", effort: reasoning.effort, tokens: reasoning.tokens, summary: reasoning.summary };
}
