import type { EvalHealth } from "./health";

export interface AutoEvaluateInput {
  /** The user's setting (on by default): auto-evaluation spends judge calls, so it can be switched off. */
  enabled: boolean;
  /** The panel is actually on screen (an open tab, and on a phone the Analysis view), not merely mounted. */
  rendered: boolean;
  health: EvalHealth["status"] | null;
  hasSavedKey: boolean;
  alreadyAutoRan: boolean;
  /** Something has already been evaluated (or is being) for this surface, by click or automatically. */
  hasEntries: boolean;
  runnableCount: number;
  /** A backend's answer is still on its way; evaluating now would leave that backend out. */
  awaitingOtherSide: boolean;
}

/**
 * Whether an evaluation surface should evaluate itself right now. It fires once per action per session, when the panel
 * is first on screen with something to judge, and only when it can actually work: it never guesses while the service's
 * state is unknown, never fires at a service that is down or has no judge key, and never re-runs over a result the
 * reader already has.
 */
export function shouldAutoEvaluate(i: AutoEvaluateInput): boolean {
  if (!i.enabled || !i.rendered || i.alreadyAutoRan || i.hasEntries) return false;
  if (i.runnableCount === 0 || i.awaitingOtherSide) return false;
  if (i.health === null || i.health === "offline") return false;
  if (i.health === "judge_not_configured" && !i.hasSavedKey) return false;
  return true;
}
