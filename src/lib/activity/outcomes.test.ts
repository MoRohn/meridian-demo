import { describe, expect, it } from "vitest";
import { openaiActivityResult, typesafeActivityResult } from "./outcomes";

const usage = { input_tokens: 1_000_000, output_tokens: 0 };

describe("typesafeActivityResult", () => {
  it("prices a live call and counts it", () => {
    const r = typesafeActivityResult("live", 640, usage);
    expect(r).toMatchObject({ status: "done", modelMs: 640, model: "jev", inputTokens: 1_000_000 });
    expect(r.costUsd).toBeCloseTo(0.042);
    expect(r.simulated).toBeUndefined();
  });
  it("marks the local demo heuristic as simulated and free, so it never counts as the model", () => {
    expect(typesafeActivityResult("mock", 3, usage)).toMatchObject({ simulated: true, costUsd: 0 });
  });
});

describe("openaiActivityResult", () => {
  it("records a successful call with its model, tokens and cost", () => {
    const r = openaiActivityResult({ ok: true, result: { model: "gpt-4o-mini", answers: {}, usage, elapsedMs: 900, source: "live", requestBytes: 1 } });
    expect(r).toMatchObject({ status: "done", modelMs: 900, model: "gpt-4o-mini" });
    expect(r.costUsd).toBeCloseTo(0.15);
  });
  it("treats a missing key as nothing measured, not a failure", () => {
    expect(openaiActivityResult({ ok: false, reason: "not_configured" })).toEqual({ status: "done", simulated: true });
  });
  it("records a failure with its message, including when there was no outcome at all", () => {
    expect(openaiActivityResult({ ok: false, reason: "error", message: "boom" })).toEqual({ status: "error", note: "boom" });
    expect(openaiActivityResult(undefined)).toEqual({ status: "error", note: undefined });
  });
});
