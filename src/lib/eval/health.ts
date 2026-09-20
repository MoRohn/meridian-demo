/** The eval service's state as the UI needs it, before anyone clicks Evaluate. */
export type JudgeProviderId = "openai" | "anthropic" | "gemini";
/** Who the service can use as a judge: each one's default model, and whether the service itself holds a key for it. */
export type ProviderInfo = Partial<Record<JudgeProviderId, { defaultModel: string; envKey: boolean }>>;

export type EvalHealth =
  | { status: "ready"; judgeModel: string; threshold: number; rubrics: Record<string, string>; providers?: ProviderInfo }
  | { status: "judge_not_configured"; judgeModel: string; threshold: number; rubrics: Record<string, string>; providers?: ProviderInfo }
  | { status: "offline" };

/** Maps the service's /health payload to an EvalHealth, tolerating a malformed or partial payload. */
export function toEvalHealth(payload: unknown): EvalHealth {
  const p = payload as {
    status?: string;
    judge_configured?: boolean;
    judge_model?: string;
    pass_threshold?: number;
    rubrics?: Record<string, string>;
    providers?: Record<string, { default_model?: string; env_key?: boolean }>;
  } | null;
  if (!p || p.status !== "ok" || typeof p.judge_model !== "string") return { status: "offline" };
  const providers: ProviderInfo = {};
  for (const id of ["openai", "anthropic", "gemini"] as const) {
    const info = p.providers?.[id];
    if (info && typeof info.default_model === "string") providers[id] = { defaultModel: info.default_model, envKey: info.env_key === true };
  }
  const base = {
    judgeModel: p.judge_model,
    threshold: typeof p.pass_threshold === "number" ? p.pass_threshold : 0.6,
    rubrics: p.rubrics ?? {},
    ...(Object.keys(providers).length ? { providers } : {}),
  };
  return p.judge_configured ? { status: "ready", ...base } : { status: "judge_not_configured", ...base };
}

/** The judge the reader chose, as the status line needs to name it. */
export interface JudgeChoiceInfo {
  provider: JudgeProviderId;
  /** "OpenAI", "Claude" or "Gemini". */
  label: string;
  /** The model asked for, or null when the service picks (the default OpenAI judge). */
  model: string | null;
}

/**
 * Whether a key for the chosen judge is available: one saved in Settings, or, failing that, one the service holds itself.
 * The service's `judge_configured` flag is about OpenAI only, so a Claude or Gemini judge is read from its provider list.
 */
export function judgeKeyAvailable(h: EvalHealth, provider: JudgeProviderId, savedKey: boolean): boolean {
  if (savedKey) return true;
  if (h.status === "offline") return false;
  if (provider === "openai") return h.status === "ready";
  return h.providers?.[provider]?.envKey === true;
}

export function describeHealth(
  h: EvalHealth,
  opts: { savedKey?: boolean; judge?: JudgeChoiceInfo } = {},
): { tone: "ok" | "warn" | "off"; text: string } {
  if (h.status === "offline") return { tone: "off", text: "The evaluation service isn't running. Start it with npm run eval-service (npm run meridian starts it for you)." };
  const threshold = `pass at ${Math.round(h.threshold * 100)}%`;
  const judge = opts.judge ?? { provider: "openai" as const, label: "OpenAI", model: null };
  const model = judge.model ?? h.providers?.[judge.provider]?.defaultModel ?? h.judgeModel;
  const detail = `${model} · ${threshold}`;
  // A key saved in Settings is sent with each evaluation and wins over the service's own, so it decides readiness.
  if (opts.savedKey) return { tone: "ok", text: `Judge ready, using your saved ${judge.label} key · ${detail}` };
  if (judge.provider !== "openai") {
    return judgeKeyAvailable(h, judge.provider, false)
      ? { tone: "ok", text: `Judge ready · ${detail}` }
      : { tone: "warn", text: `No ${judge.label} judge key. Add one under Judge model in Settings · ${detail}` };
  }
  return h.status === "ready"
    ? { tone: "ok", text: `Judge ready · ${detail}` }
    : { tone: "warn", text: `No judge API key. Save an OpenAI key in Settings, or set OPENAI_API_KEY for the service · ${detail}` };
}
