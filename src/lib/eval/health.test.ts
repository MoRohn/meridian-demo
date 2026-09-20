import { describe, expect, it } from "vitest";
import { describeHealth, judgeKeyAvailable, toEvalHealth } from "./health";
import { evalLogLine } from "./log";

const OK = { status: "ok", judge_configured: true, judge_model: "gpt-4o-mini", pass_threshold: 0.6, rubrics: { risk: "1.1" } };

describe("toEvalHealth", () => {
  it("maps a healthy service", () => {
    expect(toEvalHealth(OK)).toEqual({ status: "ready", judgeModel: "gpt-4o-mini", threshold: 0.6, rubrics: { risk: "1.1" } });
  });
  it("flags a running service whose judge key is missing", () => {
    expect(toEvalHealth({ ...OK, judge_configured: false }).status).toBe("judge_not_configured");
  });
  it.each([[null], [undefined], [{}], [{ status: "error" }], [{ status: "ok" }], ["nope"]])("treats %j as offline instead of throwing", (bad) => {
    expect(toEvalHealth(bad)).toEqual({ status: "offline" });
  });
  it("defaults the threshold when the service omits it", () => {
    expect(toEvalHealth({ ...OK, pass_threshold: undefined })).toMatchObject({ threshold: 0.6 });
  });
});

describe("describeHealth", () => {
  it("words each state for the reader", () => {
    expect(describeHealth(toEvalHealth(OK))).toEqual({ tone: "ok", text: "Judge ready · gpt-4o-mini · pass at 60%" });
    expect(describeHealth(toEvalHealth({ ...OK, judge_configured: false })).tone).toBe("warn");
    expect(describeHealth({ status: "offline" }).text).toContain("npm run eval-service");
    expect(describeHealth(toEvalHealth({ ...OK, judge_configured: false })).text).toContain("Save an OpenAI key in Settings");
  });
});

describe("describeHealth with a key saved in Settings", () => {
  it("is ready even when the service has no key of its own, and says whose key is used", () => {
    const noKey = toEvalHealth({ ...OK, judge_configured: false });
    expect(describeHealth(noKey, { savedKey: true })).toEqual({ tone: "ok", text: "Judge ready, using your saved OpenAI key · gpt-4o-mini · pass at 60%" });
  });
  it("cannot be rescued by a saved key when the service itself is offline", () => {
    expect(describeHealth({ status: "offline" }, { savedKey: true }).tone).toBe("off");
  });
});

describe("evalLogLine", () => {
  const ok = { ok: true as const, result: { score: 0.8123, reason: "SECRET CONTRACT REASON", success: true, threshold: 0.6, judgeModel: "m", rubric: { id: "risk", version: "1.1", title: "t" }, steps: ["s"], bands: [], judgeCostUsd: null, integrity: { status: "suspicious" as const, signals: [], hiddenCharsRemoved: 0 }, latencyMs: 812 } };
  it("records what monitoring needs and never the judged text", () => {
    const line = evalLogLine({ kind: "risk", backend: "typesafe", outcome: ok, ms: 950 });
    expect(JSON.parse(line)).toEqual({ evt: "eval", kind: "risk", backend: "typesafe", ok: true, score: 0.81, success: true, rubric: "risk@1.1", integrity: "suspicious", judgeMs: 812, ms: 950 });
    expect(line).not.toContain("SECRET");
  });
  it("records a failure with its stable code", () => {
    const line = JSON.parse(evalLogLine({ kind: "citation", backend: "openai", outcome: { ok: false, reason: "error", code: "judge_rate_limited", message: "x" }, ms: 40 }));
    expect(line).toMatchObject({ ok: false, reason: "error", code: "judge_rate_limited", ms: 40 });
  });
});

const PROVIDERS = { openai: { default_model: "gpt-4o-mini", env_key: false }, anthropic: { default_model: "claude-sonnet-5", env_key: false }, gemini: { default_model: "gemini-2.5-flash", env_key: true } };
const WITH_PROVIDERS = toEvalHealth({ ...OK, judge_configured: false, providers: PROVIDERS });

describe("who can judge", () => {
  it("reads each provider's default model and whether the service holds a key for it", () => {
    expect(WITH_PROVIDERS).toMatchObject({ providers: { anthropic: { defaultModel: "claude-sonnet-5", envKey: false }, gemini: { defaultModel: "gemini-2.5-flash", envKey: true } } });
  });
  it("tolerates a service too old to list them", () => {
    expect(toEvalHealth(OK)).not.toHaveProperty("providers");
    expect(toEvalHealth({ ...OK, providers: { anthropic: {} } })).not.toHaveProperty("providers");
  });

  it("is ready for a Claude judge only when a key is saved or the service has one of its own", () => {
    expect(judgeKeyAvailable(WITH_PROVIDERS, "anthropic", false)).toBe(false);
    expect(judgeKeyAvailable(WITH_PROVIDERS, "anthropic", true)).toBe(true);
    expect(judgeKeyAvailable(WITH_PROVIDERS, "gemini", false)).toBe(true); // the service's own Gemini key
  });
  it("does not mistake the service's OpenAI key for a Claude judge's", () => {
    expect(judgeKeyAvailable(toEvalHealth({ ...OK, providers: PROVIDERS }), "anthropic", false)).toBe(false);
    expect(judgeKeyAvailable(toEvalHealth({ ...OK, providers: PROVIDERS }), "openai", false)).toBe(true);
  });
  it("is never ready while the service is offline, unless a key is saved (the run itself then reports the outage)", () => {
    expect(judgeKeyAvailable({ status: "offline" }, "openai", false)).toBe(false);
  });

  it("says whose key and which model judge, for a saved key", () => {
    expect(describeHealth(WITH_PROVIDERS, { savedKey: true, judge: { provider: "anthropic", label: "Claude", model: "claude-opus-5" } }).text).toBe("Judge ready, using your saved Claude key \u00b7 claude-opus-5 \u00b7 pass at 60%");
  });
  it("names the provider's default model when none was picked", () => {
    expect(describeHealth(WITH_PROVIDERS, { savedKey: true, judge: { provider: "gemini", label: "Gemini", model: null } }).text).toContain("gemini-2.5-flash");
  });
  it("points a Claude judge with no key at the Judge model section, not at an OpenAI variable", () => {
    const r = describeHealth(WITH_PROVIDERS, { judge: { provider: "anthropic", label: "Claude", model: "claude-sonnet-5" } });
    expect(r.tone).toBe("warn");
    expect(r.text).toContain("Add one under Judge model in Settings");
    expect(r.text).not.toContain("OPENAI_API_KEY");
  });
  it("is unchanged for the default OpenAI judge", () => {
    expect(describeHealth(toEvalHealth(OK), { judge: { provider: "openai", label: "OpenAI", model: null } }).text).toBe("Judge ready \u00b7 gpt-4o-mini \u00b7 pass at 60%");
  });
});
