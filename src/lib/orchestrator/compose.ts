import { RISK_DIMENSIONS, computeCompositeRisk, type CompositeRisk } from "../skills/clauseRisk";
import { COMPLIANCE_CHECKS, type ComplianceCheckId } from "../skills/complianceGuard";
import { CONTRACT_TYPES } from "../skills/contractType";
import type { Intent } from "../skills/intakeRouter";
import type { Answer, ChoiceAnswer, NoulAnswer, ScoreAnswer } from "../typesafe/types";
import type { SessionState } from "./state";

export interface ComplianceFlag {
  id: ComplianceCheckId;
  label: string;
  probability: number;
  flagged: boolean;
}

/**
 * How Meridian turns a backend's typed answers into a conversational reply: guardrails first, then confidence-gated
 * intent routing, then a template. It is a pure function of the answers, and it is the ONLY place a reply is composed,
 * so TypeSafe's reply and OpenAI's reply (built from OpenAI's answers to the same questions) come out of identical
 * logic and differ only where the backends' judgments differ.
 */
export const INTENT_CONFIDENCE_FLOOR = 0.35;
const CONTRACT_TYPE_CONFIDENCE_FLOOR = 0.4;
/** A guardrail question at or above this probability blocks the turn. */
export const GUARDRAIL_TRIGGER = 0.6;
/** A compliance check at or above this probability is flagged. */
export const COMPLIANCE_FLAG_THRESHOLD = 0.55;
/** A risk rating below this model confidence gets an "have an attorney confirm" hedge in the reply. */
export const LOW_CONFIDENCE_HEDGE = 0.5;

export function buildComplianceFlags(answers: Record<string, Answer>): ComplianceFlag[] {
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
  urgency: ScoreAnswer | undefined
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

  if (risk.lowestConfidence < LOW_CONFIDENCE_HEDGE) {
    lines.push(
      "One of those scores came back with low model confidence — treat it as a starting point and have an attorney confirm before relying on it."
    );
  }

  if (urgency && urgency.score >= 1.5) {
    lines.push("This also reads as time-sensitive — worth prioritizing over routine review queue items.");
  }

  return lines.join(" ");
}

function composeComplianceReply(flags: ComplianceFlag[], citeProbability: boolean): string {
  const triggered = flags.filter((f) => f.flagged);
  if (triggered.length === 0) {
    return "None of the four standard compliance checks tripped their threshold on the loaded document — see the Compliance tab for the full probability on each.";
  }
  return (
    `${triggered.length} compliance flag${triggered.length > 1 ? "s" : ""} tripped: ` +
    triggered.map((f) => (citeProbability ? `${f.label} (${formatPercent(f.probability)})` : f.label)).join(", ") +
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

export interface ComposeOptions {
  /**
   * Whether replies may quote a flag's probability. TypeSafe returns a calibrated one; OpenAI has only a self-reported
   * confidence, which is not a probability, so its replies name the flags without a percentage.
   */
  citeFlagProbability: boolean;
}

export interface ComposedTurn {
  reply: string;
  intent: { choice: string; confidence: number } | null;
  risk: CompositeRisk | null;
  complianceFlags: ComplianceFlag[];
  blocked: "privileged" | "injection" | null;
  /** Which answers the reply actually relied on; the rest were speculative fan-out. */
  used: Set<string>;
  /** A contract type learned this turn that the caller should remember; this function never mutates the session. */
  contractType: string | null;
}

export function composeTurn(session: SessionState, answers: Record<string, Answer>, options: ComposeOptions = { citeFlagProbability: true }): ComposedTurn {
  const used = new Set<string>(["contains_privileged_content", "is_injection_attempt"]);
  const privileged = answers.contains_privileged_content as NoulAnswer | undefined;
  const injection = answers.is_injection_attempt as NoulAnswer | undefined;

  let reply: string;
  let risk: CompositeRisk | null = null;
  let complianceFlags: ComplianceFlag[] = [];
  let intentSummary: ComposedTurn["intent"] = null;
  let blocked: ComposedTurn["blocked"] = null;
  let contractType: string | null = null;

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
      contractType = contractTypeAns.choice;
      used.add("contract_type");
    }

    // Either backend can come back without an answer for a field (OpenAI's tool call may omit one, and a partial
    // TypeSafe response is possible), so a missing intent is "could not route" and a missing urgency is "not urgent".
    const intentAns = answers.intent as ChoiceAnswer | undefined;
    const urgencyAns = answers.urgency as ScoreAnswer | undefined;
    used.add("intent");
    used.add("urgency");
    if (intentAns) intentSummary = { choice: intentAns.choice, confidence: intentAns.confidence };

    if (!intentAns || intentAns.confidence < INTENT_CONFIDENCE_FLOOR) {
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
            reply = composeComplianceReply(complianceFlags, options.citeFlagProbability);
          }
          break;
        }
        case "verify_citation":
          reply = session.activeDocument
            ? "Open the Citations tab. It reads this document, or the passage you highlight, and checks it automatically: every " +
              "reference the text makes against the section it cites, and each key term (renewal, liability, termination and so on) " +
              "against what the playbook expects, with the clause quoted and the figures pulled out."
            : "Load a document first, then open the Citations tab. It reads the document, or a passage you highlight, and checks " +
              "every reference in it against the section it cites, and its key terms against the playbook, automatically.";
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

  return { reply, intent: intentSummary, risk, complianceFlags, blocked, used, contractType };
}
