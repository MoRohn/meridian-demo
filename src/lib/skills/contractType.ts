import type { QuestionSpec, Skill } from "../typesafe/types";
import type { TurnContext } from "../orchestrator/state";

export const CONTRACT_TYPES = {
  nda: "Non-disclosure / confidentiality agreement",
  saas_msa: "SaaS subscription or master services agreement",
  employment: "Employment or contractor agreement",
  lease: "Commercial lease or real property agreement",
  other: "A contract type not covered by the other options",
} as const;

/**
 * Speculative: only worth asking once a document is loaded and we haven't
 * already classified it. Once answered, the result is written into
 * `session.contextFacts.contractType` and persists for the rest of the
 * conversation — the orchestrator won't ask again. This is the "context
 * management across turns" story: a fact established once becomes state,
 * not a repeated question.
 */
export const contractTypeSkill: Skill<TurnContext> = {
  name: "contract_type",
  description: "Classifies the loaded document's contract type, once, then remembers it.",
  isApplicable: (ctx) => Boolean(ctx.session.activeDocument) && !ctx.session.contextFacts.contractType,
  buildQuestions(): Record<string, QuestionSpec> {
    return {
      contract_type: {
        type: "choice",
        instructions: "What kind of contract is `active_document.text`?",
        criteria: CONTRACT_TYPES,
      },
    };
  },
};
