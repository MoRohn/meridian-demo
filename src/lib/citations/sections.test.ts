import { describe, expect, it } from "vitest";
import { SAMPLE_CONTRACTS } from "../data/sampleContracts";
import { splitSections } from "./sections";

describe("splitSections", () => {
  it("splits each sample contract into its numbered clauses, with headings", () => {
    expect(splitSections(SAMPLE_CONTRACTS[0].text).map((s) => `${s.id} ${s.heading}`)).toEqual([
      "Doc §1 Term and Renewal", "Doc §2 Fees", "Doc §3 Indemnification", "Doc §4 Limitation of Liability", "Doc §5 Data Processing", "Doc §6 Termination",
    ]);
    expect(splitSections(SAMPLE_CONTRACTS[1].text)).toHaveLength(7);
    expect(splitSections(SAMPLE_CONTRACTS[2].text)).toHaveLength(5);
  });

  it("keeps each clause's whole text, so a claim is judged against everything the clause says", () => {
    const liability = splitSections(SAMPLE_CONTRACTS[0].text)[3];
    expect(liability.text).toContain("shall not be limited");
    expect(liability.body).not.toContain("Limitation of Liability.");
  });

  it("falls back to paragraphs when the text has no numbering", () => {
    const [p1, p2] = splitSections("This letter confirms the terms we discussed, including the fee and the term of the engagement.\n\nWe look forward to working together on this project over the coming year and beyond.");
    expect([p1.id, p2.id]).toEqual(["Doc ¶1", "Doc ¶2"]);
  });

  it("returns nothing for empty text", () => {
    expect(splitSections("")).toEqual([]);
  });
});
