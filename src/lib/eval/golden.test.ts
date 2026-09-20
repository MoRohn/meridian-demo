import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { goldenCases } from "./goldenCases";
import { goldenDefinitions, syntheticCases, type SyntheticSource } from "./syntheticCases";

const GOLDEN_DIR = join(__dirname, "../../../eval-service/golden");
const FIXTURE = join(GOLDEN_DIR, "cases.json");
const DEFINITIONS = join(GOLDEN_DIR, "definitions.json");
const SOURCES = join(GOLDEN_DIR, "synthetic_sources.json");

describe("golden judge cases", () => {
  const sources: SyntheticSource[] = JSON.parse(readFileSync(SOURCES, "utf8"));
  const cases = [...goldenCases(), ...syntheticCases(sources)];

  it("keeps eval-service/golden/cases.json in sync with the packet builders", () => {
    const fresh = JSON.stringify(cases, null, 2) + "\n";
    if (process.env.UPDATE_GOLDEN) writeFileSync(FIXTURE, fresh);
    expect(readFileSync(FIXTURE, "utf8")).toBe(fresh);
  });

  it("keeps eval-service/golden/definitions.json in sync with the app's risk levels and compliance checks", () => {
    const fresh = JSON.stringify(goldenDefinitions(), null, 2) + "\n";
    if (process.env.UPDATE_GOLDEN) writeFileSync(DEFINITIONS, fresh);
    expect(readFileSync(DEFINITIONS, "utf8")).toBe(fresh);
  });

  it("has unique ids and a balanced mix of pass, fail and injection cases", () => {
    expect(new Set(cases.map((c) => c.id)).size).toBe(cases.length);
    expect(cases.filter((c) => c.expected === "pass").length).toBeGreaterThanOrEqual(8);
    expect(cases.filter((c) => c.expected === "fail").length).toBeGreaterThanOrEqual(8);
    expect(cases.filter((c) => c.injection).length).toBeGreaterThanOrEqual(3);
    expect(cases.every((c) => !c.injection || c.expected === "fail")).toBe(true);
  });

  it("covers every judged kind with both a passing and a failing case", () => {
    for (const kind of ["risk", "compliance", "citation", "reply"]) {
      const of = cases.filter((c) => c.request.kind === kind);
      expect(of.some((c) => c.expected === "pass"), kind).toBe(true);
      expect(of.some((c) => c.expected === "fail"), kind).toBe(true);
    }
  });
});
