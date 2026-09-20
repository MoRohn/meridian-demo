/**
 * The verdict rule, one for every judge, provider and backend (the service applies the same one; see
 * eval-service/judge.py `settle_score`).
 *
 * The judge chooses a whole number from 0 to 10 and every screen shows a whole percent. DeepEval turns that choice into a
 * float that is close to, but not always exactly, that number (5.999999999999999 for a chosen 6, about 1 time in 12), and
 * comparing that raw float to the pass mark made a passing 60% show as Fail. So the score is settled to the precision it is
 * shown at, and pass or fail is decided on that settled number: the one the reader sees.
 */
const STEPS = 100;
/** How far outside 0..1 a raw score may be before it is a judge error rather than rounding noise: half of one displayed step. */
const NOISE = 0.5 / STEPS;

/** Half-up rounding to a whole percent, like the UI's Math.round. */
const toSteps = (x: number) => Math.min(STEPS, Math.max(0, Math.floor(x * STEPS + 0.5)));

/** The displayed score (0..1) and whether it passes, or null when `raw` is not a usable score at all. */
export function settleVerdict(raw: unknown, threshold: number): { score: number; success: boolean } | null {
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw < -NOISE || raw > 1 + NOISE) return null;
  const steps = toSteps(raw);
  return { score: steps / STEPS, success: steps >= toSteps(threshold) };
}
