import { afterEach, describe, expect, it, vi } from "vitest";
import {
  autoEvaluateEnabled,
  DEFAULT_JUDGE_MODEL,
  DEFAULT_OPENAI_MODEL,
  DEFAULT_TYPESAFE_MODEL,
  describeJudge,
  emptySettings,
  JUDGE_MODELS,
  JUDGE_OPTIONS,
  judgeOverride,
  loadSettings,
  saveSettings,
  openaiOverride,
  typesafeOverride,
  type ApiKeySettings,
} from "./settings";

describe("typesafeOverride / openaiOverride", () => {
  const base: ApiKeySettings = {
    typesafeApiKey: "",
    typesafeModel: DEFAULT_TYPESAFE_MODEL,
    openaiApiKey: "",
    openaiModel: DEFAULT_OPENAI_MODEL,
    autoEvaluate: true,
    judgeProvider: "saved",
    judgeModel: "",
    judgeApiKey: "",
  };

  it("returns undefined when no key is set and the model is still the dropdown default", () => {
    expect(typesafeOverride(base)).toBeUndefined();
    expect(openaiOverride(base)).toBeUndefined();
  });

  it("sends a picked model on its own when no key is saved, so the server's key is used with that model", () => {
    expect(openaiOverride({ ...base, openaiModel: "gpt-5.1" })).toEqual({ model: "gpt-5.1" });
    expect(openaiOverride({ ...base, openaiApiKey: "   ", openaiModel: "gpt-5.1" })).toEqual({ model: "gpt-5.1" });
  });

  it("sends nothing for a blank model with no key", () => {
    expect(openaiOverride({ ...base, openaiModel: "  " })).toBeUndefined();
  });

  it("returns undefined for a whitespace-only key (never sends a blank Authorization header)", () => {
    expect(typesafeOverride({ ...base, typesafeApiKey: "   " })).toBeUndefined();
  });

  it("trims the key and pairs it with the selected model once a key is present", () => {
    const override = typesafeOverride({ ...base, typesafeApiKey: "  sk-abc123  " });
    expect(override).toEqual({ apiKey: "sk-abc123", model: DEFAULT_TYPESAFE_MODEL });
  });

  it("omits the model field when the model string is blank", () => {
    const override = openaiOverride({ ...base, openaiApiKey: "sk-openai", openaiModel: "" });
    expect(override).toEqual({ apiKey: "sk-openai", model: undefined });
  });
});

describe("loadSettings (server/SSR context)", () => {
  it("falls back to defaults when `window` is unavailable, never throws", () => {
    // vitest's default "node" environment has no `window` — this exercises
    // the exact SSR guard `loadSettings` needs when this module is ever
    // imported on the server.
    const settings = loadSettings();
    expect(settings.typesafeModel).toBe(DEFAULT_TYPESAFE_MODEL);
    expect(settings.openaiModel).toBe(DEFAULT_OPENAI_MODEL);
    expect(settings.typesafeApiKey).toBe("");
    expect(settings.openaiApiKey).toBe("");
  });
});

describe("autoEvaluateEnabled", () => {
  const base: ApiKeySettings = { typesafeApiKey: "", typesafeModel: DEFAULT_TYPESAFE_MODEL, openaiApiKey: "", openaiModel: DEFAULT_OPENAI_MODEL, autoEvaluate: true, judgeProvider: "saved", judgeModel: "", judgeApiKey: "" };

  it("is on by default", () => {
    expect(autoEvaluateEnabled(base)).toBe(true);
  });
  it("can be turned off", () => {
    expect(autoEvaluateEnabled({ ...base, autoEvaluate: false })).toBe(false);
  });
  it("counts settings saved before the option existed as on, so upgrading never silently disables it", () => {
    const legacy = { typesafeApiKey: "", typesafeModel: "m", openaiApiKey: "", openaiModel: "m" } as unknown as ApiKeySettings;
    expect(autoEvaluateEnabled(legacy)).toBe(true);
  });
  it("is on when there is no browser at all (server render)", () => {
    expect(autoEvaluateEnabled()).toBe(true);
  });
});

describe("judgeOverride", () => {
  const base: ApiKeySettings = { ...emptySettings, openaiApiKey: "sk-openai-saved-000000000000" };

  it("defaults to the saved OpenAI key alone, so a reader who has entered one key is ready with no further setup", () => {
    expect(emptySettings.judgeProvider).toBe("saved");
    expect(judgeOverride(base)).toEqual({ provider: "openai", apiKey: "sk-openai-saved-000000000000" });
  });

  it("has nothing to send when the default is chosen and no OpenAI key is saved", () => {
    expect(judgeOverride({ ...emptySettings })).toBeUndefined();
    expect(judgeOverride({ ...emptySettings, openaiApiKey: "   " })).toBeUndefined();
  });

  it("uses the Claude or Gemini key and model that were chosen, never the OpenAI key", () => {
    const claude = judgeOverride({ ...base, judgeProvider: "anthropic", judgeModel: "claude-opus-5", judgeApiKey: "  sk-ant-000000000000000  " });
    expect(claude).toEqual({ provider: "anthropic", model: "claude-opus-5", apiKey: "sk-ant-000000000000000" });
    const gemini = judgeOverride({ ...base, judgeProvider: "gemini", judgeApiKey: "AIza0000000000000000" });
    expect(gemini).toEqual({ provider: "gemini", model: DEFAULT_JUDGE_MODEL.gemini, apiKey: "AIza0000000000000000" });
    expect(JSON.stringify([claude, gemini])).not.toContain("sk-openai-saved");
  });

  it("asks for the provider's default model when none was picked", () => {
    expect(judgeOverride({ ...base, judgeProvider: "anthropic", judgeApiKey: "sk-ant-000000000000000" })?.model).toBe(DEFAULT_JUDGE_MODEL.anthropic);
  });

  it("sends a Claude or Gemini judge with no key anyway, so the service can use its own or say plainly that none exists", () => {
    expect(judgeOverride({ ...base, judgeProvider: "anthropic" })).toEqual({ provider: "anthropic", model: DEFAULT_JUDGE_MODEL.anthropic });
  });

  it("lets a different OpenAI judge reuse the OpenAI key above, or take its own", () => {
    expect(judgeOverride({ ...base, judgeProvider: "openai", judgeModel: "gpt-4o" })).toEqual({ provider: "openai", model: "gpt-4o", apiKey: "sk-openai-saved-000000000000" });
    expect(judgeOverride({ ...base, judgeProvider: "openai", judgeModel: "gpt-4o", judgeApiKey: "sk-other-0000000000000000" })?.apiKey).toBe("sk-other-0000000000000000");
  });

  it("copes with settings saved before the judge options existed", () => {
    const old = { typesafeApiKey: "", typesafeModel: "m", openaiApiKey: "sk-openai-saved-000000000000", openaiModel: "m", autoEvaluate: true } as ApiKeySettings;
    expect(judgeOverride(old)).toEqual({ provider: "openai", apiKey: "sk-openai-saved-000000000000" });
    expect(describeJudge(old)).toEqual({ provider: "openai", label: "OpenAI", model: null });
  });
});

describe("describeJudge and the judge options", () => {
  it("names the judge for the status line", () => {
    expect(describeJudge(emptySettings)).toEqual({ provider: "openai", label: "OpenAI", model: null });
    expect(describeJudge({ ...emptySettings, judgeProvider: "anthropic", judgeModel: "claude-opus-5" })).toEqual({ provider: "anthropic", label: "Claude", model: "claude-opus-5" });
    expect(describeJudge({ ...emptySettings, judgeProvider: "gemini" })).toEqual({ provider: "gemini", label: "Gemini", model: DEFAULT_JUDGE_MODEL.gemini });
  });

  it("lists the saved OpenAI key first as the default, and marks the other companies' models as the recommended ones", () => {
    expect(JUDGE_OPTIONS[0].id).toBe("saved");
    expect(JUDGE_OPTIONS.filter((o) => o.independent).map((o) => o.id)).toEqual(["anthropic", "gemini"]);
  });

  it("offers each provider's default model in its own list", () => {
    for (const provider of ["openai", "anthropic", "gemini"] as const) {
      expect(JUDGE_MODELS[provider].map((m) => m.id)).toContain(DEFAULT_JUDGE_MODEL[provider]);
    }
  });
});

/** A browser's two storage areas, as plain maps, so where a value was written can be checked. */
function fakeBrowser(opts: { local?: Record<string, string>; session?: Record<string, string>; noSession?: boolean } = {}) {
  const make = (init: Record<string, string> = {}) => {
    const data = new Map(Object.entries(init));
    return { data, getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), removeItem: (k: string) => void data.delete(k) };
  };
  const local = make(opts.local);
  const session = make(opts.session);
  vi.stubGlobal("window", { localStorage: local, ...(opts.noSession ? {} : { sessionStorage: session }) });
  return { local, session };
}
const SECRET = "sk-secret-000000000000000000";
const withKeys = (over: Partial<ApiKeySettings> = {}): ApiKeySettings => ({ ...emptySettings, openaiApiKey: SECRET, typesafeApiKey: "ts-secret-000000000000000", judgeApiKey: "jd-secret-000000000000000", openaiModel: "gpt-4o", ...over });

describe("where saved keys live", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("keeps keys for this tab only by default: nothing secret reaches localStorage", () => {
    const { local, session } = fakeBrowser();
    saveSettings(withKeys());
    expect(local.data.get("meridian.apiKeys")).not.toContain("secret");
    expect(JSON.parse(session.data.get("meridian.apiKeys.session")!)).toEqual({ typesafeApiKey: "ts-secret-000000000000000", openaiApiKey: SECRET, judgeApiKey: "jd-secret-000000000000000" });
  });

  it("still remembers everything that is not a secret", () => {
    const { local } = fakeBrowser();
    saveSettings(withKeys({ autoEvaluate: false, judgeProvider: "anthropic", judgeModel: "claude-opus-5" }));
    expect(JSON.parse(local.data.get("meridian.apiKeys")!)).toMatchObject({ openaiModel: "gpt-4o", autoEvaluate: false, judgeProvider: "anthropic", judgeModel: "claude-opus-5", rememberKeys: false });
  });

  it("loads the keys back in the same tab, and the preferences in a new one, without the keys", () => {
    const first = fakeBrowser();
    saveSettings(withKeys());
    expect(loadSettings()).toMatchObject({ openaiApiKey: SECRET, typesafeApiKey: "ts-secret-000000000000000", rememberKeys: false });
    // A new tab shares localStorage but not sessionStorage.
    fakeBrowser({ local: Object.fromEntries(first.local.data) });
    expect(loadSettings()).toMatchObject({ openaiApiKey: "", typesafeApiKey: "", judgeApiKey: "", openaiModel: "gpt-4o" });
  });

  it("keeps keys on the device only when asked, and then leaves nothing in the tab's storage", () => {
    const { local, session } = fakeBrowser({ session: { "meridian.apiKeys.session": JSON.stringify({ openaiApiKey: "old" }) } });
    saveSettings(withKeys({ rememberKeys: true }));
    expect(JSON.parse(local.data.get("meridian.apiKeys")!)).toMatchObject({ openaiApiKey: SECRET, rememberKeys: true });
    expect(session.data.has("meridian.apiKeys.session")).toBe(false);
    expect(loadSettings()).toMatchObject({ openaiApiKey: SECRET, rememberKeys: true });
  });

  it("takes the keys off the device when a reader turns remembering off", () => {
    const { local, session } = fakeBrowser();
    saveSettings(withKeys({ rememberKeys: true }));
    saveSettings(withKeys({ rememberKeys: false }));
    expect(local.data.get("meridian.apiKeys")).not.toContain("secret");
    expect(session.data.get("meridian.apiKeys.session")).toContain(SECRET);
  });

  it("leaves settings saved before this option on the device, so an upgrade never loses a key", () => {
    fakeBrowser({ local: { "meridian.apiKeys": JSON.stringify({ typesafeApiKey: "", typesafeModel: "jev-latest", openaiApiKey: SECRET, openaiModel: "gpt-4o", autoEvaluate: true }) } });
    expect(loadSettings()).toMatchObject({ openaiApiKey: SECRET, rememberKeys: true });
  });

  it("does not leave a stale tab key behind once every key is cleared", () => {
    const { session } = fakeBrowser();
    saveSettings(withKeys());
    saveSettings({ ...emptySettings });
    expect(session.data.has("meridian.apiKeys.session")).toBe(false);
  });

  it("copes with no sessionStorage or unreadable stored data, and never throws", () => {
    fakeBrowser({ noSession: true });
    expect(() => saveSettings(withKeys())).not.toThrow();
    expect(loadSettings().openaiApiKey).toBe("");
    fakeBrowser({ local: { "meridian.apiKeys": "{not json" }, session: { "meridian.apiKeys.session": "nope" } });
    expect(loadSettings()).toEqual(emptySettings);
  });
});
