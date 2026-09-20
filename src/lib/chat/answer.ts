import { randomBytes } from "node:crypto";
import { INTENT_CONFIDENCE_FLOOR, buildComplianceFlags, type ComposedTurn } from "../orchestrator/compose";
import type { SessionState } from "../orchestrator/state";
import { RISK_BAND_LABELS, RISK_DIMENSIONS, computeCompositeRisk, riskBand } from "../skills/clauseRisk";
import { CONTRACT_TYPES } from "../skills/contractType";
import type { Answer } from "../typesafe/types";
import type { KeyOverride } from "../typesafe/client";
import { chatCompletion } from "../openai/chat";
import { openaiCostUsd } from "../compare/openaiEquivalent";
import { buildExtractiveAnswer } from "./extractive";
import { buildAnswerMessages, type AnswerAnalysis } from "./prompt";

/**
 * Where a turn's reply text comes from, so the UI can be honest about it:
 *   model     a model wrote it, grounded in the document and the app's findings
 *   document  no model was used; it quotes the clauses most relevant to the question
 *   template  Meridian's own wording (analysis and compliance summaries, guardrail refusals, greetings)
 */
export interface TurnAnswer {
  source: "model" | "document" | "template";
  model?: string;
  usage?: { input_tokens: number; output_tokens: number };
  elapsedMs?: number;
  costUsd?: number;
  /** Why a model answer was not used when one was expected (a failed call), or that the requested model was swapped. */
  note?: string;
}

export interface WrittenReply {
  reply: string;
  answer: TurnAnswer;
}

/** The findings this backend's judgments support, handed to the writer as fixed facts. */
export function analysisFor(session: SessionState, answers: Record<string, Answer>, composed: ComposedTurn, citeFlagProbability: boolean): AnswerAnalysis {
  const risk = computeCompositeRisk(answers);
  const typeId = composed.contractType ?? session.contextFacts.contractType ?? null;
  return {
    risk: risk
      ? {
          overall: risk.overall,
          band: RISK_BAND_LABELS[riskBand(risk.overall)],
          dimensions: risk.perDimension.map((d) => ({ label: RISK_DIMENSIONS[d.id].label, normalized: d.normalized })),
        }
      : null,
    flags: buildComplianceFlags(answers).map((f) => ({ label: f.label, flagged: f.flagged, ...(citeFlagProbability ? { probability: f.probability } : {}) })),
    contractType: typeId ? (CONTRACT_TYPES[typeId as keyof typeof CONTRACT_TYPES] ?? typeId) : null,
    intent: composed.intent?.choice ?? null,
  };
}

/** Intents whose template reply is a refusal or a stub, and so are worth replacing with the document's own words when no model is available. */
const THIN_INTENTS = new Set(["ask_legal_question", "summarize_context"]);

/**
 * Turns a composed turn into the reply the reader sees. Guardrail refusals are never rewritten. Otherwise a model writes
 * the answer when an OpenAI key is available (the one saved in Settings, or OPENAI_API_KEY); if it cannot, the reply is
 * the document's own relevant clauses (for the thin intents) or the template, and `note` says why.
 */
export async function writeReply(args: {
  message: string;
  session: SessionState;
  answers: Record<string, Answer>;
  composed: ComposedTurn;
  citeFlagProbability: boolean;
  override?: KeyOverride;
}): Promise<WrittenReply> {
  const { message, session, answers, composed, citeFlagProbability, override } = args;
  const template: WrittenReply = { reply: composed.reply, answer: { source: "template" } };
  if (composed.blocked) return template;

  const analysis = analysisFor(session, answers, composed, citeFlagProbability);
  const document = session.activeDocument ? { name: session.activeDocument.name, text: session.activeDocument.text } : null;

  const written = await chatCompletion(
    buildAnswerMessages({ message, history: session.history, document, analysis }, randomBytes(6).toString("hex")),
    override,
  );
  if (written.ok) {
    return {
      reply: written.text,
      answer: {
        source: "model",
        model: written.model,
        usage: written.usage,
        elapsedMs: written.elapsedMs,
        costUsd: openaiCostUsd(written.model, written.usage),
        ...(written.fallbackFrom ? { note: `${written.fallbackFrom} was not available on this key, so ${written.model} wrote this answer.` } : {}),
      },
    };
  }

  const note = written.reason === "error" ? `The answer model could not be reached (${written.message ?? "unknown error"}), so this reply was not written by a model.` : undefined;
  // Below the router's own confidence floor the template asks what the reader means; quoting clauses for a guess would not help.
  const intent = composed.intent && composed.intent.confidence >= INTENT_CONFIDENCE_FLOOR ? composed.intent.choice : "";
  if (THIN_INTENTS.has(intent)) {
    return { reply: buildExtractiveAnswer({ message, document, analysis, mode: intent === "summarize_context" ? "summary" : "question" }), answer: { source: "document", ...(note ? { note } : {}) } };
  }
  return { ...template, answer: { source: "template", ...(note ? { note } : {}) } };
}
