import type { EvalKind, EvalOutcome } from "./types";

/**
 * Session-level memory for evaluations, outside React. The tab content remounts whenever a tab is switched, so results
 * kept in component state vanished each time you left a tab (throwing away paid judge output), and "first time" had
 * nothing to remember it by. Here a result outlives the tab, and each action is auto-evaluated at most once per session.
 *
 * `scope` names one evaluation surface ("risk", "risk:excerpt", "reply", ...); `backend` is which model's answer.
 */
export type Backend = "typesafe" | "openai";

/** What one judge call was shown (minus the source text, which can be a whole contract), kept so a report can show the answer behind a score. */
export interface EvaluatedPacket {
  input: string;
  actualOutput: string;
  /** Length of the source text the answer was judged against. */
  contextChars: number;
  /** The source text itself, kept only when it is short (a highlighted excerpt, one cited section); a whole contract is not copied. */
  context?: string;
}

export interface StoredEvaluation {
  /** Fingerprint of the exact answer that was judged, so a changed answer is never shown a stale score. */
  sig: string;
  outcome: EvalOutcome | null;
  pending: boolean;
  /** True when the run started by itself (first open) rather than from a click. */
  auto: boolean;
  /** Which capability was judged, so results can be grouped across surfaces (the risk tab and its excerpt share one kind). */
  kind?: EvalKind;
  /** The request and answer the judge scored. */
  packet?: EvaluatedPacket;
}

export interface StoredEvaluationRow extends StoredEvaluation {
  scope: string;
  backend: Backend;
}

const entries = new Map<string, StoredEvaluation>();
const autoRan = new Set<string>();
const listeners = new Set<() => void>();
let version = 0;

const key = (scope: string, backend: Backend) => `${scope}|${backend}`;
const emit = () => {
  version += 1;
  listeners.forEach((l) => l());
};

export const evalStore = {
  get: (scope: string, backend: Backend): StoredEvaluation | undefined => entries.get(key(scope, backend)),
  set(scope: string, backend: Backend, entry: StoredEvaluation) {
    entries.set(key(scope, backend), entry);
    emit();
  },
  /** Every stored evaluation, for session-wide summaries. */
  rows(): StoredEvaluationRow[] {
    return [...entries].map(([k, entry]) => {
      const at = k.lastIndexOf("|");
      return { ...entry, scope: k.slice(0, at), backend: k.slice(at + 1) as Backend };
    });
  },
  /** Forgets a surface completely, its results and the fact that it was auto-evaluated, so it is judged afresh the next time it is shown. */
  forget(scope: string) {
    (["typesafe", "openai"] as const).forEach((b) => entries.delete(key(scope, b)));
    autoRan.delete(scope);
    emit();
  },
  clearScope(scope: string) {
    (["typesafe", "openai"] as const).forEach((b) => entries.delete(key(scope, b)));
    emit();
  },
  hasAny: (scope: string) => (["typesafe", "openai"] as const).some((b) => entries.has(key(scope, b))),
  autoRanFor: (scope: string) => autoRan.has(scope),
  /** Marks the scope as auto-evaluated. Done synchronously BEFORE the run starts, so a double render cannot start it twice. */
  markAutoRan(scope: string) {
    autoRan.add(scope);
  },
  /** A new session starts from a clean slate: nothing remembered, and every action gets its first-time evaluation again. */
  reset() {
    entries.clear();
    autoRan.clear();
    emit();
  },
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => void listeners.delete(listener);
  },
  version: () => version,
};
