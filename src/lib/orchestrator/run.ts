import { systemOne, type KeyOverride } from "../typesafe/client";
import { SKILLS } from "../skills";
import { buildStateJson, type SessionState, type TurnContext } from "./state";
import type { CompositeRisk } from "../skills/clauseRisk";
import type { Answer, QuestionSpec } from "../typesafe/types";
import { composeTurn, type ComplianceFlag } from "./compose";

export interface TraceEntry {
  skill: string;
  questionId: string;
  question: QuestionSpec;
  answer: Answer;
  /** Whether code actually relied on this answer when composing the reply this turn. */
  used: boolean;
}

export type { ComplianceFlag } from "./compose";

/**
 * Real, measured figures about what actually went into this turn's `state`
 * — not an estimate. `bytes` is the exact UTF-8 byte size of the object
 * `systemOne` was called with (`Buffer.byteLength`, not `.length` — legal
 * text has plenty of non-ASCII punctuation that would otherwise undercount);
 * `historyTurnsIncluded`/`historyTurnsTotal` show how much of the rolling
 * memory window (`HISTORY_WINDOW` in `state.ts`) is actually in play versus
 * how much history the session has accumulated. This is what the Trace
 * tab's context-window row is built from.
 */
export interface ContextStats {
  bytes: number;
  documentBytes: number;
  historyTurnsIncluded: number;
  historyTurnsTotal: number;
}

export interface TurnResult {
  reply: string;
  trace: TraceEntry[];
  source: "live" | "mock";
  intent: { choice: string; confidence: number } | null;
  risk: CompositeRisk | null;
  complianceFlags: ComplianceFlag[];
  blocked: "privileged" | "injection" | null;
  usage: { input_tokens: number; output_tokens: number };
  elapsedMs: number;
  context: ContextStats;
}

export interface TurnRequest {
  stateJson: ReturnType<typeof buildStateJson>;
  questions: Record<string, QuestionSpec>;
  owner: Record<string, string>;
}

/**
 * Builds the exact same `state` + question map handleTurn sends to Jev,
 * without calling anything. This is the seam the "TypeSafe vs OpenAI"
 * comparison hangs off of: /api/compare-openai calls this to get an
 * identical question set, then runs it through OpenAI independently — a
 * genuinely separate request the client fires concurrently with the main
 * chat turn, not a value smuggled back on the chat response. That's what
 * makes the two activity windows in the UI real: each is driven by its own
 * network request, resolving on its own, not two halves of one bundle.
 */
export function buildTurnRequest(session: SessionState, message: string): TurnRequest {
  const ctx: TurnContext = { latestMessage: message, session };
  const stateJson = buildStateJson(ctx);
  const questions: Record<string, QuestionSpec> = {};
  const owner: Record<string, string> = {};
  for (const skill of SKILLS) {
    if (!skill.isApplicable(ctx)) continue;
    for (const [id, q] of Object.entries(skill.buildQuestions(ctx))) {
      questions[id] = q;
      owner[id] = skill.name;
    }
  }
  return { stateJson, questions, owner };
}

/**
 * The orchestrator: one Jev call per turn, composed from every
 * applicable skill's questions (speculative fan-out), then plain code —
 * confidence gates, a switch on the routed intent, template strings — reads
 * the answers it needs and ignores the rest. Nothing here generates
 * free-form text with a model; the model supplies typed judgments, and code
 * owns the conversation, exactly as recommended in
 * docs.typesafe.ai/concepts/how-to-build-with-system-one.
 */
export async function handleTurn(session: SessionState, message: string, override?: KeyOverride): Promise<TurnResult> {
  const { stateJson, questions, owner } = buildTurnRequest(session, message);
  const contextStats: ContextStats = {
    bytes: Buffer.byteLength(JSON.stringify(stateJson), "utf8"),
    documentBytes: session.activeDocument ? Buffer.byteLength(session.activeDocument.text, "utf8") : 0,
    historyTurnsIncluded: stateJson.conversation.length,
    historyTurnsTotal: session.history.length,
  };
  const response = await systemOne(stateJson, questions, override);
  const answers = response.answers;
  const { reply, intent: intentSummary, risk, complianceFlags, blocked, used, contractType } = composeTurn(session, answers);
  if (contractType) session.contextFacts.contractType = contractType;

  session.history.push({ role: "user", text: message });
  session.history.push({ role: "assistant", text: reply });

  const trace: TraceEntry[] = Object.entries(answers).map(([id, answer]) => ({
    skill: owner[id] ?? "unknown",
    questionId: id,
    question: questions[id],
    answer,
    used: used.has(id),
  }));

  return {
    reply,
    trace,
    source: response.source,
    intent: intentSummary,
    risk,
    complianceFlags,
    blocked,
    usage: response.usage,
    elapsedMs: response.elapsedMs,
    context: contextStats,
  };
}
