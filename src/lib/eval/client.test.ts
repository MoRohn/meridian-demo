import { afterEach, describe, expect, it, vi } from "vitest";
import { runEvaluation, savedJudgeKey } from "./client";

const REQUEST = { kind: "risk" as const, backend: "typesafe" as const, input: "i", actualOutput: "o", context: "c" };

function stubBrowser(saved: object | null) {
  vi.stubGlobal("window", { localStorage: { getItem: () => (saved ? JSON.stringify(saved) : null) } });
  const fetchMock = vi.fn().mockResolvedValue({ json: async () => ({ outcome: { ok: false, reason: "error", message: "x" } }) });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}
const sent = (f: ReturnType<typeof vi.fn>) => JSON.parse(f.mock.calls[0][1].body);

afterEach(() => vi.unstubAllGlobals());

describe("runEvaluation and the saved OpenAI key", () => {
  it("sends only the key from Settings, never the model chosen for chat", async () => {
    const f = stubBrowser({ openaiApiKey: "  sk-saved-0123456789abcdef  ", openaiModel: "gpt-6-astra", typesafeApiKey: "ts-key-should-not-travel-000" });
    await runEvaluation(REQUEST);
    const body = sent(f);
    expect(body.override).toEqual({ provider: "openai", apiKey: "sk-saved-0123456789abcdef" });
    expect(JSON.stringify(body)).not.toContain("gpt-6-astra");
    expect(JSON.stringify(body)).not.toContain("ts-key-should-not-travel");
  });

  it("sends no override at all when nothing is saved, or the saved key is blank", async () => {
    for (const saved of [null, { openaiApiKey: "" }, { openaiApiKey: "   " }]) {
      const f = stubBrowser(saved);
      await runEvaluation(REQUEST);
      expect("override" in sent(f)).toBe(false);
      vi.unstubAllGlobals();
    }
  });

  it("sends the chosen Claude judge with its own key and model, and never the OpenAI key", async () => {
    const f = stubBrowser({ openaiApiKey: "sk-openai-must-not-travel-000", judgeProvider: "anthropic", judgeModel: "claude-sonnet-5", judgeApiKey: "sk-ant-api03-judge-key-000000" });
    await runEvaluation(REQUEST);
    expect(sent(f).override).toEqual({ provider: "anthropic", model: "claude-sonnet-5", apiKey: "sk-ant-api03-judge-key-000000" });
    expect(JSON.stringify(sent(f))).not.toContain("sk-openai-must-not-travel");
  });

  it("reports the saved key to the UI without exposing it elsewhere", () => {
    stubBrowser({ openaiApiKey: "sk-saved-0123456789abcdef" });
    expect(savedJudgeKey()).toBe("sk-saved-0123456789abcdef");
    vi.unstubAllGlobals();
    expect(savedJudgeKey()).toBeUndefined(); // server side: no window, no key
  });
});
