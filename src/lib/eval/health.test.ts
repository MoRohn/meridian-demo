import { describe, expect, it } from "vitest";
import { describeHealth, toEvalHealth } from "./health";
import { evalLogLine } from "./log";

const OK = { status: "ok", judge_configured: true, judge_model: "gpt-4o-mini", pass_threshold: 0.6, rubrics: { risk: "1.1" } };

describe("toEvalHealth", () => {
  it("maps a healthy service", () => {
    expect(toEvalHealth(OK)).toEqual({ status: "ready", judgeModel: "gpt-4o-mini", threshold: 0.6, rubrics: { risk: "1.1" } });
  });
  it("flags a running service whose judge key is missing", () => {
    expect(toEvalHealth({ ...OK, judge_configured: false }).status).toBe("judge_not_configured");
  });
  it.each([[null], [undefined], [{}], [{ status: "error" }], [{ status: "ok" }], ["nope"]])("treats %j as offline instead of throwing", (bad) => {
    expect(toEvalHealth(bad)).toEqual({ status: "offline" });
  });
  it("defaults the threshold when the service omits it", () => {
    expect(toEvalHealth({ ...OK, pass_threshold: undefined })).toMatchObject({ threshold: 0.6 });
  });
});

describe("describeHealth", () => {
  it("words each state for the reader", () => {
    expect(describeHealth(toEvalHealth(OK))).toEqual({ tone: "ok", text: "Judge ready · gpt-4o-mini · pass at 60%" });
    expect(describeHealth(toEvalHealth({ ...OK, judge_configured: false })).tone).toBe("warn");
    expect(describeHealth({ status: "offline" }).text).toContain("eval-service/");
  });
});

describe("evalLogLine", () => {
  const ok = { ok: true as const, result: { score: 0.8123, reason: "SECRET CONTRACT REASON", success: true, threshold: 0.6, judgeModel: "m", rubric: { id: "risk", version: "1.1", title: "t" }, steps: ["s"], integrity: { status: "suspicious" as const, signals: [], hiddenCharsRemoved: 0 }, latencyMs: 812 } };
  it("records what monitoring needs and never the judged text", () => {
    const line = evalLogLine({ kind: "risk", backend: "typesafe", outcome: ok, ms: 950 });
    expect(JSON.parse(line)).toEqual({ evt: "eval", kind: "risk", backend: "typesafe", ok: true, score: 0.81, success: true, rubric: "risk@1.1", integrity: "suspicious", judgeMs: 812, ms: 950 });
    expect(line).not.toContain("SECRET");
  });
  it("records a failure with its stable code", () => {
    const line = JSON.parse(evalLogLine({ kind: "citation", backend: "openai", outcome: { ok: false, reason: "error", code: "judge_rate_limited", message: "x" }, ms: 40 }));
    expect(line).toMatchObject({ ok: false, reason: "error", code: "judge_rate_limited", ms: 40 });
  });
});
