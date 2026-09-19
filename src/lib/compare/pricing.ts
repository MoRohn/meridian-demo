/**
 * Reference pricing for computing real cost off *measured* token usage from
 * live calls to each backend (see `matchReferencePrice` in
 * `compare/openaiEquivalent.ts` and the session-totals math in page.tsx).
 * Both TypeSafe and OpenAI are called live wherever a key is configured —
 * this table only supplies the $/token rate, not the token counts
 * themselves. Prices drift; verify current numbers before citing them
 * anywhere that matters.
 */

/** From https://docs.typesafe.ai/models — jev-1.13 ("jev-latest"). Output tokens are free. */
export const TYPESAFE_PRICING = {
  model: "jev-1.13 (jev-latest)",
  inputPerMillionUsd: 0.042,
  outputPerMillionUsd: 0,
};

/**
 * Publicly listed OpenAI chat-completion prices, per platform.openai.com/docs/pricing.
 * Prices drift; verify current numbers before citing them anywhere that matters.
 */
export const OPENAI_REFERENCE_PRICING = [
  { model: "gpt-6-astra (reference)", inputPerMillionUsd: 10, outputPerMillionUsd: 50 },
  { model: "gpt-5.6-sol (reference)", inputPerMillionUsd: 4, outputPerMillionUsd: 20 },
  { model: "gpt-5.6-terra (reference)", inputPerMillionUsd: 2, outputPerMillionUsd: 12 },
  { model: "gpt-5.6-luna (reference)", inputPerMillionUsd: 0.2, outputPerMillionUsd: 1.2 },
  { model: "gpt-5.1 (reference)", inputPerMillionUsd: 1.25, outputPerMillionUsd: 10 },
  { model: "gpt-4o-mini (reference)", inputPerMillionUsd: 0.15, outputPerMillionUsd: 0.6 },
  { model: "gpt-4o (reference)", inputPerMillionUsd: 2.5, outputPerMillionUsd: 10 },
];

export function usdForTokens(tokens: number, pricePerMillion: number): number {
  return (tokens * pricePerMillion) / 1_000_000;
}

/** Running session cost/token totals shown at the foot of the Reasoning Trace tab. */
export interface SessionTotals {
  turns: number;
  typesafe: { calls: number; inputTokens: number; costUsd: number };
  openai: { calls: number; inputTokens: number; outputTokens: number; costUsd: number };
}

/**
 * Money for a reader, one rule everywhere. API calls cost fractions of a cent, and the whole point of showing them is
 * comparing backends, so small amounts are written out in full instead of being rounded away or put in scientific
 * notation:
 *   under $1      six decimals, always ($0.000065, $0.011624), so figures line up and none hides its magnitude
 *   $1 and over   cents with thousands separators ($1.50, $1,234.50)
 *   exactly zero  $0.00 (nothing was spent), never a run of zeros
 * Anything below the sixth decimal reads as "<$0.000001" rather than a misleading $0.000000.
 */
export function fmtUsd(n: number): string {
  if (!(n > 0)) return "$0.00";
  if (n < 0.000001) return "<$0.000001";
  const cents = n >= 1 || Math.round(n * 1e6) >= 1e6;
  return cents
    ? `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : `$${n.toFixed(6)}`;
}
