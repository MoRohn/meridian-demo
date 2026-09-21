import { describe, expect, it } from "vitest";
import type { ActivityRecord } from "../activity/log";
import { responseFor } from "./response";

let id = 0;
const rec = (over: Partial<ActivityRecord>): ActivityRecord => ({
  id: ++id, actor: "typesafe", kind: "chat", label: "Analyze this contract", status: "done", startedAt: 0, endedAt: over.modelMs ?? 1000, modelMs: 1000, costUsd: 0.001, ...over,
});

describe("responseFor", () => {
  it("reads the latest finished call of that backend that produced the answer", () => {
    const log = [
      rec({ modelMs: 5000, costUsd: 0.5 }),
      rec({ modelMs: 2400, costUsd: 0.00042 }),
      rec({ actor: "openai", modelMs: 900, costUsd: 0.002 }),
    ];
    expect(responseFor(log, "risk", "risk", "typesafe")).toEqual({ ms: 2400, reasoningMs: 2400, writingMs: null, costUsd: 0.00042, reasoningCostUsd: 0.00042, writingCostUsd: null });
    expect(responseFor(log, "compliance", "compliance", "openai")).toMatchObject({ ms: 900, costUsd: 0.002 });
  });

  it("uses the excerpt scan for an excerpt scope and the batched call for citations", () => {
    const log = [
      rec({ kind: "chat", modelMs: 100 }),
      rec({ kind: "excerpt", modelMs: 700, costUsd: 0.0007 }),
      rec({ kind: "citation", modelMs: 3100, costUsd: 0.003 }),
    ];
    expect(responseFor(log, "risk:excerpt", "risk", "typesafe")).toMatchObject({ ms: 700, costUsd: 0.0007 });
    expect(responseFor(log, "citation:ref_1", "citation", "typesafe")).toMatchObject({ ms: 3100, costUsd: 0.003 });
  });

  it("ignores calls that are still running, failed, simulated or unmeasured, so a figure is never invented", () => {
    const log = [
      rec({ modelMs: 111, costUsd: 0.1 }),
      rec({ status: "pending", modelMs: null }),
      rec({ status: "error", modelMs: null }),
      rec({ simulated: true, modelMs: 5, costUsd: 0 }),
      rec({ modelMs: null }),
    ];
    expect(responseFor(log, "risk", "risk", "typesafe")).toMatchObject({ ms: 111, costUsd: 0.1 });
    expect(responseFor([log[1], log[2], log[3], log[4]], "risk", "risk", "typesafe")).toBeNull();
    expect(responseFor([], "risk", "risk", "typesafe")).toBeNull();
  });

  it("keeps a missing cost as null rather than zero", () => {
    expect(responseFor([rec({ costUsd: undefined })], "risk", "risk", "typesafe")).toMatchObject({ ms: 1000, costUsd: null, reasoningCostUsd: null });
  });

  it("gives the chat reply its three times and costs: total is the turn, reasoning the backend's call, LLM response the writer", () => {
    // 2.0s reasoning call, then 1.5s writing, as the chat card shows 3.5s in total.
    const log = [rec({ modelMs: 2000, endedAt: 3500, costUsd: 0.001, answerMs: 1500, answerCostUsd: 0.002 })];
    expect(responseFor(log, "reply", "reply", "typesafe")).toEqual({ ms: 3500, reasoningMs: 2000, writingMs: 1500, costUsd: 0.003, reasoningCostUsd: 0.001, writingCostUsd: 0.002 });
  });

  it("gives a reply nothing wrote no LLM response, and a total that is just its reasoning cost", () => {
    const log = [rec({ modelMs: 2000, endedAt: 2100, costUsd: 0.001 })];
    expect(responseFor(log, "reply", "reply", "typesafe")).toEqual({ ms: 2100, reasoningMs: 2000, writingMs: null, costUsd: 0.001, reasoningCostUsd: 0.001, writingCostUsd: null });
  });

  it("judges Risk and Compliance on the reasoning call alone, even when the turn also wrote a reply", () => {
    const log = [rec({ modelMs: 2000, endedAt: 9000, costUsd: 0.001, answerMs: 7000, answerCostUsd: 0.02 })];
    expect(responseFor(log, "risk", "risk", "typesafe")).toEqual({ ms: 2000, reasoningMs: 2000, writingMs: null, costUsd: 0.001, reasoningCostUsd: 0.001, writingCostUsd: null });
  });
});
