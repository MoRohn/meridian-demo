import { describe, expect, it } from "vitest";
import { SAMPLE_CONTRACTS } from "@/lib/data/sampleContracts";
import { documentAuthorities, splitSections } from "./sections";
import { suggestCitations } from "./suggest";
import { locate } from "@/lib/skills/citationVerifier";

const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

describe("splitSections", () => {
  it("splits numbered clauses, keeping heading and body apart", () => {
    const s = splitSections(SAMPLE_CONTRACTS[0].text);
    expect(s.length).toBeGreaterThanOrEqual(5);
    expect(s[0]).toMatchObject({ id: "Doc §1", number: "1", heading: "Term and Renewal" });
    expect(s[0].body).toMatch(/^This Agreement commences/);
    expect(s[0].body).not.toContain("\n");
  });

  it("falls back to paragraphs when there is no numbering", () => {
    const text = "This letter confirms the arrangement between the parties regarding the supply of goods.\n\nPayment is due within thirty days of receipt of each invoice issued by the supplier.";
    const s = splitSections(text);
    expect(s.map((x) => x.id)).toEqual(["Doc ¶1", "Doc ¶2"]);
  });

  it("returns nothing for empty text", () => {
    expect(splitSections("")).toEqual([]);
    expect(documentAuthorities(null)).toEqual({});
  });
});

describe("suggestCitations", () => {
  it("returns nothing without a document", () => {
    expect(suggestCitations(undefined)).toEqual([]);
    expect(suggestCitations("   ")).toEqual([]);
  });

  for (const sample of SAMPLE_CONTRACTS) {
    describe(sample.name, () => {
      const suggestions = suggestCitations(sample.text);
      const authorities = documentAuthorities(sample.text);

      it("suggests several distinct topics", () => {
        expect(suggestions.length).toBeGreaterThanOrEqual(3);
        expect(new Set(suggestions.map((s) => s.topic)).size).toBe(suggestions.length);
      });

      it("quotes each clause verbatim, so the exact-text search finds it", () => {
        for (const s of suggestions) {
          expect(norm(authorities[s.id])).toContain(norm(s.quote));
          const found = locate(authorities, s.quote, s.id);
          expect(found.status, `${s.id}: ${s.quote}`).toBe("found");
          expect(found.sectionId).toBe(s.id);
        }
      });
    });
  }

  it("picks the renewal clause for the auto-renewal claim", () => {
    const s = suggestCitations(SAMPLE_CONTRACTS[0].text);
    expect(s.find((x) => x.topic === "auto_renewal")?.id).toBe("Doc §1");
  });
});
