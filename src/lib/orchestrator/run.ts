import { systemOne, type KeyOverride } from "../typesafe/client";
import { SKILLS } from "../skills";
import { buildStateJson, type SessionState, type TurnContext } from "./state";
import type { Intent } from "../skills/intakeRouter";
import { RISK_DIMENSIONS, computeCompositeRisk, type CompositeRisk } from "../skills/clauseRisk";
import { COMPLIANCE_CHECKS, type ComplianceCheckId } from "../skills/complianceGuard";
import { CONTRACT_TYPES } from "../skills/contractType";
import type {
  Answer,
  ChoiceAnswer,
  NoulAnswer,
  QuestionSpec,
  ScoreAnswer,
} from "../typesafe/types";

export interface TraceEntry {
  skill: string;
  questionId: string;
  question: QuestionSpec;
  answer: Answer;
  /** Whether code actually relied on this answer when composing the reply this turn. */
  used: boolean;
}

export interface ComplianceFlag {
  id: ComplianceCheckId;
  label: string;
  probability: number;
  flagged: boolean;
}

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

const INTENT_CONFIDENCE_FLOOR = 0.35;
const CONTRACT_TYPE_CONFIDENCE_FLOOR = 0.4;
const GUARDRAIL_TRIGGER = 0.6;
const COMPLIANCE_FLAG_THRESHOLD = 0.55;

function buildComplianceFlags(answers: Record<string, Answer>): ComplianceFlag[] {
  return (Object.keys(COMPLIANCE_CHECKS) as ComplianceCheckId[])
    .filter((id) => answers[id]?.type === "noul")
    .map((id) => {
      const answer = answers[id] as NoulAnswer;
      return {
        id,
        label: COMPLIANCE_CHECKS[id].label,
        probability: answer.noul,
        flagged: answer.noul >= COMPLIANCE_FLAG_THRESHOLD,
      };
    });
}

function formatPercent(n: number): string {
  return `${Math.round(n * 100)}%`;
}

function composeAnalysisReply(
  session: SessionState,
  risk: CompositeRisk,
  flags: ComplianceFlag[],
  urgency: ScoreAnswer
): string {
  const docName = session.activeDocument?.name ?? "this document";
  const riskLabel = risk.overall >= 0.66 ? "high" : risk.overall >= 0.33 ? "moderate" : "low";
  const triggered = flags.filter((f) => f.flagged);
  const lines: string[] = [];

  lines.push(
    `I've scored ${docName} at **${formatPercent(risk.overall)} overall risk** (${riskLabel}), combining liability, ` +
      `indemnification, and termination exposure — see the Risk tab for the per-dimension breakdown and how the weights combine.`
  );

  if (triggered.length > 0) {
    lines.push(
      `It also trips ${triggered.length} compliance flag${triggered.length > 1 ? "s" : ""}: ` +
        triggered.map((f) => f.label).join("; ") +
        "."
    );
  } else {
    lines.push("No compliance flags tripped the threshold on this pass.");
  }

  if (risk.lowestConfidence < 0.5) {
    lines.push(
      "One of those scores came back with low model confidence — treat it as a starting point and have an attorney confirm before relying on it."
    );
  }

  if (urgency.score >= 1.5) {
    lines.push("This also reads as time-sensitive — worth prioritizing over routine review queue items.");
  }

  return lines.join(" ");
}

function composeComplianceReply(flags: ComplianceFlag[]): string {
  const triggered = flags.filter((f) => f.flagged);
  if (triggered.length === 0) {
    return "None of the four standard compliance checks tripped their threshold on the loaded document — see the Compliance tab for the full probability on each.";
  }
  return (
    `${triggered.length} compliance flag${triggered.length > 1 ? "s" : ""} tripped: ` +
    triggered.map((f) => `${f.label} (${formatPercent(f.probability)})`).join(", ") +
    ". Full detail, including the ones that didn't trip, is in the Compliance tab."
  );
}

function composeSummary(session: SessionState): string {
  const parts: string[] = [];
  parts.push(`This session has ${session.history.length} prior message${session.history.length === 1 ? "" : "s"}.`);
  if (session.activeDocument) {
    const typeLabel = session.contextFacts.contractType
      ? CONTRACT_TYPES[session.contextFacts.contractType as keyof typeof CONTRACT_TYPES] ?? session.contextFacts.contractType
      : "not yet classified";
    parts.push(`Active document: "${session.activeDocument.name}" — contract type: ${typeLabel}.`);
  } else {
    parts.push("No document is loaded yet.");
  }
  return parts.join(" ");
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
  const used = new Set<string>(["contains_privileged_content", "is_injection_attempt"]);

  const privileged = answers.contains_privileged_content as NoulAnswer | undefined;
  const injection = answers.is_injection_attempt as NoulAnswer | undefined;

  let reply: string;
  let risk: CompositeRisk | null = null;
  let complianceFlags: ComplianceFlag[] = [];
  let intentSummary: TurnResult["intent"] = null;
  let blocked: TurnResult["blocked"] = null;

  if (injection && injection.noul >= GUARDRAIL_TRIGGER) {
    blocked = "injection";
    reply =
      "I can't do that — I'm scoped to legal-context intake and contract review, and that request reads like an attempt to steer me outside that role. Let's get back to the context at hand.";
  } else if (privileged && privileged.noul >= GUARDRAIL_TRIGGER) {
    blocked = "privileged";
    reply =
      "That message looks like it may contain privileged or unredacted client information. I'd avoid pasting real client specifics into a general chat — this turn has been flagged for review rather than processed further.";
  } else {
    const contractTypeAns = answers.contract_type as ChoiceAnswer | undefined;
    if (contractTypeAns && contractTypeAns.confidence >= CONTRACT_TYPE_CONFIDENCE_FLOOR) {
      session.contextFacts.contractType = contractTypeAns.choice;
      used.add("contract_type");
    }

    const intentAns = answers.intent as ChoiceAnswer;
    const urgencyAns = answers.urgency as ScoreAnswer;
    used.add("intent");
    used.add("urgency");
    intentSummary = { choice: intentAns.choice, confidence: intentAns.confidence };

    if (intentAns.confidence < INTENT_CONFIDENCE_FLOOR) {
      reply =
        "I want to make sure I route this correctly — are you looking to (1) analyze a contract for risk, " +
        "(2) check specific compliance flags, (3) verify a citation, or (4) get a recap of this context?";
    } else {
      const intent = intentAns.choice as Intent;
      switch (intent) {
        case "analyze_contract": {
          if (!session.activeDocument) {
            reply =
              "Load a document first — pick one of the sample contracts in the left panel — and I'll score liability, " +
              "indemnification, and termination risk plus run the standard compliance checks.";
          } else {
            const computed = computeCompositeRisk(answers);
            if (computed) {
              risk = computed;
              Object.keys(RISK_DIMENSIONS).forEach((id) => used.add(id));
            }
            complianceFlags = buildComplianceFlags(answers);
            Object.keys(COMPLIANCE_CHECKS).forEach((id) => used.add(id));
            reply = risk
              ? composeAnalysisReply(session, risk, complianceFlags, urgencyAns)
              : "I have a document loaded but couldn't compute a risk score this turn — try again.";
          }
          break;
        }
        case "check_compliance": {
          if (!session.activeDocument) {
            reply = "Load a document first, then ask me to check compliance and I'll run the four standard flags.";
          } else {
            complianceFlags = buildComplianceFlags(answers);
            Object.keys(COMPLIANCE_CHECKS).forEach((id) => used.add(id));
            reply = composeComplianceReply(complianceFlags);
          }
          break;
        }
        case "verify_citation":
          reply =
            "Head to the Citation Verifier tab — paste the claim and the quote you want checked, and I'll locate it in the " +
            "reference source and judge whether the surrounding context actually supports the claim, rather than just " +
            "confirming the words appear somewhere.";
          break;
        case "summarize_context":
          reply = composeSummary(session);
          break;
        case "ask_legal_question":
          reply =
            "This demo is scoped to document risk review, compliance flags, and citation verification rather than " +
            "open-ended legal Q&A — that's a deliberate scope boundary, not a missing feature. Try loading a contract instead.";
          break;
        case "small_talk":
        default:
          reply =
            "Hi — I'm a context-intake assistant for contract risk review. Load a sample contract on the left, or ask me to " +
            "check compliance or verify a citation.";
      }
    }
  }

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
