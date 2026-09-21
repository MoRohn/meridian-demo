import { describe, expect, it } from "vitest";
import { describeTiming, finishRanks, ordinal } from "./order";

describe("finishRanks", () => {
  it("ranks the two backends' replies to one question in the order they arrived", () => {
    const ranks = finishRanks([{}, { backend: "openai", turn: 1 }, { backend: "typesafe", turn: 1 }]);
    expect(ranks).toEqual([null, 1, 2]);
  });

  it("ranks each question on its own", () => {
    const ranks = finishRanks([
      { backend: "typesafe", turn: 1 },
      { backend: "openai", turn: 1 },
      { backend: "openai", turn: 2 },
      { backend: "typesafe", turn: 2 },
    ]);
    expect(ranks).toEqual([1, 2, 1, 2]);
  });

  it("gives no rank when only one backend answered the question", () => {
    expect(finishRanks([{ backend: "typesafe", turn: 1 }])).toEqual([null]);
  });

  it("does not rank a failure, nor let it take first place", () => {
    const ranks = finishRanks([
      { backend: "openai", turn: 1, failed: true },
      { backend: "typesafe", turn: 1 },
    ]);
    expect(ranks).toEqual([null, 1]);
  });
});

describe("ordinal", () => {
  it("spells the first few places and the teens", () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21].map(ordinal)).toEqual(["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st"]);
  });
});

describe("describeTiming", () => {
  const fmt = (ms: number) => `${ms}ms`;
  it("names the model reasoning and the LLM response that make up a turn's time", () => {
    expect(describeTiming("typesafe", { modelMs: 766, answerMs: 12200 }, fmt)).toBe("766ms model reasoning · 12200ms LLM response");
  });
  it("leaves out a part that did not happen, and says nothing when neither did", () => {
    expect(describeTiming("openai", { modelMs: 5000 }, fmt)).toBe("5000ms model reasoning");
    expect(describeTiming("openai", {}, fmt)).toBeNull();
  });
});
