import { systemOne, type KeyOverride } from "../typesafe/client";
import { typesafeRequestBytes } from "../typesafe/measure";
import { SKILLS } from "../skills";
import { buildStateJson, type SessionState, type TurnContext } from "./state";
import type { CompositeRisk } from "../skills/clauseRisk";
import type { Answer, QuestionSpec } from "../typesafe/types";
import { composeTurn, type ComplianceFlag } from "./compose";
import { writeReply, type TurnAnswer } from "../chat/answer";

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
 * — not an estimate. `bytes` is the exact UTF-8 byte size of what `systemOne`
 * was sent: the `state` and the question map (see `typesafeRequestBytes`).
 * `historyTurnsIncluded`/`historyTurnsTotal` show how much of the rolling
 * memory window (`HISTORY_WINDOW` in `state.ts`) is actually in play versus
 * how much conversation the session has accumulated. Both count turns (a
 * turn is one user message, with the reply that followed it) and include the
 * message being answered, so on the second message they read 2/2, matching
 * the number of messages the reader has sent. This is what the Trace tab's
 * context-window row is built from.
 */
export interface ContextStats {
  bytes: number;
  documentBytes: number;
  historyTurnsIncluded: number;
  historyTurnsTotal: number;
}

const userTurns = (turns: readonly { role?: string; from?: string }[]) => turns.filter((t) => (t.role ?? t.from) === "user").length;

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
  /** Where `reply` came from: a model, the document's own clauses, or Meridian's templates. `elapsedMs` above is the Jev call only. */
  answer: TurnAnswer;
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
export async function handleTurn(session: SessionState, message: string, override?: KeyOverride, writerOverride?: KeyOverride): Promise<TurnResult> {
  const { stateJson, questions, owner } = buildTurnRequest(session, message);
  const contextStats: ContextStats = {
    bytes: typesafeRequestBytes(stateJson, questions),
    documentBytes: session.activeDocument ? Buffer.byteLength(session.activeDocument.text, "utf8") : 0,
    // +1: the message being answered is in the model's context but not yet in the session's history.
    historyTurnsIncluded: userTurns(stateJson.conversation) + 1,
    historyTurnsTotal: userTurns(session.history) + 1,
  };
  const response = await systemOne(stateJson, questions, override);
  const answers = response.answers;
  const composed = composeTurn(session, answers);
  const { intent: intentSummary, risk, complianceFlags, blocked, used, contractType } = composed;
  if (contractType) session.contextFacts.contractType = contractType;

  // The typed judgments decided what this turn is; a model then writes the answer from the document and those findings.
  // It runs after the Jev call and is timed on its own, so TypeSafe's measured speed never includes it.
  const { reply, answer } = await writeReply({ message, session, answers, composed, citeFlagProbability: true, override: writerOverride });

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
    answer,
  };
}
