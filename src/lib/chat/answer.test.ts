import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ComposedTurn } from "../orchestrator/compose";
import type { SessionState } from "../orchestrator/state";
import { SAMPLE_CONTRACTS } from "../data/sampleContracts";
import type { Answer } from "../typesafe/types";
import { analysisFor, writeReply } from "./answer";

const saas = SAMPLE_CONTRACTS[0];
const session: SessionState = {
  id: "s", createdAt: 0, history: [{ role: "user", text: "Analyze this contract" }, { role: "assistant", text: "I've scored it." }],
  contextFacts: { contractType: "saas_msa" }, activeDocument: { id: "d", name: saas.name, text: saas.text },
};
const score = (n: number): Answer => ({ type: "score", score: n, legend: { "0": "a", "1": "b", "2": "c" }, probabilities: { "1": 1 }, confidence: 0.8 });
const noul = (n: number): Answer => ({ type: "noul", noul: n });
const answers: Record<string, Answer> = {
  liability_exposure: score(1.2), indemnification_harshness: score(1.8), termination_rigidity: score(1),
  auto_renewal_trap: noul(0.84), unlimited_liability: noul(0.2), missing_data_protection_clause: noul(0.9), missing_governing_law: noul(0.1),
};
const composed = (over: Partial<ComposedTurn> = {}): ComposedTurn => ({
  reply: "TEMPLATE", intent: { choice: "ask_legal_question", confidence: 0.9 }, risk: null, complianceFlags: [], blocked: null, used: new Set(), contractType: null, ...over,
});
const args = (over = {}) => ({ message: "Can I terminate early?", session, answers, composed: composed(), citeFlagProbability: true, override: { apiKey: "sk-test", model: "gpt-4o" }, ...over });

const ok = (text: string, model = "gpt-4o") => ({ ok: true, status: 200, json: async () => ({ model, choices: [{ message: { content: text } }], usage: { prompt_tokens: 1000, completion_tokens: 120 } }), text: async () => "" });
const fail = (status: number, body = "boom") => ({ ok: false, status, json: async () => ({}), text: async () => body });

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  delete process.env.OPENAI_API_KEY;
});
afterEach(() => vi.unstubAllGlobals());

describe("analysisFor", () => {
  it("hands the writer the app's own figures, quoting a flag's probability only when the backend has one", () => {
    const ts = analysisFor(session, answers, composed(), true);
    expect(ts.risk?.overall).toBeCloseTo(0.67, 2);
    expect(ts.risk?.band).toBeTruthy();
    expect(ts.contractType).toBeTruthy();
    expect(ts.flags.find((f) => f.flagged)?.probability).toBeCloseTo(0.84);
    expect(analysisFor(session, answers, composed(), false).flags.every((f) => f.probability === undefined)).toBe(true);
  });
});

describe("writeReply with a model", () => {
  it("returns the model's answer with its model, tokens, timing and cost, and sends the document and findings", async () => {
    fetchMock.mockResolvedValueOnce(ok("You can terminate on notice. > \"Either party may terminate\" (Section 6)."));
    const out = await writeReply(args());
    expect(out.reply).toContain("Section 6");
    expect(out.answer).toMatchObject({ source: "model", model: "gpt-4o", usage: { input_tokens: 1000, output_tokens: 120 } });
    expect(out.answer.costUsd).toBeGreaterThan(0);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.openai.com/v1/chat/completions");
    expect(init.headers.Authorization).toBe("Bearer sk-test");
    const body = JSON.parse(init.body);
    expect(body.model).toBe("gpt-4o");
    const user = body.messages[1].content;
    expect(user).toContain(saas.text.slice(0, 60));
    expect(user).toContain("Can I terminate early?");
    expect(user).toContain("APPLICATION ANALYSIS");
    expect(user).toContain("Analyze this contract"); // the conversation so far
  });

  it("uses the key saved in Settings ahead of the environment's", async () => {
    process.env.OPENAI_API_KEY = "sk-env";
    fetchMock.mockResolvedValueOnce(ok("fine"));
    await writeReply(args());
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe("Bearer sk-test");
  });

  it("gives a reasoning model room to think and no temperature, and a plain model a low one", async () => {
    fetchMock.mockResolvedValue(ok("fine"));
    await writeReply(args({ override: { apiKey: "k", model: "gpt-5.1" } }));
    await writeReply(args({ override: { apiKey: "k", model: "gpt-4o" } }));
    const [reasoning, plain] = fetchMock.mock.calls.map((c) => JSON.parse(c[1].body));
    expect(reasoning).toMatchObject({ reasoning_effort: "low", max_completion_tokens: 6000 });
    expect(reasoning.temperature).toBeUndefined();
    expect(plain).toMatchObject({ temperature: 0.3, max_completion_tokens: 1200 });
  });

  it("retries on a model every account can call when the chosen one is not available, and says so", async () => {
    fetchMock.mockResolvedValueOnce(fail(404, "The model `gpt-9` does not exist")).mockResolvedValueOnce(ok("from the fallback", "gpt-4o-mini"));
    const out = await writeReply(args({ override: { apiKey: "k", model: "gpt-9" } }));
    expect(out.reply).toBe("from the fallback");
    expect(out.answer.source).toBe("model");
    expect(out.answer.note).toContain("gpt-9 was not available");
  });

  it("never rewrites a guardrail refusal, and makes no model call for it", async () => {
    const out = await writeReply(args({ composed: composed({ blocked: "injection", reply: "I can't do that." }) }));
    expect(out.reply).toBe("I can't do that.");
    expect(out.answer.source).toBe("template");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("writeReply when the model cannot answer", () => {
  it("quotes the document for an open question and says why, when the call fails", async () => {
    fetchMock.mockResolvedValueOnce(fail(401, "bad key"));
    const out = await writeReply(args());
    expect(out.answer.source).toBe("document");
    expect(out.answer.note).toContain("could not be reached");
    expect(out.reply).toContain("Section 6: Termination");
  });

  it("with no key at all, does the same without calling anything or claiming a failure", async () => {
    const out = await writeReply(args({ override: undefined }));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(out.answer).toEqual({ source: "document" });
    expect(out.reply).toContain("> ");
    expect(out.reply).toContain("Save an OpenAI key");
  });

  it("summarizes from the sections when asked for a recap with no key", async () => {
    const out = await writeReply(args({ override: undefined, message: "recap please", composed: composed({ intent: { choice: "summarize_context", confidence: 0.9 } }) }));
    expect(out.reply).toContain("6 clauses");
  });

  it("keeps Meridian's own analysis wording for an analysis request when no model is available", async () => {
    const out = await writeReply(args({ override: undefined, composed: composed({ intent: { choice: "analyze_contract", confidence: 0.9 } }) }));
    expect(out).toEqual({ reply: "TEMPLATE", answer: { source: "template" } });
  });
});
