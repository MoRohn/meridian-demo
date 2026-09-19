import type { Skill } from "../typesafe/types";
import type { TurnContext } from "../orchestrator/state";
import { guardrailsSkill } from "./guardrails";
import { intakeRouterSkill } from "./intakeRouter";
import { contractTypeSkill } from "./contractType";
import { clauseRiskSkill } from "./clauseRisk";
import { complianceGuardSkill } from "./complianceGuard";

/**
 * The plugin registry. Every skill here contributes to the SAME Jev
 * call each turn (speculative fan-out) — the orchestrator doesn't know or
 * care which ones end up "used"; each skill decides its own applicability
 * and the orchestrator decides afterward, in code, which answers matter.
 * Adding a new capability to this app means writing one more file like the
 * others and adding it to this list — no prompt to rewrite, no other skill
 * touched.
 */
export const SKILLS: Skill<TurnContext>[] = [
  guardrailsSkill,
  intakeRouterSkill,
  contractTypeSkill,
  clauseRiskSkill,
  complianceGuardSkill,
];

export {
  guardrailsSkill,
  intakeRouterSkill,
  contractTypeSkill,
  clauseRiskSkill,
  complianceGuardSkill,
};
