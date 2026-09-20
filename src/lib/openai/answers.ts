import type { Answer, QuestionSpec } from "../typesafe/types";
import type { OpenAIFieldAnswer } from "./types";

/** Used when OpenAI reported no confidence for a field: neutral, so it neither trips a low-confidence hedge nor claims certainty. */
const NEUTRAL_CONFIDENCE = 0.5;

/**
 * Translates OpenAI's answers to a turn's questions into the typed answers Meridian's reply pipeline consumes
 * (src/lib/orchestrator/compose.ts), so OpenAI can have a reply composed by the very same logic as TypeSafe.
 *
 * What is and is not carried over is deliberate. OpenAI returns a chosen value and a SELF-REPORTED confidence; it has
 * no probability distribution. So a yes/no becomes a hard 1 or 0 (its decision, with no invented probability), a score
 * is the level it chose, and a choice puts all its mass on the option it picked. The confidence is passed through as
 * reported and stays exactly as uncalibrated as it was.
 */
export function openaiAnswersToTyped(raw: Record<string, OpenAIFieldAnswer>, questions: Record<string, QuestionSpec>): Record<string, Answer> {
  const out: Record<string, Answer> = {};
  for (const [id, spec] of Object.entries(questions)) {
    const field = raw[id];
    if (!field) continue;
    const confidence = typeof field.selfReportedConfidence === "number" ? field.selfReportedConfidence : NEUTRAL_CONFIDENCE;
    if (spec.type === "noul") {
      out[id] = { type: "noul", noul: Boolean(field.value) ? 1 : 0 };
    } else if (spec.type === "score") {
      const level = Number(field.value);
      if (!Number.isFinite(level)) continue;
      out[id] = { type: "score", score: level, legend: {}, probabilities: { [String(level)]: 1 }, confidence };
    } else if (spec.type === "choice") {
      const choice = String(field.value);
      out[id] = { type: "choice", choice, probabilities: { [choice]: 1 }, confidence };
    }
  }
  return out;
}
