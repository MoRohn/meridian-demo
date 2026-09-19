import { describe, expect, it } from "vitest";
import { buildRelationRequest, RELATION_QUESTIONS } from "./citationVerifier";

const AUTHORITIES: Record<string, string> = {
  "2.1": "Section 2.1: Auto-Renewal Notice. Any agreement that auto-renews must give the counterparty notice.",
  "4.2": "Section 4.2: Liability Caps. Every commercial agreement must state a liability cap for both parties.",
};

describe("buildRelationRequest", () => {
  it("reports 'missing' for a quote that never appears in the source, with zero model calls needed", () => {
    const request = buildRelationRequest(AUTHORITIES, "Some claim", "this text does not exist anywhere in the source");
    expect(request.status).toBe("missing");
  });

  it("locates a quote by exact (whitespace/case-insensitive) substring match", () => {
    const request = buildRelationRequest(
      AUTHORITIES,
      "Auto-renewing contracts need notice",
      "any agreement that   auto-renews must give the counterparty notice"
    );
    expect(request.status).toBe("found");
    if (request.status !== "missing") {
      expect(request.sectionId).toBe("2.1");
      expect(request.questions).toBe(RELATION_QUESTIONS);
      expect(request.state).toEqual({
        claim: "Auto-renewing contracts need notice",
        source_section: AUTHORITIES["2.1"],
      });
    }
  });

  it("supports a named section with no quote at all ('section-only')", () => {
    const request = buildRelationRequest(AUTHORITIES, "A claim about liability caps", null, "4.2");
    expect(request.status).toBe("section-only");
    if (request.status !== "missing") {
      expect(request.sectionId).toBe("4.2");
    }
  });

  it("reports 'missing' when a named section id doesn't exist and there's no quote", () => {
    const request = buildRelationRequest(AUTHORITIES, "A claim", null, "9.9");
    expect(request.status).toBe("missing");
  });
});
