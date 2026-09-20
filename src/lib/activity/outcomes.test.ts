import { describe, expect, it } from "vitest";
import { describeAnswer, openaiActivityResult, typesafeActivityResult, writerActivityResult } from "./outcomes";

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

describe("writerActivityResult", () => {
  it("records a model-written answer with its own time, tokens and cost", () => {
    expect(writerActivityResult({ source: "model", model: "gpt-4o", usage: { input_tokens: 900, output_tokens: 120 }, elapsedMs: 4100, costUsd: 0.0031 })).toEqual({
      status: "done", modelMs: 4100, model: "gpt-4o", inputTokens: 900, outputTokens: 120, costUsd: 0.0031,
    });
  });
  it("records nothing when no model wrote the reply, so no phantom call appears", () => {
    expect(writerActivityResult({ source: "document" })).toBeNull();
    expect(writerActivityResult({ source: "template" })).toBeNull();
    expect(writerActivityResult(undefined)).toBeNull();
  });
});

describe("describeAnswer", () => {
  it("names the model and the findings a written answer came from", () => {
    expect(describeAnswer({ source: "model", model: "gpt-4o" }, "TypeSafe")).toEqual({ via: "Written by gpt-4o from the document and TypeSafe's findings", note: null });
  });
  it("is honest that quoted text is not a model's answer, and passes a failure note through", () => {
    expect(describeAnswer({ source: "document", note: "The answer model could not be reached (OpenAI 401)." }, "TypeSafe")).toEqual({
      via: "Quoted from the document. No answer model was used.", note: "The answer model could not be reached (OpenAI 401).",
    });
  });
  it("says nothing extra about Meridian's own templates", () => {
    expect(describeAnswer({ source: "template" }, "TypeSafe")).toEqual({ via: null, note: null });
    expect(describeAnswer(undefined, "TypeSafe")).toEqual({ via: null, note: null });
  });
});
