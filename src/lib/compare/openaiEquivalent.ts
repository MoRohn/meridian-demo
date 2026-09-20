import type { QuestionSpec } from "../typesafe/types";
import { OPENAI_REFERENCE_PRICING, usdForTokens } from "./pricing";

/**
 * Mechanically translates the SAME question map the orchestrator sent to
 * Jev into an OpenAI-style function-calling tool definition, so the
 * comparison is apples-to-apples rather than a strawman: same judgments,
 * same criteria, different substrate.
 *
 * The structural differences this makes visible:
 *  - Choice -> a `string` field with an `enum`. The model still has to
 *    generate that string as output tokens; TypeSafe returns the full
 *    probability distribution over the same options for effectively free
 *    (output tokens are $0 on Jev).
 *  - Score -> there's no native ordinal/rubric type in JSON Schema, so it
 *    becomes an integer with a description of the levels spelled out in
 *    prose — the calibration TypeSafe trains for has to be approximated
 *    with prompt engineering here, and there's no `probabilities` field:
 *    getting a distribution at all means requesting logprobs and
 *    reconstructing it yourself token by token.
 *  - Noul -> a boolean plus a hand-rolled `confidence` float, because
 *    chat-completions has no native calibrated uncertainty signal. Nothing
 *    stops the model from returning `"confidence": 0.97` regardless of
 *    whether that number means anything.
 */
function toJsonSchemaProperty(q: QuestionSpec): Record<string, unknown> {
  if (q.type === "choice") {
    return {
      type: "string",
      enum: Object.keys(q.criteria),
      description: typeof q.instructions === "string" ? q.instructions : JSON.stringify(q.instructions),
    };
  }
  if (q.type === "score") {
    return {
      type: "integer",
      minimum: 0,
      maximum: q.criteria.length - 1,
      description:
        (typeof q.instructions === "string" ? q.instructions : JSON.stringify(q.instructions)) +
        " Levels: " +
        q.criteria.map((c, i) => `${i}=${typeof c === "string" ? c : JSON.stringify(c)}`).join("; "),
    };
  }
  return {
    type: "boolean",
    description: typeof q.instructions === "string" ? q.instructions : JSON.stringify(q.instructions),
  };
}

export function buildFunctionCallingSchema(questions: Record<string, QuestionSpec>) {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const [id, q] of Object.entries(questions)) {
    properties[id] = toJsonSchemaProperty(q);
    required.push(id);
    // A hand-rolled, self-reported confidence per field — there is no
    // native equivalent to TypeSafe's trained-and-calibrated `confidence`.
    properties[`${id}_confidence`] = {
      type: "number",
      minimum: 0,
      maximum: 1,
      description: `Self-reported confidence (0-1) in the "${id}" answer above. Not independently calibrated.`,
    };
    required.push(`${id}_confidence`);
  }
  return {
    name: "record_context_judgments",
    description: "Record every judgment about the current context intake turn.",
    parameters: { type: "object", properties, required, additionalProperties: false },
  };
}

/**
 * Maps an actual OpenAI model name (e.g. from a live response) to the
 * closest published reference price, for computing real cost off measured
 * token usage — see `usdForTokens` call sites in page.tsx.
 */
export function matchReferencePrice(modelName: string) {
  const hit = OPENAI_REFERENCE_PRICING.find((p) => modelName.startsWith(p.model.split(" ")[0]));
  return hit ?? OPENAI_REFERENCE_PRICING[0];
}

/** What one OpenAI call cost, from its measured token usage at the closest published price. */
export function openaiCostUsd(modelName: string, usage: { input_tokens: number; output_tokens: number }): number {
  const price = matchReferencePrice(modelName);
  return usdForTokens(usage.input_tokens, price.inputPerMillionUsd) + usdForTokens(usage.output_tokens, price.outputPerMillionUsd);
}
