import { afterEach, describe, expect, it, vi } from "vitest";
import { OPENAI_REASONING_TIMEOUT_MS, OPENAI_TIMEOUT_MS, OPENAI_RESPONSES_URL, describeFetchError, readReasoningSummary, reasoningEffort, runOpenAIEquivalent } from "./client";

afterEach(() => vi.unstubAllGlobals());

describe("describeFetchError", () => {
  it("says a timeout was a timeout", () => {
    const timeout = Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });
    expect(describeFetchError(timeout)).toBe(`OpenAI did not answer within ${OPENAI_TIMEOUT_MS / 1000}s`);
  });
  it("passes any other error message through", () => {
    expect(describeFetchError(new Error("fetch failed"))).toBe("fetch failed");
    expect(describeFetchError(undefined)).toBe("OpenAI request failed");
  });
});

describe("runOpenAIEquivalent", () => {
  it("gives every call an abort signal, and reports a stalled call as an error instead of hanging", async () => {
    const seen: (AbortSignal | undefined)[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      seen.push(init.signal ?? undefined);
      throw Object.assign(new Error("aborted"), { name: "TimeoutError" });
    }));
    const outcome = await runOpenAIEquivalent({}, { q: { type: "noul", instructions: "x" } } as never, { apiKey: "sk-test-key-0000000000" });
    expect(seen[0]).toBeInstanceOf(AbortSignal);
    // The default model reasons, and a reasoning pass gets the longer allowance.
    expect(outcome).toEqual({ ok: false, reason: "error", message: `OpenAI did not answer within ${OPENAI_REASONING_TIMEOUT_MS / 1000}s` });
    expect(seen).toHaveLength(1); // a timeout is not "model unavailable", so there is no fallback retry
  });
});

const QUESTIONS = { q: { type: "noul", instructions: "x" } } as never;
const KEY = { apiKey: "sk-test-key-0000000000" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

const responsesBody = {
  model: "gpt-6-astra",
  output: [
    { type: "reasoning", summary: [{ type: "summary_text", text: "The clause caps liability, so the answer is no." }] },
    { type: "function_call", name: "record_context_judgments", arguments: JSON.stringify({ q: false, q_confidence: 0.8 }) },
  ],
  usage: { input_tokens: 500, output_tokens: 900, output_tokens_details: { reasoning_tokens: 700 } },
};

describe("reasoning", () => {
  it("defaults to medium, accepts the documented efforts, and ignores anything else", () => {
    expect(reasoningEffort(undefined)).toBe("medium");
    expect(reasoningEffort("HIGH")).toBe("high");
    expect(reasoningEffort("none")).toBe("none");
    expect(reasoningEffort("maximum")).toBe("medium");
  });

  it("reads the summary out of a Responses API reply", () => {
    expect(readReasoningSummary(responsesBody.output)).toBe("The clause caps liability, so the answer is no.");
    expect(readReasoningSummary([{ type: "reasoning", summary: [] }])).toBeNull();
    expect(readReasoningSummary(undefined)).toBeNull();
  });

  it("thinks first through the Responses API and returns the summary and the reasoning tokens", async () => {
    const calls: { url: string; body: Record<string, unknown> }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init.body)) });
      return json(responsesBody);
    }));
    const outcome = await runOpenAIEquivalent({}, QUESTIONS, KEY);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(OPENAI_RESPONSES_URL);
    expect(calls[0].body).toMatchObject({ reasoning: { effort: "medium", summary: "auto" }, tool_choice: { type: "function", name: "record_context_judgments" } });
    expect(outcome).toMatchObject({ ok: true, result: { answers: { q: { value: false, selfReportedConfidence: 0.8 } }, usage: { input_tokens: 500, output_tokens: 900 } } });
    if (outcome.ok) expect(outcome.result.reasoning).toEqual({ effort: "medium", summary: "The clause caps liability, so the answer is no.", tokens: 700 });
  });

  it("answers without reasoning, and says why, when the Responses API refuses the request", async () => {
    const urls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      urls.push(url);
      if (url === OPENAI_RESPONSES_URL) return json({ error: { message: "unsupported" } }, 400);
      return json({ model: "gpt-6-astra", choices: [{ message: { tool_calls: [{ function: { arguments: JSON.stringify({ q: true, q_confidence: 0.9 }) } }] } }], usage: { prompt_tokens: 400, completion_tokens: 50 } });
    }));
    const outcome = await runOpenAIEquivalent({}, QUESTIONS, KEY);
    expect(urls).toHaveLength(2);
    expect(outcome.ok && outcome.result.answers.q.value).toBe(true);
    if (outcome.ok) {
      expect(outcome.result.reasoning).toMatchObject({ effort: "none", summary: null, tokens: null });
      expect(outcome.result.reasoning?.note).toMatch(/answered without it/);
    }
  });

  it("does not hide a timeout or a bad key by retrying without reasoning", async () => {
    const fetchMock = vi.fn(async () => json({ error: { message: "bad key" } }, 401));
    vi.stubGlobal("fetch", fetchMock);
    const outcome = await runOpenAIEquivalent({}, QUESTIONS, KEY);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(outcome).toMatchObject({ ok: false, reason: "error" });
  });

  it("does not reason on a model that cannot, and reports no reasoning at all", async () => {
    const urls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      urls.push(url);
      return json({ model: "gpt-4o-mini", choices: [{ message: { tool_calls: [{ function: { arguments: JSON.stringify({ q: false, q_confidence: 0.7 }) } }] } }], usage: { prompt_tokens: 10, completion_tokens: 5 } });
    }));
    const outcome = await runOpenAIEquivalent({}, QUESTIONS, { ...KEY, model: "gpt-4o-mini" });
    expect(urls).toEqual(["https://api.openai.com/v1/chat/completions"]);
    expect(outcome.ok && outcome.result.reasoning).toBeFalsy();
  });

  it("falls back to another model when the reasoning model is not available to the account at all", async () => {
    const seen: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      const model = JSON.parse(String(init.body)).model;
      seen.push(`${url.split("/").pop()}:${model}`);
      if (model !== "gpt-4o-mini") return json({ error: { message: "The model does not exist" } }, 404);
      return json({ model, choices: [{ message: { tool_calls: [{ function: { arguments: JSON.stringify({ q: false, q_confidence: 0.7 }) } }] } }], usage: { prompt_tokens: 10, completion_tokens: 5 } });
    }));
    const outcome = await runOpenAIEquivalent({}, QUESTIONS, KEY);
    expect(seen).toEqual(["responses:gpt-6-astra", "completions:gpt-6-astra", "completions:gpt-4o-mini"]);
    expect(outcome).toMatchObject({ ok: true, result: { fallbackFrom: "gpt-6-astra" } });
  });
});
