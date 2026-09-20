import { describe, expect, it } from "vitest";
import { SAMPLE_CONTRACTS } from "../data/sampleContracts";
import { buildExtractiveAnswer, keywords, rankClauses, splitClauses, stem } from "./extractive";
import type { AnswerAnalysis } from "./prompt";

const saas = SAMPLE_CONTRACTS[0];
const clauses = splitClauses(saas.text);
const none: AnswerAnalysis = { risk: null, flags: [], contractType: null, intent: null };
const refs = (q: string) => rankClauses(q, clauses).map((c) => c.title);

describe("splitClauses", () => {
  it("labels numbered clauses with their section and heading, skipping the title line", () => {
    expect(clauses.map((c) => `${c.ref} ${c.title}`)).toEqual([
      "Section 1 Term and Renewal", "Section 2 Fees", "Section 3 Indemnification", "Section 4 Limitation of Liability", "Section 5 Data Processing", "Section 6 Termination",
    ]);
  });
  it("labels an unnumbered paragraph by position, and drops a bare title", () => {
    const out = splitClauses("AGREEMENT\n\nThe supplier shall deliver the goods within thirty days of the order date, at its own cost.");
    expect(out).toHaveLength(1);
    expect(out[0].ref).toBe("Paragraph 2");
  });
});

describe("keywords and stems", () => {
  it("matches inflections and drops filler words", () => {
    expect(stem("terminated")).toBe(stem("terminating"));
    expect(keywords("What is the payment?")).toEqual(["fee"]);
  });
});

describe("rankClauses on the sample contract", () => {
  it("finds the clause a plain-English question is about", () => {
    expect(refs("Can I terminate early?")[0]).toBe("Termination");
    expect(refs("how does renewal work")[0]).toBe("Term and Renewal");
    expect(refs("who is liable for indirect damages")[0]).toBe("Limitation of Liability");
    expect(refs("what are the payment terms")[0]).toBe("Fees");
    expect(refs("is my personal data protected")).toContain("Data Processing");
  });
  it("returns nothing for a question with no content words, or no overlap", () => {
    expect(rankClauses("what is this?", clauses)).toEqual([]);
    expect(rankClauses("penguin migration patterns", clauses)).toEqual([]);
  });
});

describe("buildExtractiveAnswer", () => {
  const doc = { name: saas.name, text: saas.text };
  it("quotes the relevant clause with its section, and says it is not an interpretation", () => {
    const a = buildExtractiveAnswer({ message: "Can I terminate early?", document: doc, analysis: none, mode: "question" });
    expect(a).toContain("> ");
    expect(a).toContain("Section 6: Termination");
    expect(a).toContain("not an interpretation");
    expect(a).toContain("gear-icon Settings");
  });
  it("adds the app's findings when it has them", () => {
    const a = buildExtractiveAnswer({
      message: "liability?", document: doc, mode: "question",
      analysis: { ...none, risk: { overall: 0.66, band: "high", dimensions: [] }, flags: [{ label: "Auto-renewal", flagged: true }, { label: "Governing law", flagged: false }] },
    });
    expect(a).toContain("**66% overall risk** (high)");
    expect(a).toContain("trips 1 compliance flag: Auto-renewal");
  });
  it("says so honestly when nothing matches, and never invents a clause", () => {
    const a = buildExtractiveAnswer({ message: "penguin migration patterns", document: doc, analysis: none, mode: "question" });
    expect(a).toContain("couldn't find language");
    expect(a).not.toContain("> ");
  });
  it("summarizes a document by its sections", () => {
    const a = buildExtractiveAnswer({ message: "summarize", document: doc, analysis: { ...none, contractType: "SaaS agreement" }, mode: "summary" });
    expect(a).toContain("reads as a SaaS agreement");
    expect(a).toContain("- Section 4: Limitation of Liability");
  });
  it("asks for a document when there is none", () => {
    expect(buildExtractiveAnswer({ message: "hi", document: null, analysis: none, mode: "question" })).toContain("don't have a document");
  });
});
