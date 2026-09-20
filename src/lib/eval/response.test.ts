import { describe, expect, it } from "vitest";
import type { ActivityRecord } from "../activity/log";
import { responseFor } from "./response";

let id = 0;
const rec = (over: Partial<ActivityRecord>): ActivityRecord => ({
  id: ++id, actor: "typesafe", kind: "chat", label: "Analyze this contract", status: "done", startedAt: 0, endedAt: 1, modelMs: 1000, costUsd: 0.001, ...over,
});

describe("responseFor", () => {
  it("reads the latest finished call of that backend that produced the answer", () => {
    const log = [
      rec({ modelMs: 5000, costUsd: 0.5 }),
      rec({ modelMs: 2400, costUsd: 0.00042 }),
      rec({ actor: "openai", modelMs: 900, costUsd: 0.002 }),
    ];
    expect(responseFor(log, "risk", "risk", "typesafe")).toEqual({ ms: 2400, costUsd: 0.00042 });
    expect(responseFor(log, "compliance", "compliance", "openai")).toEqual({ ms: 900, costUsd: 0.002 });
  });

  it("uses the excerpt scan for an excerpt scope and the batched call for citations", () => {
    const log = [
      rec({ kind: "chat", modelMs: 100 }),
      rec({ kind: "excerpt", modelMs: 700, costUsd: 0.0007 }),
      rec({ kind: "citation", modelMs: 3100, costUsd: 0.003 }),
    ];
    expect(responseFor(log, "risk:excerpt", "risk", "typesafe")).toEqual({ ms: 700, costUsd: 0.0007 });
    expect(responseFor(log, "citation:ref_1", "citation", "typesafe")).toEqual({ ms: 3100, costUsd: 0.003 });
  });

  it("ignores calls that are still running, failed, simulated or unmeasured, so a figure is never invented", () => {
    const log = [
      rec({ modelMs: 111, costUsd: 0.1 }),
      rec({ status: "pending", modelMs: null }),
      rec({ status: "error", modelMs: null }),
      rec({ simulated: true, modelMs: 5, costUsd: 0 }),
      rec({ modelMs: null }),
    ];
    expect(responseFor(log, "risk", "risk", "typesafe")).toEqual({ ms: 111, costUsd: 0.1 });
    expect(responseFor([log[1], log[2], log[3], log[4]], "risk", "risk", "typesafe")).toBeNull();
    expect(responseFor([], "risk", "risk", "typesafe")).toBeNull();
  });

  it("keeps a missing cost as null rather than zero", () => {
    expect(responseFor([rec({ costUsd: undefined })], "risk", "risk", "typesafe")).toEqual({ ms: 1000, costUsd: null });
  });

  it("adds the model that wrote the reply to the findings call for an Assistant reply", () => {
    const log = [
      rec({ modelMs: 2000, costUsd: 0.001 }),
      rec({ actor: "writer", kind: "answer", label: "Answer from TypeSafe's findings", modelMs: 1500, costUsd: 0.002 }),
      rec({ actor: "writer", kind: "answer", label: "Answer from OpenAI's findings", modelMs: 9000, costUsd: 0.9 }),
    ];
    expect(responseFor(log, "reply", "reply", "typesafe")).toEqual({ ms: 3500, costUsd: 0.003 });
  });

  it("uses just the findings call for a reply nothing wrote, and does not add a writer to other kinds", () => {
    const log = [rec({ modelMs: 2000, costUsd: 0.001 })];
    expect(responseFor(log, "reply", "reply", "typesafe")).toEqual({ ms: 2000, costUsd: 0.001 });
    const withWriter = [...log, rec({ actor: "writer", kind: "answer", label: "Answer from TypeSafe's findings", modelMs: 1500, costUsd: 0.002 })];
    expect(responseFor(withWriter, "risk", "risk", "typesafe")).toEqual({ ms: 2000, costUsd: 0.001 });
  });
});
