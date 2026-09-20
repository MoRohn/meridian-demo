import { describe, expect, it } from "vitest";
import { describeIntegrity } from "./integrity";
import type { EvalResult } from "./types";

const base: EvalResult = {
  score: 0.8, reason: "r", success: true, threshold: 0.6, judgeModel: "m",
  rubric: { id: "risk", version: "1.0", title: "t" }, steps: [], bands: [], judgeCostUsd: null, latencyMs: 1,
  integrity: { status: "clean", signals: [], hiddenCharsRemoved: 0 },
};

describe("describeIntegrity", () => {
  it("says nothing for clean input", () => {
    expect(describeIntegrity(base)).toBeNull();
  });
  it("names what was detected and where, and tells the reader to review manually", () => {
    const msg = describeIntegrity({
      ...base,
      integrity: {
        status: "suspicious",
        hiddenCharsRemoved: 0,
        signals: [
          { field: "SOURCE TEXT", signal: "override_instructions" },
          { field: "REQUEST", signal: "dictates_score" },
        ],
      },
    })!;
    expect(msg).toContain("an instruction to ignore or override the rules in the source text");
    expect(msg).toContain("an attempt to dictate the score in the request");
    expect(msg).toContain("review this score manually");
  });
  it("falls back to the raw signal name for signals it does not know yet", () => {
    const msg = describeIntegrity({ ...base, integrity: { status: "suspicious", hiddenCharsRemoved: 0, signals: [{ field: "X", signal: "new_signal" }] } })!;
    expect(msg).toContain("new_signal in X");
  });
});
