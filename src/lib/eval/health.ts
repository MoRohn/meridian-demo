/** The eval service's state as the UI needs it, before anyone clicks Evaluate. */
export type EvalHealth =
  | { status: "ready"; judgeModel: string; threshold: number; rubrics: Record<string, string> }
  | { status: "judge_not_configured"; judgeModel: string; threshold: number; rubrics: Record<string, string> }
  | { status: "offline" };

/** Maps the service's /health payload to an EvalHealth, tolerating a malformed or partial payload. */
export function toEvalHealth(payload: unknown): EvalHealth {
  const p = payload as { status?: string; judge_configured?: boolean; judge_model?: string; pass_threshold?: number; rubrics?: Record<string, string> } | null;
  if (!p || p.status !== "ok" || typeof p.judge_model !== "string") return { status: "offline" };
  const base = { judgeModel: p.judge_model, threshold: typeof p.pass_threshold === "number" ? p.pass_threshold : 0.6, rubrics: p.rubrics ?? {} };
  return p.judge_configured ? { status: "ready", ...base } : { status: "judge_not_configured", ...base };
}

export function describeHealth(h: EvalHealth, opts: { savedKey?: boolean } = {}): { tone: "ok" | "warn" | "off"; text: string } {
  if (h.status === "offline") return { tone: "off", text: "The evaluation service isn't running. Start it with npm run eval-service (npm run meridian starts it for you)." };
  const detail = `${h.judgeModel} · pass at ${Math.round(h.threshold * 100)}%`;
  // A key saved in Settings is sent with each evaluation and wins over the service's own, so it decides readiness.
  if (opts.savedKey) return { tone: "ok", text: `Judge ready, using your saved OpenAI key · ${detail}` };
  return h.status === "ready"
    ? { tone: "ok", text: `Judge ready · ${detail}` }
    : { tone: "warn", text: `No judge API key. Save an OpenAI key in Settings, or set OPENAI_API_KEY for the service · ${detail}` };
}
