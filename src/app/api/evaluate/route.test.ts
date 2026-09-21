import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const KEY = "sk-saved-ROUTEKEY0123456789";
const OK_RESULT = { score: 0.8, reason: "r", success: true, threshold: 0.6, judge_model: "m", rubric: { id: "risk", version: "1.1", title: "t" }, steps: [], integrity: { status: "clean", signals: [], hidden_chars_removed: 0 }, latency_ms: 5 };
const BODY = { kind: "risk", backend: "typesafe", input: "i", actualOutput: "o", context: "SECRET CONTRACT TEXT" };

async function load(serviceUrl: string) {
  vi.resetModules();
  vi.stubEnv("EVAL_SERVICE_URL", serviceUrl);
  return (await import("./route")).POST;
}
const post = (POST: Awaited<ReturnType<typeof load>>, body: object) =>
  POST(new NextRequest("http://localhost:3000/api/evaluate", { method: "POST", body: JSON.stringify(body) }));

let fetchMock: ReturnType<typeof vi.fn>;
let logs: string[];
beforeEach(() => {
  fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => OK_RESULT });
  vi.stubGlobal("fetch", fetchMock);
  logs = [];
  vi.spyOn(console, "info").mockImplementation((...a) => void logs.push(a.join(" ")));
  vi.spyOn(console, "error").mockImplementation((...a) => void logs.push(a.join(" ")));
  vi.spyOn(console, "warn").mockImplementation((...a) => void logs.push(a.join(" ")));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
const upstream = () => ({ headers: fetchMock.mock.calls[0][1].headers as Record<string, string>, body: fetchMock.mock.calls[0][1].body as string });

describe("POST /api/evaluate result mapping", () => {
  it("passes the rubric bands and the judge's own cost through", async () => {
    const bands = [{ low: 0, high: 5, outcome: "bad" }, { low: 6, high: 10, outcome: "good" }];
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ ...OK_RESULT, bands, judge_cost_usd: 0.0012 }) });
    const POST = await load("http://localhost:8008");
    const { result } = (await (await post(POST, BODY)).json()).outcome;
    expect(result.bands).toEqual(bands);
    expect(result.judgeCostUsd).toBe(0.0012);
  });

  it("shows a busy judge as a retryable failure with its own code, not as a judge that is not configured", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 429, json: async () => ({ detail: "G-Eval judge call failed (judge_busy): The evaluation service is handling as many judge calls as it allows. Try again in a few seconds." }) });
    const POST = await load("http://localhost:8008");
    const { outcome } = await (await post(POST, BODY)).json();
    expect(outcome).toMatchObject({ ok: false, reason: "error", code: "judge_busy" });
    expect(outcome.message).toMatch(/Try again in a few seconds/);
  });

  it("defaults them for an older service that does not send them", async () => {
    const POST = await load("http://localhost:8008");
    const { result } = (await (await post(POST, BODY)).json()).outcome;
    expect(result.bands).toEqual([]);
    expect(result.judgeCostUsd).toBeNull();
  });
});

describe("POST /api/evaluate and the saved key", () => {
  it.each(["http://localhost:8008", "http://127.0.0.1:8008", "https://eval.example.com"])("forwards the key as a header, and only there, to %s", async (url) => {
    const POST = await load(url);
    const res = await post(POST, { ...BODY, override: { apiKey: KEY } });
    expect((await res.json()).outcome.ok).toBe(true);
    const { headers, body } = upstream();
    expect(headers["X-Judge-Api-Key"]).toBe(KEY);
    expect(body).not.toContain(KEY);
    expect(body).not.toContain("override");
  });

  it("does not forward the key over plaintext http to a remote host", async () => {
    const POST = await load("http://eval.internal.example.com:8008");
    await post(POST, { ...BODY, override: { apiKey: KEY } });
    expect(upstream().headers["X-Judge-Api-Key"]).toBeUndefined();
    expect(JSON.stringify(fetchMock.mock.calls)).not.toContain(KEY);
  });

  it("explains that the key was withheld when the service then has no key of its own", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 503, json: async () => ({ detail: "No judge API key: set OPENAI_API_KEY" }) });
    const POST = await load("http://eval.internal.example.com:8008");
    const outcome = (await (await post(POST, { ...BODY, override: { apiKey: KEY } })).json()).outcome;
    expect(outcome).toMatchObject({ ok: false, reason: "not_configured" });
    expect(outcome.message).toContain("not sent");
    expect(JSON.stringify(outcome)).not.toContain(KEY);
  });

  it("sends no key header when none was provided or the key is malformed", async () => {
    const POST = await load("http://localhost:8008");
    for (const override of [undefined, { apiKey: "" }, { apiKey: "short" }, { apiKey: "has spaces in the key 0123" }, { apiKey: 42 }]) {
      fetchMock.mockClear();
      await post(POST, { ...BODY, override });
      expect(upstream().headers["X-Judge-Api-Key"]).toBeUndefined();
    }
  });

  it("never writes the key, or the judged text, to the server log, on success or failure", async () => {
    const POST = await load("http://localhost:8008");
    await post(POST, { ...BODY, override: { apiKey: KEY } });
    fetchMock.mockRejectedValueOnce(new Error(`connect ECONNREFUSED while sending ${KEY}`));
    const unreachable0 = (await (await post(POST, { ...BODY, override: { apiKey: KEY } })).json()).outcome;
    expect(unreachable0).toEqual({ ok: false, reason: "not_configured", code: "service_offline", message: "The evaluation service isn't running." });
    expect(logs.join("\n")).toContain("[redacted]"); // the detail is kept for the operator, with the key masked
    fetchMock.mockResolvedValueOnce({ ok: false, status: 502, json: async () => ({ detail: "G-Eval judge call failed (judge_auth): The judge API key was rejected." }) });
    const rejected = (await (await post(POST, { ...BODY, override: { apiKey: KEY } })).json()).outcome;
    expect(rejected).toMatchObject({ ok: false, code: "judge_auth" });
    const all = logs.join("\n");
    expect(all).toContain('"evt":"eval"');
    expect(all).not.toContain(KEY);
    expect(all).not.toContain("SECRET CONTRACT TEXT");
  });

  it("tells the reader only that the service isn't running: no address, no low-level error text", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    const POST = await load("http://localhost:8008");
    const outcome = (await (await post(POST, BODY)).json()).outcome;
    expect(outcome.message).toBe("The evaluation service isn't running.");
    expect(outcome.message).not.toMatch(/localhost|8008|fetch failed/);
    expect(logs.join("\n")).toContain("fetch failed"); // ...but the operator's log keeps it
  });
});

describe("POST /api/evaluate: who judges", () => {
  it("forwards the chosen provider and model as headers, with that provider's key, and none of it in the body", async () => {
    const POST = await load("http://localhost:8008");
    await post(POST, { ...BODY, override: { apiKey: "sk-ant-api03-JUDGEKEY0000000000", provider: "anthropic", model: "claude-sonnet-5" } });
    const { headers, body } = upstream();
    expect(headers["X-Judge-Provider"]).toBe("anthropic");
    expect(headers["X-Judge-Model"]).toBe("claude-sonnet-5");
    expect(headers["X-Judge-Api-Key"]).toBe("sk-ant-api03-JUDGEKEY0000000000");
    expect(body).not.toContain("claude-sonnet-5");
    expect(body).not.toContain("JUDGEKEY");
  });

  it("sends no provider or model headers when none was chosen, as before", async () => {
    const POST = await load("http://localhost:8008");
    await post(POST, { ...BODY, override: { apiKey: KEY } });
    expect(upstream().headers["X-Judge-Provider"]).toBeUndefined();
    expect(upstream().headers["X-Judge-Model"]).toBeUndefined();
    expect(upstream().headers["X-Judge-Api-Key"]).toBe(KEY);
  });

  it.each([["grok"], ["ANTHROPIC"], [""], ["openai\nX-Injected: 1"]])("rejects an unknown provider %j before any request is made", async (provider) => {
    const POST = await load("http://localhost:8008");
    const res = await post(POST, { ...BODY, override: { apiKey: KEY, provider } });
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([["gpt 4o"], ["gpt-4o; drop"], ["x".repeat(101)], ["a\r\nX-Injected: 1"], ["-lead"], [42]])("rejects a model that is not shaped like a model id: %j", async (model) => {
    const POST = await load("http://localhost:8008");
    const res = await post(POST, { ...BODY, override: { apiKey: KEY, provider: "openai", model } });
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("names the provider, not OpenAI, when a saved key is withheld from a remote plain-http service", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 503, json: async () => ({ detail: "No judge API key for Claude: set ANTHROPIC_API_KEY for the eval service, or save a Claude key in Meridian's Settings." }) });
    const POST = await load("http://eval.example.com:8008");
    const { outcome } = await (await post(POST, { ...BODY, override: { apiKey: "sk-ant-api03-JUDGEKEY0000000000", provider: "anthropic", model: "claude-sonnet-5" } })).json();
    expect(outcome.ok).toBe(false);
    expect(outcome.message).toContain("Your saved Claude key was not sent");
    expect(upstream().headers["X-Judge-Api-Key"]).toBeUndefined(); // a key never travels in plaintext to a remote host
    expect(upstream().headers["X-Judge-Provider"]).toBe("anthropic"); // the choice is not a secret
  });

  it("reports the model that actually judged, as the service names it", async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ ...OK_RESULT, judge_model: "claude-haiku-4-5-20251001" }) });
    const POST = await load("http://localhost:8008");
    const { result } = (await (await post(POST, { ...BODY, override: { apiKey: KEY, provider: "anthropic", model: "claude-haiku-4-5-20251001" } })).json()).outcome;
    expect(result.judgeModel).toBe("claude-haiku-4-5-20251001");
  });
});

describe("POST /api/evaluate: one verdict rule for every judge", () => {
  const judged = async (score: number, threshold = 0.6, success: boolean | undefined = undefined) => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ ...OK_RESULT, score, threshold, success }) });
    const POST = await load("http://localhost:8008");
    return (await (await post(POST, BODY)).json()).outcome.result;
  };

  it("passes a score shown as 60% against a 60% mark, even when the service's raw float said 0.5999999999999999 and Fail", async () => {
    const r = await judged(0.5999999999999999, 0.6, false); // an older service, as DeepEval computed it
    expect(r.score).toBe(0.6);
    expect(r.success).toBe(true);
  });

  it("gives both backends the same verdict at the same displayed score", async () => {
    const a = await judged(0.5999999999999999, 0.6, false);
    const b = await judged(0.6, 0.6, true);
    expect([a.score, a.success]).toEqual([b.score, b.success]);
  });

  it("fails a score shown as 59%, and says 59", async () => {
    const r = await judged(0.594, 0.6, true);
    expect(r.score).toBe(0.59);
    expect(r.success).toBe(false);
  });

  it("leaves a settled score exactly as it is", async () => {
    const r = await judged(0.85, 0.6, true);
    expect([r.score, r.success]).toEqual([0.85, true]);
  });
});

describe("POST /api/evaluate request validation", () => {
  it("refuses an actualOutput that is not a non-empty string of sane length, without calling the service", async () => {
    const POST = await load("http://localhost:8008");
    for (const actualOutput of [undefined, "", "   ", 42, { text: "x" }, ["x"], "x".repeat(20_001)]) {
      const res = await post(POST, { ...BODY, actualOutput });
      expect(res.status).toBe(400);
      expect((await res.json()).error).toMatch(/actualOutput/);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses a bad input or context, and an unknown kind or backend", async () => {
    const POST = await load("http://localhost:8008");
    expect((await post(POST, { ...BODY, input: 5 })).status).toBe(400);
    expect((await post(POST, { ...BODY, input: "x".repeat(20_001) })).status).toBe(400);
    expect((await post(POST, { ...BODY, context: { a: 1 } })).status).toBe(400);
    expect((await post(POST, { ...BODY, context: "x".repeat(120_001) })).status).toBe(400);
    expect((await post(POST, { ...BODY, kind: "nope" })).status).toBe(400);
    expect((await post(POST, { ...BODY, backend: "nope" })).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("still accepts a request with no context", async () => {
    const POST = await load("http://localhost:8008");
    const noContext: Partial<typeof BODY> = { ...BODY };
    delete noContext.context;
    expect((await post(POST, noContext)).status).toBe(200);
  });
});

describe("POST /api/evaluate service token", () => {
  it("sends X-Eval-Token to the service when one is configured, and nothing when it is not", async () => {
    vi.stubEnv("EVAL_SERVICE_TOKEN", "shared-secret");
    let POST = await load("http://localhost:8008");
    await post(POST, BODY);
    expect(upstream().headers["X-Eval-Token"]).toBe("shared-secret");

    fetchMock.mockClear();
    vi.stubEnv("EVAL_SERVICE_TOKEN", "");
    POST = await load("http://localhost:8008");
    await post(POST, BODY);
    expect(upstream().headers).not.toHaveProperty("X-Eval-Token");
  });
});
