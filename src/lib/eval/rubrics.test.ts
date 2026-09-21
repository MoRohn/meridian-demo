import { describe, expect, it } from "vitest";
import { RUBRIC_ORDER, parseRubrics, rubricsForTab } from "./rubrics";

const wire = (over: Record<string, unknown> = {}) => ({
  id: "risk",
  version: "1.2",
  title: "Contract risk score",
  task_line: "Judge a contract risk assessment.",
  steps: ["Read the SOURCE TEXT.", "Score it."],
  outline: [{ label: "Read", summary: "Read the source." }, { label: "Score", summary: "Score it." }],
  bands: [{ low: 0, high: 5, outcome: "bad" }, { low: 6, high: 10, outcome: "good" }],
  pass_threshold: 0.6,
  ...over,
});

describe("parseRubrics", () => {
  it("reads each rubric as the service sends it, in the fixed display order", () => {
    const parsed = parseRubrics({ reply: wire({ id: "reply", title: "Assistant reply" }), risk: wire() })!;
    expect(parsed.map((r) => r.id)).toEqual(["risk", "reply"]);
    expect(parsed[0]).toEqual({
      id: "risk", version: "1.2", title: "Contract risk score", taskLine: "Judge a contract risk assessment.",
      steps: ["Read the SOURCE TEXT.", "Score it."], outline: [{ label: "Read", summary: "Read the source." }, { label: "Score", summary: "Score it." }], bands: [{ low: 0, high: 5, outcome: "bad" }, { low: 6, high: 10, outcome: "good" }], passThreshold: 0.6,
    });
  });

  it("skips a malformed rubric instead of failing the rest, and drops bad steps and bands", () => {
    const parsed = parseRubrics({
      risk: wire({ steps: ["ok", "", 5, null], bands: [{ low: 0, high: 5, outcome: "ok" }, { low: "x" }, null] }),
      compliance: wire({ steps: [] }),
      citation: { version: 3 },
    })!;
    expect(parsed).toHaveLength(1);
    expect(parsed[0].steps).toEqual(["ok"]);
    expect(parsed[0].bands).toEqual([{ low: 0, high: 5, outcome: "ok" }]);
  });

  it("ignores an outline that does not line up with the steps, so no step is given another step's label", () => {
    expect(parseRubrics({ risk: wire({ outline: [{ label: "Only one", summary: "x" }] }) })![0].outline).toEqual([]);
    expect(parseRubrics({ risk: wire({ outline: undefined }) })![0].outline).toEqual([]);
    expect(parseRubrics({ risk: wire({ outline: [{ label: "a", summary: "b" }, { label: 5 }] }) })![0].outline).toEqual([]);
  });

  it("falls back to the 60% pass mark and an empty task line when the service omits them", () => {
    const parsed = parseRubrics({ risk: wire({ pass_threshold: undefined, task_line: undefined }) })!;
    expect(parsed[0].passThreshold).toBe(0.6);
    expect(parsed[0].taskLine).toBe("");
  });

  it("is null when nothing usable came back", () => {
    for (const bad of [null, undefined, "x", 5, [], {}, { risk: "nope" }]) expect(parseRubrics(bad)).toBeNull();
  });
});

describe("rubricsForTab", () => {
  it("gives each analysis tab its own rubric and Trace all of them", () => {
    expect(rubricsForTab("risk")).toEqual(["risk"]);
    expect(rubricsForTab("compliance")).toEqual(["compliance"]);
    expect(rubricsForTab("citation")).toEqual(["citation"]);
    expect(rubricsForTab("trace")).toEqual(RUBRIC_ORDER);
    expect(RUBRIC_ORDER).toEqual(["risk", "compliance", "citation", "reply"]);
  });
});
