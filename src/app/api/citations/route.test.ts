import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { SAMPLE_CONTRACTS } from "@/lib/data/sampleContracts";
import { extractChecks } from "@/lib/citations/extract";
import type { OpenAIRunOutcome } from "@/lib/openai/types";

const runMock = vi.fn();
vi.mock("@/lib/openai/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/openai/client")>()),
  runOpenAIEquivalent: (...args: unknown[]) => runMock(...args),
}));

const { POST } = await import("./route");
const post = (body: unknown) => POST(new NextRequest("http://localhost/api/citations", { method: "POST", body: JSON.stringify(body) }));

const checks = extractChecks({ text: SAMPLE_CONTRACTS[0].text, scope: "document" }).checks.filter((c) => c.resolution === "model").map((c) => ({ id: c.id, claim: c.claim, source: c.source }));

beforeEach(() => {
  runMock.mockReset();
  vi.stubEnv("TYPESAFE_API_KEY", "");
});

describe("POST /api/citations: TypeSafe", () => {
  it("judges every check in one request and reports what the call measured", async () => {
    const data = await (await post({ backend: "typesafe", checks })).json();
    expect(data.ok).toBe(true);
    expect(Object.keys(data.judged).sort()).toEqual(checks.map((c) => c.id).sort());
    expect(data.judged.term_liability).toMatchObject({ relation: "contradicts", verdict: "contradicted", basis: "calibrated" });
    expect(data.source).toBe("mock"); // no TypeSafe key in the test environment: the local demo evaluator answered
    expect(data.usage.input_tokens).toBeGreaterThan(0);
    expect(data.inputBytes).toBeGreaterThan(0);
  });
});

describe("POST /api/citations: OpenAI", () => {
  const opinion = (relations: Record<string, string>): OpenAIRunOutcome => ({
    ok: true,
    result: { model: "gpt-4o", answers: Object.fromEntries(Object.entries(relations).map(([id, r]) => [`relation_${id}`, { value: r, selfReportedConfidence: 0.9 }])), usage: { input_tokens: 900, output_tokens: 80 }, elapsedMs: 4200, source: "live", requestBytes: 5000 },
  });

  it("sends the same questions and reads the answers back the same way", async () => {
    runMock.mockResolvedValue(opinion({ term_liability: "contradicts", term_termination: "supports" }));
    const data = await (await post({ backend: "openai", checks })).json();
    expect(data).toMatchObject({ ok: true, model: "gpt-4o", source: "live", elapsedMs: 4200 });
    expect(data.judged.term_liability).toMatchObject({ verdict: "contradicted", confidence: 0.9, basis: "self-reported" });
    expect(Object.keys(data.judged).sort()).toEqual(["term_liability", "term_termination"]); // an answer OpenAI did not give is not invented
    const [state, questions] = runMock.mock.calls[0];
    expect(Object.keys(questions)).toEqual(checks.map((c) => `relation_${c.id}`));
    expect(state.checks.term_liability.claim).toBe(checks.find((c) => c.id === "term_liability")!.claim);
  });

  it("passes a failed or unconfigured call straight through, so the table can say why", async () => {
    runMock.mockResolvedValue({ ok: false, reason: "not_configured" } satisfies OpenAIRunOutcome);
    expect(await (await post({ backend: "openai", checks })).json()).toEqual({ ok: false, reason: "not_configured" });
    runMock.mockResolvedValue({ ok: false, reason: "error", message: "OpenAI 500" } satisfies OpenAIRunOutcome);
    expect(await (await post({ backend: "openai", checks })).json()).toEqual({ ok: false, reason: "error", message: "OpenAI 500" });
    runMock.mockRejectedValue(new Error("socket hang up"));
    expect(await (await post({ backend: "openai", checks })).json()).toMatchObject({ ok: false, reason: "error", message: "socket hang up" });
  });
});

describe("POST /api/citations: validation", () => {
  const ok = { id: "term_a", claim: "A claim.", source: "A source." };
  it.each([
    ["an unknown backend", { backend: "grok", checks: [ok] }],
    ["no checks", { backend: "typesafe", checks: [] }],
    ["too many checks", { backend: "typesafe", checks: Array.from({ length: 41 }, (_, i) => ({ ...ok, id: `c${i}` })) }],
    ["a duplicate id", { backend: "typesafe", checks: [ok, ok] }],
    ["an id that is not a plain name", { backend: "typesafe", checks: [{ ...ok, id: "a b; drop" }] }],
    ["a blank claim", { backend: "typesafe", checks: [{ ...ok, claim: "  " }] }],
    ["an over-long source", { backend: "typesafe", checks: [{ ...ok, source: "x".repeat(6001) }] }],
    ["a non-string claim", { backend: "typesafe", checks: [{ ...ok, claim: 5 }] }],
  ])("rejects %s before any model is called", async (_label, body) => {
    const res = await post(body);
    expect(res.status).toBe(400);
    expect(runMock).not.toHaveBeenCalled();
  });

  it("rejects a body that is not JSON", async () => {
    const res = await POST(new NextRequest("http://localhost/api/citations", { method: "POST", body: "not json" }));
    expect(res.status).toBe(400);
  });
});
