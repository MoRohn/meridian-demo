import type { EvalKind } from "./types";

/**
 * Display copy for each judged capability — one title and one standardized
 * subtitle, so every tab explains its evaluation in the same voice. The judge's
 * actual method lives server-side in eval-service/rubrics.py.
 */
export const EVAL_KINDS: Record<EvalKind, { title: string; subtitle: string }> = {
  risk: {
    title: "Risk score evaluation",
    subtitle:
      "Checks each liability, indemnification and termination rating against the clauses in the source text, then the weighted total.",
  },
  compliance: {
    title: "Compliance flag evaluation",
    subtitle:
      "Re-derives each flag independently from the source text and compares it with the flagged or clear decision.",
  },
  citation: {
    title: "Citation verdict evaluation",
    subtitle:
      "Checks whether the source section supports, contradicts, or is silent on the claim, and whether the verdict matches.",
  },
  reply: {
    title: "Assistant reply evaluation",
    subtitle: "Checks that every figure and finding in the reply matches the application's own analysis and the document.",
  },
};

export const EVAL_KIND_IDS = Object.keys(EVAL_KINDS) as EvalKind[];
