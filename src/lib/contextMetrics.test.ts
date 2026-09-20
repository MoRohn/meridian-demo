import { describe, expect, it } from "vitest";
import { answerCallMetrics, totalTally } from "./contextMetrics";

describe("answerCallMetrics", () => {
  it("reads the reply-writing call off a model-written answer", () => {
    expect(
      answerCallMetrics({ source: "model", model: "gpt-5.1-2025-11-13", usage: { input_tokens: 3900, output_tokens: 180 }, inputBytes: 15_000 }),
    ).toEqual({ model: "gpt-5.1-2025-11-13", inputBytes: 15_000, inputTokens: 3900, outputTokens: 180 });
  });

  it("has nothing to report when no model wrote the reply", () => {
    expect(answerCallMetrics({ source: "document" })).toBeUndefined();
    expect(answerCallMetrics({ source: "template", note: "could not be reached" })).toBeUndefined();
    expect(answerCallMetrics(undefined)).toBeUndefined();
    expect(answerCallMetrics(null)).toBeUndefined();
  });
});

describe("totalTally", () => {
  const judgments = { inputBytes: 20_000, inputTokens: 4653, outputTokens: 272 };

  it("is just the judgments when there was no reply call", () => {
    expect(totalTally(judgments)).toEqual(judgments);
  });

  it("adds the reply call's input and output to the judgments", () => {
    const answer = { model: "gpt-5.1", inputBytes: 15_000, inputTokens: 3900, outputTokens: 180 };
    expect(totalTally(judgments, answer)).toEqual({ inputBytes: 35_000, inputTokens: 8553, outputTokens: 452 });
  });
});
