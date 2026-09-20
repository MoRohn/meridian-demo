/**
 * User-supplied API keys, entered through the Settings modal (⚙ in the
 * header). Stored in localStorage only — never sent anywhere except as the
 * body of the app's own API requests, and never written into the in-memory
 * session store server-side. A key entered here always takes priority over
 * the corresponding environment variable for that request; see
 * src/lib/typesafe/client.ts and src/lib/openai/client.ts.
 */
export interface ApiKeySettings {
  typesafeApiKey: string;
  typesafeModel: string;
  openaiApiKey: string;
  openaiModel: string;
  /**
   * Evaluate the first result of each action automatically (DeepEval G-Eval). On by default. It is not a key, but it
   * lives here because the Settings dialog is where a reader controls what spends their judge calls.
   */
  autoEvaluate: boolean;
  /** Who judges the answers. "saved" (the default) is the OpenAI key above, on the evaluation service's own judge model. */
  judgeProvider: JudgeChoice;
  /** The judge model for a provider chosen below; blank uses that provider's default. */
  judgeModel: string;
  /** The judge's own key. For a different OpenAI judge it may stay blank to reuse the OpenAI key above. */
  judgeApiKey: string;
}

/** Which company's model judges. */
export type JudgeProvider = "openai" | "anthropic" | "gemini";
/** What the reader picked: the saved OpenAI key as is, or a provider of their choice. */
export type JudgeChoice = "saved" | JudgeProvider;

export interface JudgeOption {
  id: JudgeChoice;
  label: string;
  hint: string;
  /** A judge from a company other than OpenAI, which is the recommended kind: OpenAI writes the chat answers and is one of the two backends being judged. */
  independent: boolean;
}

export const JUDGE_OPTIONS: JudgeOption[] = [
  { id: "saved", label: "Use my OpenAI key", hint: "The default. The OpenAI key above judges, on the service's own judge model.", independent: false },
  { id: "anthropic", label: "Claude (Anthropic)", hint: "A judge from a different company than the models being compared.", independent: true },
  { id: "gemini", label: "Gemini (Google)", hint: "A judge from a different company than the models being compared.", independent: true },
  { id: "openai", label: "OpenAI, another model or key", hint: "Pick a specific OpenAI judge model, and optionally a separate key.", independent: false },
];

export const JUDGE_RECOMMENDATION =
  "Recommended: judge with Claude or Gemini. A judge tends to favor answers from its own company, and OpenAI both writes the chat answers and is one of the two backends being compared. A model from a third company scores them most fairly.";

export const JUDGE_LABELS: Record<JudgeProvider, string> = { openai: "OpenAI", anthropic: "Claude", gemini: "Gemini" };

export const JUDGE_MODELS: Record<JudgeProvider, ModelOption[]> = {
  anthropic: [
    { id: "claude-sonnet-5", label: "Claude Sonnet 5 (recommended)" },
    { id: "claude-opus-5", label: "Claude Opus 5 (most capable)" },
    { id: "claude-fable-5-1", label: "Claude Fable 5.1" },
    { id: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5 (fastest, cheapest)" },
  ],
  gemini: [
    { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash (recommended)" },
    { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro (most capable)" },
    { id: "gemini-2.5-flash-lite", label: "Gemini 2.5 Flash-Lite (cheapest)" },
  ],
  openai: [
    { id: "gpt-4o-mini", label: "GPT-4o mini (the service default)" },
    { id: "gpt-4o", label: "GPT-4o" },
    { id: "gpt-5.1", label: "GPT-5.1" },
  ],
};

export const DEFAULT_JUDGE_MODEL: Record<JudgeProvider, string> = { openai: "gpt-4o-mini", anthropic: "claude-sonnet-5", gemini: "gemini-2.5-flash" };

export interface ModelOption {
  id: string;
  label: string;
}

/** TypeSafe currently ships a single Jev model — see @typesafe-ai/sdk's defaultModel docs. */
export const TYPESAFE_MODELS: ModelOption[] = [{ id: "jev-latest", label: "Jev (latest)" }];

/** Current OpenAI chat-completion / function-calling lineup, per platform.openai.com/docs/models. */
export const OPENAI_MODELS: ModelOption[] = [
  { id: "gpt-6-astra", label: "GPT-6 Astra (latest, most capable)" },
  { id: "gpt-5.6-sol", label: "GPT-5.6 Sol (flagship)" },
  { id: "gpt-5.6-terra", label: "GPT-5.6 Terra" },
  { id: "gpt-5.6-luna", label: "GPT-5.6 Luna (cost-optimized)" },
  { id: "gpt-5.1", label: "GPT-5.1" },
  { id: "gpt-4o", label: "GPT-4o" },
  { id: "gpt-4o-mini", label: "GPT-4o mini" },
];

export const DEFAULT_TYPESAFE_MODEL = TYPESAFE_MODELS[0].id;
export const DEFAULT_OPENAI_MODEL = OPENAI_MODELS[0].id;

const STORAGE_KEY = "meridian.apiKeys";

export const emptySettings: ApiKeySettings = {
  typesafeApiKey: "",
  typesafeModel: DEFAULT_TYPESAFE_MODEL,
  openaiApiKey: "",
  openaiModel: DEFAULT_OPENAI_MODEL,
  autoEvaluate: true,
  judgeProvider: "saved",
  judgeModel: "",
  judgeApiKey: "",
};

export function loadSettings(): ApiKeySettings {
  if (typeof window === "undefined") return emptySettings;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptySettings;
    const parsed = JSON.parse(raw) as Partial<ApiKeySettings>;
    return { ...emptySettings, ...parsed };
  } catch {
    return emptySettings;
  }
}

export function saveSettings(settings: ApiKeySettings): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // localStorage unavailable (private browsing, quota) — keys just won't persist across reloads.
  }
}

/** The subset of settings relevant to a single backend, shaped to match the server's KeyOverride. */
export function typesafeOverride(settings: ApiKeySettings): { apiKey?: string; model?: string } | undefined {
  if (!settings.typesafeApiKey.trim()) return undefined;
  return { apiKey: settings.typesafeApiKey.trim(), model: settings.typesafeModel.trim() || undefined };
}

export function openaiOverride(settings: ApiKeySettings): { apiKey?: string; model?: string } | undefined {
  if (!settings.openaiApiKey.trim()) return undefined;
  return { apiKey: settings.openaiApiKey.trim(), model: settings.openaiModel.trim() || undefined };
}

/** Whether first results are evaluated automatically. Settings saved before this option existed count as on. */
export function autoEvaluateEnabled(settings: ApiKeySettings = loadSettings()): boolean {
  return settings.autoEvaluate !== false;
}

/** What the evaluation request carries about who judges. Every field is optional: the service fills in what is missing. */
export interface JudgeOverride {
  provider: JudgeProvider;
  apiKey?: string;
  model?: string;
}

const clean = (s: string | undefined) => (s ?? "").trim();

/**
 * The judge to ask for, from the saved settings. The default sends just the saved OpenAI key. A chosen provider sends its
 * own key and model; an OpenAI judge with no key of its own reuses the OpenAI key above. Nothing here is a second place to
 * type a key: each key is entered once, in the Settings modal.
 */
export function judgeOverride(settings: ApiKeySettings): JudgeOverride | undefined {
  const openaiKey = clean(settings.openaiApiKey);
  const choice = settings.judgeProvider ?? "saved";
  if (choice === "saved") return openaiKey ? { provider: "openai", apiKey: openaiKey } : undefined;
  const own = clean(settings.judgeApiKey);
  const model = clean(settings.judgeModel) || DEFAULT_JUDGE_MODEL[choice];
  const apiKey = own || (choice === "openai" ? openaiKey : "");
  return { provider: choice, model, ...(apiKey ? { apiKey } : {}) };
}

/** The judge in words, for the evaluation panel's status line. */
export function describeJudge(settings: ApiKeySettings): { provider: JudgeProvider; label: string; model: string | null } {
  const choice = settings.judgeProvider ?? "saved";
  if (choice === "saved") return { provider: "openai", label: JUDGE_LABELS.openai, model: null };
  return { provider: choice, label: JUDGE_LABELS[choice], model: clean(settings.judgeModel) || DEFAULT_JUDGE_MODEL[choice] };
}
