import { describe, expect, it } from "vitest";
import {
  autoEvaluateEnabled,
  DEFAULT_OPENAI_MODEL,
  DEFAULT_TYPESAFE_MODEL,
  loadSettings,
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
  };

  it("returns undefined when no key is set, regardless of the model field", () => {
    expect(typesafeOverride(base)).toBeUndefined();
    expect(openaiOverride(base)).toBeUndefined();
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
  const base: ApiKeySettings = { typesafeApiKey: "", typesafeModel: DEFAULT_TYPESAFE_MODEL, openaiApiKey: "", openaiModel: DEFAULT_OPENAI_MODEL, autoEvaluate: true };

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
