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
