import type { QuestionSpec, Skill } from "../typesafe/types";
import type { TurnContext } from "../orchestrator/state";

/**
 * Four independent Noul checks, each a clean yes/no with a clear definition
 * of "yes" — the primitive docs are explicit that Noul only works when the
 * boundary is well-defined (docs.typesafe.ai/primitives/noul). Kept as four
 * separate questions rather than one Choice/checklist so each can be
 * thresholded and displayed on its own; a contract can trip more than one.
 */
export const COMPLIANCE_CHECKS = {
  auto_renewal_trap: {
    label: "Auto-renewal without adequate notice",
    definition:
      "The agreement renews automatically without giving a party a reasonable window (commonly 30-60+ days) to opt out beforehand.",
    instructions:
      "Does `active_document.text` auto-renew the agreement without giving a party a " +
      "reasonable window (commonly 30-60+ days) to opt out beforehand?",
  },
  unlimited_liability: {
    label: "Unlimited or unclear liability",
    definition: "The agreement leaves liability uncapped or does not state a liability limit at all.",
    instructions: "Does `active_document.text` leave liability uncapped or fail to state a liability limit at all?",
  },
  missing_data_protection_clause: {
    label: "Personal data handled, no data-protection clause",
    definition:
      "The agreement involves processing personal or customer data but omits a data protection, confidentiality, or privacy-compliance clause covering it.",
    instructions:
      "Does `active_document.text` involve processing personal or customer data, but omit a data " +
      "protection, confidentiality, or privacy-compliance clause covering it?",
  },
  missing_governing_law: {
    label: "No governing law / jurisdiction clause",
    definition: "The agreement does not state which jurisdiction's law governs it.",
    instructions: "Does `active_document.text` fail to state which jurisdiction's law governs the agreement?",
  },
} as const;

export type ComplianceCheckId = keyof typeof COMPLIANCE_CHECKS;

export const complianceGuardSkill: Skill<TurnContext> = {
  name: "compliance_guard",
  description: "Flags common contract compliance and drafting risks with plain yes/no checks.",
  isApplicable: (ctx) => Boolean(ctx.session.activeDocument),
  buildQuestions(): Record<string, QuestionSpec> {
    const questions: Record<string, QuestionSpec> = {};
    for (const [id, check] of Object.entries(COMPLIANCE_CHECKS)) {
      questions[id] = { type: "noul", instructions: check.instructions };
    }
    return questions;
  },
};
