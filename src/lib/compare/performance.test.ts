import { beforeEach, describe, expect, it } from "vitest";
import { activityLog, type ActivityFinish } from "../activity/log";
import type { StoredEvaluationRow } from "../eval/store";
import type { EvalResult } from "../eval/types";
import { bandFor, compareBackends, compareScores, describeMatchup, latencyStats, matchups, performanceVerdict, summarizeBackend, TIE_POINTS } from "./performance";

beforeEach(() => activityLog.reset());

function call(actor: "typesafe" | "openai", finish: ActivityFinish) {
  const id = activityLog.begin(actor, "chat", "x", 0);
  activityLog.finish(id, finish, 1);
}

const result = (score: number, success = score >= 0.6): EvalResult => ({
  score, reason: "r", success, threshold: 0.6, judgeModel: "m", rubric: { id: "risk", version: "1", title: "t" }, steps: [],
  bands: [{ low: 0, high: 5, outcome: "bad" }, { low: 6, high: 10, outcome: "good" }],
  integrity: { status: "clean", signals: [], hiddenCharsRemoved: 0 }, latencyMs: 1, judgeCostUsd: null,
});
const row = (scope: string, backend: "typesafe" | "openai", score: number, kind: "risk" | "reply" = "risk"): StoredEvaluationRow => ({
  scope, backend, kind, sig: "s", pending: false, auto: false, outcome: { ok: true, result: result(score) },
});

describe("latencyStats", () => {
  it("summarizes a set of call times", () => {
    const s = latencyStats([100, 200, 300, 400, 1000], 1000)!;
    expect(s).toMatchObject({ n: 5, min: 100, median: 300, mean: 400, p95: 1000, max: 1000, last: 1000 });
  });
  it("uses the mean of the middle two for an even count, and is null with no data", () => {
    expect(latencyStats([100, 300], 300)!.median).toBe(200);
    expect(latencyStats([], 0)).toBeNull();
  });
});

describe("summarizeBackend", () => {
  it("counts calls, failures, tokens and cost, and only from that backend", () => {
    call("typesafe", { status: "done", modelMs: 500, inputTokens: 100, outputTokens: 10, costUsd: 0.001 });
    call("typesafe", { status: "error" });
    call("openai", { status: "done", modelMs: 900, inputTokens: 300, outputTokens: 50, costUsd: 0.01 });
    const ts = summarizeBackend("typesafe", activityLog.list(), []);
    expect(ts).toMatchObject({ calls: 2, failures: 1, inputTokens: 100, outputTokens: 10, costUsd: 0.001 });
    expect(ts.latency?.n).toBe(1); // the failed call is not a speed sample
  });

  it("leaves a call that never reached a model (0 ms) out of the speed figures", () => {
    call("typesafe", { status: "done", modelMs: 0 });
    call("typesafe", { status: "done", modelMs: 400 });
    expect(summarizeBackend("typesafe", activityLog.list(), []).latency?.median).toBe(400);
  });

  it("averages judge scores, groups them by kind, and prices a passing answer", () => {
    call("typesafe", { status: "done", modelMs: 100, costUsd: 0.02 });
    const evals = [row("risk", "typesafe", 0.9), row("reply", "typesafe", 0.4, "reply"), row("risk", "openai", 0.1)];
    const ts = summarizeBackend("typesafe", activityLog.list(), evals);
    expect(ts.quality.evaluated).toBe(2);
    expect(ts.quality.meanScore).toBeCloseTo(0.65);
    expect(ts.quality.passRate).toBe(0.5);
    expect(ts.quality.byKind.risk).toEqual({ n: 1, meanScore: 0.9 });
    expect(ts.costPerPass).toBeCloseTo(0.02);
  });

  it("reports missing data as null, never zero", () => {
    const ts = summarizeBackend("openai", [], []);
    expect(ts.latency).toBeNull();
    expect(ts.quality.meanScore).toBeNull();
    expect(ts.costPerPass).toBeNull();
  });
});

describe("compareBackends and performanceVerdict", () => {
  function setup() {
    call("typesafe", { status: "done", modelMs: 500, costUsd: 0.001 });
    call("openai", { status: "done", modelMs: 1500, costUsd: 0.01 });
    const evals = [row("risk", "typesafe", 0.9), row("risk", "openai", 0.6)];
    const ts = summarizeBackend("typesafe", activityLog.list(), evals);
    const oa = summarizeBackend("openai", activityLog.list(), evals);
    return { ts, oa, dims: compareBackends(ts, oa) };
  }

  it("names an edge on each dimension with the numbers behind it", () => {
    const { dims } = setup();
    const by = Object.fromEntries(dims.map((d) => [d.id, d]));
    expect(by.quality.edge).toBe("typesafe");
    expect(by.quality.detail).toBe("Judge score 90% vs 60% over 1 evaluation each, 30 points apart.");
    expect(by.reliability.detail).toBe("TypeSafe failed 0 of 1 calls; OpenAI 0 of 1.");
    expect(by.speed.edge).toBe("typesafe");
    expect(by.speed.detail).toContain("3.0× faster");
    expect(by.cost.edge).toBe("typesafe");
    expect(by.reliability.edge).toBe("tie");
  });

  it("calls a small gap a tie instead of crowning a winner", () => {
    call("typesafe", { status: "done", modelMs: 1000, costUsd: 0.001 });
    call("openai", { status: "done", modelMs: 1050, costUsd: 0.001 });
    const ts = summarizeBackend("typesafe", activityLog.list(), [row("risk", "typesafe", 0.8)]);
    const oa = summarizeBackend("openai", activityLog.list(), [row("risk", "openai", 0.81)]);
    expect(compareBackends(ts, oa).map((d) => d.edge)).toEqual(["tie", "tie", "tie", "tie"]);
  });

  it("is n/a where one side has no data, and says so", () => {
    call("typesafe", { status: "done", modelMs: 500 });
    const dims = compareBackends(summarizeBackend("typesafe", activityLog.list(), []), summarizeBackend("openai", [], []));
    expect(dims.every((d) => d.edge === "n/a")).toBe(true);
    expect(performanceVerdict(dims, summarizeBackend("typesafe", [], []), summarizeBackend("openai", [], []))).toMatch(/Run the same action/);
  });

  it("writes a verdict that hedges on a small sample, and flags a quality-versus-speed trade-off", () => {
    call("typesafe", { status: "done", modelMs: 3000, costUsd: 0.001 });
    call("openai", { status: "done", modelMs: 500, costUsd: 0.001 });
    const evals = [row("risk", "typesafe", 0.95), row("risk", "openai", 0.5)];
    const ts = summarizeBackend("typesafe", activityLog.list(), evals);
    const oa = summarizeBackend("openai", activityLog.list(), evals);
    const text = performanceVerdict(compareBackends(ts, oa), ts, oa);
    expect(text).toContain("TypeSafe leads on quality");
    expect(text).toContain("OpenAI leads on speed");
    expect(text).toContain("Quality is the difference that matters");
    expect(text).toContain("Based on 1 judged answer per model");
  });
});

describe("matchups", () => {
  it("pairs the two models on the same action and picks a winner", () => {
    const m = matchups([row("risk", "typesafe", 0.9), row("risk", "openai", 0.5), row("reply", "typesafe", 0.7)]);
    expect(m).toHaveLength(1); // "reply" was only judged for one model
    expect(m[0]).toMatchObject({ scope: "risk", delta: 40, winner: "typesafe" });
    expect(describeMatchup(m[0])).toBe("TypeSafe scored 40 points higher than OpenAI (90% vs 50%), and only TypeSafe passed.");
  });

  it("calls a 2-point gap level", () => {
    const [m] = matchups([row("risk", "typesafe", 0.8), row("risk", "openai", 0.78)]);
    expect(m.winner).toBe("tie");
    expect(describeMatchup(m)).toMatch(/^Level:/);
  });

  it("ignores evaluations that failed", () => {
    const failed: StoredEvaluationRow = { ...row("risk", "openai", 0), outcome: { ok: false, reason: "error" } };
    expect(matchups([row("risk", "typesafe", 0.9), failed])).toHaveLength(0);
  });
});

describe("bandFor", () => {
  it("finds the band a score sits in", () => {
    expect(bandFor(result(0.8))).toMatchObject({ points: 8, low: 6, high: 10, outcome: "good" });
    expect(bandFor(result(0.3))?.outcome).toBe("bad");
  });
  it("is null when the service sent no bands", () => {
    expect(bandFor({ ...result(0.8), bands: [] })).toBeNull();
  });
});


describe("compareScores: head to head on whole points", () => {
  it("calls scores within 3 points level, exactly as the text says, even where the float difference is a hair over 0.03", () => {
    expect(compareScores(0.63, 0.6)).toEqual({ delta: 3, winner: "tie" });
    expect(compareScores(0.57, 0.6)).toEqual({ delta: -3, winner: "tie" });
    expect(compareScores(0.64, 0.6)).toEqual({ delta: 4, winner: "typesafe" });
    expect(compareScores(0.56, 0.6)).toEqual({ delta: -4, winner: "openai" });
  });

  it("agrees with a plain whole-point comparison for every possible pair of displayed scores", () => {
    for (let a = 0; a <= 100; a++) {
      for (let b = 0; b <= 100; b++) {
        const { delta, winner } = compareScores(a / 100, b / 100);
        expect(delta).toBe(a - b);
        expect(winner).toBe(Math.abs(a - b) <= TIE_POINTS ? "tie" : a > b ? "typesafe" : "openai");
      }
    }
  });

  it("is used by the same-action matchup, so 63% vs 60% is level and says so", () => {
    const [m] = matchups([row("risk", "typesafe", 0.63), row("risk", "openai", 0.6)]);
    expect(m.winner).toBe("tie");
    expect(describeMatchup(m)).toContain("within 3 points");
  });

  it("is the same call the quality comparison makes", () => {
    const ts = summarizeBackend("typesafe", [], [row("risk", "typesafe", 0.63)]);
    const oa = summarizeBackend("openai", [], [row("risk", "openai", 0.6)]);
    expect(compareBackends(ts, oa).find((d) => d.id === "quality")?.edge).toBe("tie");
  });
});
