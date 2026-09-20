import { describe, expect, it } from "vitest";
import { SAMPLE_CONTRACTS } from "../data/sampleContracts";
import { extractChecks, sectionLabel } from "./extract";
import { durations, jurisdiction, money } from "./topics";

const [saas, nda, employment] = SAMPLE_CONTRACTS;
const run = (text: string, scope: "document" | "excerpt" = "document", fullText?: string) => extractChecks({ text, scope, fullText });
const byId = (e: ReturnType<typeof run>, id: string) => e.checks.find((c) => c.id === id);
const summary = (e: ReturnType<typeof run>) => e.checks.map((c) => `${c.id}:${c.resolution}`);

describe("figures pulled from a clause", () => {
  it("reads durations however they are written", () => {
    expect(durations("within thirty (30) days of invoice")).toEqual(["30 days"]);
    expect(durations("upon eighteen (18) months' prior written notice")).toEqual(["18 months"]);
    expect(durations("successive one-year terms, and for two (2) years")).toEqual(["2 years", "1 year"]);
    expect(durations("twelve months and 1 year")).toEqual(["1 year", "12 months"]);
    expect(durations("no numbers here")).toEqual([]);
  });
  it("reads amounts and the governing jurisdiction", () => {
    expect(money("shall not exceed fifty thousand dollars ($50,000); or $1,200.50")).toEqual(["$50,000", "$1,200.50"]);
    expect(jurisdiction("governed by the laws of the State of Delaware, without regard")).toEqual(["Delaware"]);
    expect(jurisdiction("governed by the laws of New York.")).toEqual(["New York"]);
    expect(jurisdiction("no governing clause")).toEqual([]);
  });
});

describe("key terms in the sample contracts", () => {
  it("finds the clause for each term in the vendor-drafted SaaS agreement, quoting it and pulling out what matters", () => {
    const e = run(saas.text);
    expect(e.sections).toBe(6);
    expect(summary(e)).toEqual([
      "term_auto_renewal:model", "term_indemnification:model", "term_liability:model", "term_data_protection:model", "term_termination:model", "term_governing_law:missing", "term_payment:model",
    ]);
    expect(byId(e, "term_liability")).toMatchObject({ where: "§4 Limitation of Liability", origin: "Playbook §4.2", facts: ["no cap"], sourceId: "Doc §4" });
    expect(byId(e, "term_indemnification")?.facts).toEqual(["one-way", "regardless of fault"]);
    expect(byId(e, "term_termination")?.facts).toEqual(["for convenience", "termination fee", "18 months"]);
    expect(byId(e, "term_auto_renewal")?.facts).toEqual(["auto-renews", "1 year"]);
    expect(byId(e, "term_liability")?.quote).toContain("shall not be limited");
  });

  it("reports an essential term the document lacks as missing, by rule, with no model involved", () => {
    const missing = byId(run(saas.text), "term_governing_law")!;
    expect(missing).toMatchObject({ resolution: "missing", source: null, quote: null, where: null });
    expect(missing.note).toMatch(/No clause/);
    expect(summary(run(employment.text))).toContain("term_liability:missing");
  });

  it("does not ask about auto-renewal in a contract that says it does not renew", () => {
    expect(byId(run(nda.text), "term_auto_renewal")).toBeUndefined();
  });

  it("reads the balanced NDA as balanced: mutual indemnity, a capped liability with its figure, and the governing law", () => {
    const e = run(nda.text);
    expect(byId(e, "term_indemnification")?.facts).toEqual(["mutual"]);
    expect(byId(e, "term_liability")?.facts).toEqual(["capped", "$50,000"]);
    expect(byId(e, "term_governing_law")).toMatchObject({ resolution: "model", facts: ["Delaware"] });
  });

  it("checks confidentiality against the clause that says how long it lasts, not just the one that names it", () => {
    const c = byId(run(nda.text), "term_confidentiality")!;
    expect(c.where).toBe("§3 Term");
    expect(c.facts).toContain("survives termination");
    expect(c.facts).toContain("3 years");
  });

  it("flags a worldwide restriction and a one-way indemnity in the employment agreement", () => {
    const e = run(employment.text);
    expect(byId(e, "term_restrictive_covenant")?.facts).toEqual(["worldwide", "24 months"]);
    expect(byId(e, "term_indemnification")?.facts).toEqual(["one-way"]);
    expect(byId(e, "term_termination")?.facts).toEqual(["at any time"]);
  });

  it("does not ask an employment contract when its salary is due after invoice", () => {
    expect(byId(run(employment.text), "term_payment")).toBeUndefined();
  });

  it("gives every model check the text a model will judge and a claim to judge it against, and none of the rest", () => {
    for (const s of SAMPLE_CONTRACTS) {
      for (const c of run(s.text).checks) {
        if (c.resolution === "model") expect(c.source && c.claim && c.sourceId).toBeTruthy();
        else expect(c.source).toBeNull();
      }
    }
  });

  it("uses only the playbook's own sections as its origin, or says it is a standard term", () => {
    const origins = new Set(SAMPLE_CONTRACTS.flatMap((s) => run(s.text).checks.filter((c) => c.kind === "term").map((c) => c.origin)));
    for (const o of origins) expect(o).toMatch(/^(Playbook §\d\.\d|Standard term)$/);
  });
});

describe("text that is not a contract", () => {
  const letter = "Hello.\n\nThis short letter confirms our meeting yesterday and thanks you for your time today, nothing more than that at all.";

  it("is not accused of lacking a governing law, a liability cap and a termination clause", () => {
    expect(run(letter).checks).toEqual([]);
  });

  it("is still read for references, and for any term it happens to cover", () => {
    const e = run("Thank you for the call.\n\nAs discussed, our fees are payable within thirty (30) days of invoice, and see Exhibit B for the rates.");
    expect(e.checks.map((c) => c.id)).toEqual(["ref_1", "term_payment"]);
    expect(e.checks.some((c) => c.resolution === "missing")).toBe(false);
  });

  it("does report a missing essential term in something that reads as a contract, even a short one", () => {
    const short = "1. Services. The Supplier shall deliver the goods and the Customer shall accept them.\n\n2. Price. The Customer shall pay the fees due within thirty (30) days of invoice.";
    expect(run(short).checks.filter((c) => c.resolution === "missing").map((c) => c.id)).toEqual(["term_liability", "term_termination", "term_governing_law"]);
  });
});

describe("references written in the text", () => {
  it("finds the cross-reference in the employment agreement and checks the section it points to", () => {
    const [ref] = run(employment.text).checks.filter((c) => c.kind === "reference");
    expect(ref).toMatchObject({ id: "ref_1", resolution: "model", title: "Cites §4 Restrictive Covenants", origin: "Cross-reference", where: "§5 Termination", sourceId: "Doc §4" });
    expect(ref.claim).toContain("outstanding obligations under Section 4");
    expect(ref.source).toContain("Restrictive Covenants");
    expect(ref.question).toBe("Does §4 Restrictive Covenants say what this sentence relies on?");
  });

  it("finds no references in a contract that makes none, and says nothing about them", () => {
    for (const s of [saas, nda]) expect(run(s.text).checks.filter((c) => c.kind === "reference")).toEqual([]);
  });

  it("calls a reference to a section that does not exist broken, by rule", () => {
    const e = run("1. Scope. The services are described in Section 9.\n\n2. Fees. Fees are due in thirty (30) days.");
    const ref = e.checks.find((c) => c.kind === "reference")!;
    expect(ref).toMatchObject({ resolution: "broken", title: "Cites Section 9", source: null });
    expect(ref.note).toBe("Section 9 does not exist in this document.");
  });

  it("does not treat a legal citation's numbers as sections of the document", () => {
    const e = run("1. Data. Vendor shall comply with GDPR Article 28 and 15 U.S.C. § 1681.\n\n2. Fees. Due in thirty (30) days.");
    const refs = e.checks.filter((c) => c.kind === "reference");
    expect(refs.map((r) => `${r.title}:${r.resolution}`)).toEqual(["15 U.S.C. § 1681:external", "GDPR Article 28:external"]);
    expect(refs.every((r) => r.origin === "Legal citation" && r.source === null)).toBe(true);
  });

  it("names an attachment as one that is not part of the text", () => {
    const ref = run("1. Scope. The work is set out in Exhibit A.\n\n2. Fees. Due in thirty (30) days.").checks.find((c) => c.origin === "Attachment")!;
    expect(ref).toMatchObject({ title: "Exhibit A", resolution: "external" });
    expect(ref.note).toMatch(/not part of this text/);
  });

  it("reads a list of sections as one reference each, and skips a clause that names itself", () => {
    const e = run("1. Fees. Fees are due.\n\n2. Scope. See Sections 1 and 3, and Section 2.\n\n3. Renewal. Renewal is annual.");
    expect(e.checks.filter((c) => c.kind === "reference").map((c) => c.title)).toEqual(["Cites \u00a71 Fees", "Cites \u00a73 Renewal"]);
  });

  it("resolves 4.2 to clause 4 when clauses are not split further", () => {
    const ref = run("4. Term. Renewal is annual.\n\n5. Notice. As stated in Section 4.2 above.").checks.find((c) => c.kind === "reference")!;
    expect(ref).toMatchObject({ resolution: "model", sourceId: "Doc §4" });
  });

  it("says a reference cannot be resolved in a text with no numbered sections, rather than calling it broken", () => {
    const e = run("This letter follows Section 4 of our earlier agreement and continues for the same term as before, in full.\n\nWe remain grateful for the ongoing relationship over these many years of working together.");
    const ref = e.checks.find((c) => c.kind === "reference")!;
    expect(ref.resolution).toBe("external");
    expect(ref.note).toMatch(/no numbered sections/);
  });

  it("caps how many references one document can raise", () => {
    const many = Array.from({ length: 30 }, (_, i) => `${i + 1}. S${i}. See Section ${i + 40}.`).join("\n\n");
    expect(run(many).checks.filter((c) => c.kind === "reference")).toHaveLength(12);
  });
});

describe("a highlighted passage", () => {
  const passage = "Provider's total liability arising out of this Agreement shall not be limited except as required by applicable law.";

  it("is checked on its own: the term it covers, and nothing else, with no missing findings for what it does not mention", () => {
    const e = run(passage, "excerpt", saas.text);
    expect(summary(e)).toEqual(["term_liability:model"]);
    expect(byId(e, "term_liability")?.where).toBe("Selected passage");
  });

  it("resolves a reference inside the passage against the whole document", () => {
    const e = run("Upon termination, all outstanding obligations under Section 4 continue to apply in full force.", "excerpt", employment.text);
    const ref = e.checks.find((c) => c.kind === "reference")!;
    expect(ref).toMatchObject({ resolution: "model", sourceId: "Doc §4" });
    const broken = run("See Section 9 for details of the payment.", "excerpt", employment.text).checks.find((c) => c.kind === "reference")!;
    expect(broken.resolution).toBe("broken");
  });

  it("has nothing to check in a passage too short to mean anything", () => {
    expect(run("Yes.", "excerpt", saas.text).checks).toEqual([]);
    expect(run("   ", "excerpt", saas.text).checks).toEqual([]);
  });
});

describe("sectionLabel and empty input", () => {
  it("labels a clause the way a reader would say it", () => {
    expect(sectionLabel({ id: "Doc §4", heading: "Limitation of Liability" })).toBe("§4 Limitation of Liability");
    expect(sectionLabel({ id: "Selection", heading: "Selected passage" })).toBe("Selected passage");
  });
  it("returns nothing for no text", () => {
    expect(run("")).toEqual({ scope: "document", checks: [], sections: 0 });
  });
});
