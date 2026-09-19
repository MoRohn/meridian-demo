/**
 * FastAPI reports validation failures (422) as an array of `{loc, msg}`
 * objects, not a string — passing that through untouched renders as
 * "[object Object]" in the UI.
 */
/**
 * The eval service reports a judge failure as "G-Eval judge call failed (<code>): <sentence>". The code is stable and
 * machine-readable; the sentence is written for the reader. Split them so the UI can title the failure by its code
 * and show only the sentence, instead of repeating the prefix.
 */
export function parseJudgeFailure(message: string): { code: string | null; message: string } {
  const m = message.match(/^G-Eval judge call failed \(([a-z_]+)\):\s*([\s\S]*)$/);
  return m ? { code: m[1], message: m[2] } : { code: null, message };
}

export const JUDGE_FAILURE_TITLES: Record<string, string> = {
  judge_rate_limited: "Judge is rate limited",
  judge_auth: "Judge key rejected",
  judge_model_unavailable: "Judge model unavailable",
  judge_unreachable: "Judge unreachable",
  judge_provider_error: "Judge provider error",
  judge_bad_output: "Judge answer unreadable",
  judge_bad_score: "Judge score invalid",
  service_offline: "Evaluation service not running",
};

export function describeServiceError(detail: unknown, fallback: string): string {
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    const parts = detail
      .map((d) => (d && typeof d === "object" && "msg" in d ? `${(d as { loc?: unknown[] }).loc?.slice(1).join(".") ?? "request"}: ${(d as { msg: string }).msg}` : null))
      .filter(Boolean);
    if (parts.length > 0) return `Eval service rejected the request (${parts.join("; ")})`;
  }
  return fallback;
}
