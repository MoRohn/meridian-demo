import { describe, expect, it } from "vitest";
import { noOpenAIAnswerReason } from "./unavailable";
import type { OpenAIRunOutcome } from "./types";

const ok: OpenAIRunOutcome = { ok: true, result: { model: "m", answers: {}, usage: { input_tokens: 1, output_tokens: 1 }, elapsedMs: 1, source: "live", requestBytes: 1 } };

describe("noOpenAIAnswerReason", () => {
  it("says nothing while the answer is still on its way", () => {
    expect(noOpenAIAnswerReason(null, "the relation")).toBeUndefined();
  });
  it("says nothing when OpenAI isn't configured, which has its own message", () => {
    expect(noOpenAIAnswerReason({ ok: false, reason: "not_configured" }, "x")).toBeUndefined();
  });
  it("explains a failed request without repeating the raw error", () => {
    const r = noOpenAIAnswerReason({ ok: false, reason: "error", message: "OpenAI 401: {\"error\": ...}" }, "x")!;
    expect(r).toContain("request failed");
    expect(r).not.toContain("401");
  });
  it("names what a successful-but-incomplete response was missing", () => {
    expect(noOpenAIAnswerReason(ok, "the relation answer")).toBe("OpenAI responded, but its answer did not include the relation answer, so there is nothing to evaluate.");
  });
});
