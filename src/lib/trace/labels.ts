import { COMPLIANCE_CHECKS } from "../skills/complianceGuard";
import { RISK_DIMENSIONS } from "../skills/clauseRisk";

/**
 * A reader-facing name for a trace question. The app's own risk dimensions and compliance checks already have proper
 * labels; anything else (guardrail, routing, classification questions) is made readable from its snake_case id. The
 * raw id is still shown, smaller, next to it: a trace exists to show what was actually asked.
 */
export function questionLabel(id: string): string {
  const risk = (RISK_DIMENSIONS as Record<string, { label: string }>)[id];
  if (risk) return risk.label;
  const check = (COMPLIANCE_CHECKS as Record<string, { label: string }>)[id];
  if (check) return check.label;
  const words = id.replace(/_/g, " ").trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : id;
}
