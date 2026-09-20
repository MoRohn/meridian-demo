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
}

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
