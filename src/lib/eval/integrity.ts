import type { EvalResult } from "./types";

const SIGNAL_LABELS: Record<string, string> = {
  override_instructions: "an instruction to ignore or override the rules",
  addresses_evaluator: "a note addressed to the evaluator",
  role_reassignment: "an attempt to reassign the judge's role",
  dictates_score: "an attempt to dictate the score",
  injects_json_verdict: "text formatted like a judge verdict",
  chat_template_tokens: "chat-template control tokens",
  system_prompt_reference: "a reference to system or developer prompts",
  hidden_tag_characters: "invisible Unicode tag characters",
};
const FIELD_LABELS: Record<string, string> = { "SOURCE TEXT": "the source text", REQUEST: "the request", ANSWER: "the answer" };

export function describeIntegrity(result: EvalResult): string | null {
  if (result.integrity.status !== "suspicious") return null;
  const found = result.integrity.signals.map((s) => `${SIGNAL_LABELS[s.signal] ?? s.signal} in ${FIELD_LABELS[s.field] ?? s.field}`);
  return `Detected ${found.join("; ")}. The judge is instructed to treat that text as data and ignore it, but review this score manually.`;
}
