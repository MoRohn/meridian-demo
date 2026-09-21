import { describe, expect, it } from "vitest";
import { guidesForTab } from "./guide";
import { RISK_DIMENSIONS } from "../skills/clauseRisk";
import { COMPLIANCE_CHECKS } from "../skills/complianceGuard";
import { TOPICS } from "../citations/topics";
import { GUARDRAIL_TRIGGER } from "../orchestrator/compose";

const items = (id: string, tab: "trace" | "risk" | "compliance" | "citation" = "trace") => guidesForTab(tab).find((g) => g.id === id)!.groups.flatMap((g) => g.items);

describe("guidesForTab", () => {
  it("gives each page its own rules, Compliance its screening too, and Trace all of them", () => {
    expect(guidesForTab("risk").map((g) => g.id)).toEqual(["risk"]);
    expect(guidesForTab("compliance").map((g) => g.id)).toEqual(["compliance", "guardrails"]);
    expect(guidesForTab("citation").map((g) => g.id)).toEqual(["citation"]);
    expect(guidesForTab("trace").map((g) => g.id)).toEqual(["risk", "compliance", "citation", "guardrails"]);
  });

  it("lists every risk dimension with the weight the code uses, and the weights add up to 100%", () => {
    const dims = items("risk").filter((i) => i.levels?.length === 3 && i.chips?.[0]?.startsWith("Weight"));
    expect(dims.map((d) => d.title)).toEqual(Object.values(RISK_DIMENSIONS).map((d) => d.label));
    const weights = dims.map((d) => parseInt(d.chips![0].replace(/\D/g, ""), 10));
    expect(weights).toEqual(Object.values(RISK_DIMENSIONS).map((d) => Math.round(d.weight * 100)));
    expect(weights.reduce((a, b) => a + b, 0)).toBe(100);
  });

  it("lists every compliance check with its own definition", () => {
    expect(items("compliance").map((i) => [i.title, i.text])).toEqual(Object.values(COMPLIANCE_CHECKS).map((c) => [c.label, c.definition]));
  });

  it("covers what is screened, at the trigger the composer uses", () => {
    const g = items("guardrails");
    expect(g.map((i) => i.title)).toEqual(["Privileged or confidential content", "Prompt-injection attempt"]);
    expect(g.every((i) => i.chips?.[0] === `Blocks at ${Math.round(GUARDRAIL_TRIGGER * 100)}%`)).toBe(true);
    expect(g.every((i) => i.levels?.some((l) => l.label === "Then"))).toBe(true);
  });

  it("explains how citations are found and judged, listing every key term the extractor looks for", () => {
    const c = guidesForTab("citation")[0];
    expect(c.groups.map((g) => g.heading)).toEqual(["What is found", "What each check is held to", "Who decides", "Verdicts"]);
    const held = c.groups[1].items.map((i) => i.title);
    expect(held).toEqual(TOPICS.map((t) => t.label));
    expect(c.groups[3].items.map((i) => i.title)).toEqual(["Verified", "Contradicted", "Unsupported", "Fabricated"]);
  });
});
