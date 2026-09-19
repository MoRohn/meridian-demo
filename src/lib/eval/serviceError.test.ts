import { describe, expect, it } from "vitest";
import { describeServiceError, JUDGE_FAILURE_TITLES, parseJudgeFailure } from "./serviceError";

describe("describeServiceError", () => {
  it("passes plain string details through", () => {
    expect(describeServiceError("G-Eval judge call failed: KeyError: 'reason'", "x")).toBe("G-Eval judge call failed: KeyError: 'reason'");
  });

  it("flattens FastAPI 422 arrays instead of leaking objects", () => {
    const detail = [
      { type: "missing", loc: ["body", "backend"], msg: "Field required" },
      { type: "string_too_short", loc: ["body", "actual_output"], msg: "String should have at least 1 character" },
    ];
    const msg = describeServiceError(detail, "fallback");
    expect(msg).toContain("backend: Field required");
    expect(msg).toContain("actual_output: String should have at least 1 character");
    expect(msg).not.toContain("[object Object]");
  });

  it("falls back for missing or unrecognised shapes", () => {
    expect(describeServiceError(undefined, "Eval service 500")).toBe("Eval service 500");
    expect(describeServiceError({ nope: 1 }, "fb")).toBe("fb");
    expect(describeServiceError([], "fb")).toBe("fb");
    expect(describeServiceError([null, 3], "fb")).toBe("fb");
  });
});

describe("parseJudgeFailure", () => {
  it("splits the service's stable code from the reader-facing sentence", () => {
    expect(parseJudgeFailure("G-Eval judge call failed (judge_rate_limited): The judge model is rate limited. Try again.")).toEqual({
      code: "judge_rate_limited",
      message: "The judge model is rate limited. Try again.",
    });
  });
  it("keeps multi-line messages intact", () => {
    expect(parseJudgeFailure("G-Eval judge call failed (judge_error): KeyError: 'a'\nsecond line").message).toContain("second line");
  });
  it("leaves any other message untouched with no code", () => {
    expect(parseJudgeFailure("Eval service rejected the request (backend: bad)")).toEqual({ code: null, message: "Eval service rejected the request (backend: bad)" });
  });
  it("has a title for every code the service can emit", () => {
    for (const code of ["judge_rate_limited", "judge_auth", "judge_model_unavailable", "judge_unreachable", "judge_provider_error", "judge_bad_output", "judge_bad_score"]) {
      expect(JUDGE_FAILURE_TITLES[code], code).toBeTruthy();
    }
  });
});
