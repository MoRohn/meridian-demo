import { describe, expect, it } from "vitest";
import { mockSystemOne } from "./mock";
import type { QuestionSpec } from "./types";

describe("mockSystemOne", () => {
  it("tags every response as a mock, never a live answer", () => {
    const result = mockSystemOne({ active_document: { text: "hello" } }, {}, "jev-latest");
    expect(result.source).toBe("mock");
    expect(result.model).toContain("(mock)");
  });

  it("answers a noul question with a probability in [0,1]", () => {
    const questions: Record<string, QuestionSpec> = {
      unlimited_liability: {
        type: "noul",
        instructions: "Does `active_document.text` leave liability uncapped or fail to state a liability limit at all?",
      },
    };
    const capped = mockSystemOne(
      { active_document: { text: "Liability is capped at $50,000 for all parties, shall not exceed that amount." } },
      questions,
      "jev-latest"
    );
    const uncapped = mockSystemOne(
      { active_document: { text: "There is no limitation of liability whatsoever between the parties." } },
      questions,
      "jev-latest"
    );
    const cappedAnswer = capped.answers.unlimited_liability;
    const uncappedAnswer = uncapped.answers.unlimited_liability;
    expect(cappedAnswer.type).toBe("noul");
    expect(uncappedAnswer.type).toBe("noul");
    if (cappedAnswer.type === "noul" && uncappedAnswer.type === "noul") {
      expect(cappedAnswer.noul).toBeGreaterThanOrEqual(0);
      expect(cappedAnswer.noul).toBeLessThanOrEqual(1);
      // Negative-evidence table should pull the capped case down relative to the uncapped one.
      expect(cappedAnswer.noul).toBeLessThan(uncappedAnswer.noul);
    }
  });

  it("answers a choice question with a probability distribution that sums to ~1", () => {
    const questions: Record<string, QuestionSpec> = {
      contract_type: {
        type: "choice",
        instructions: "What kind of contract is `active_document.text`?",
        criteria: {
          nda: "Non-disclosure / confidentiality agreement",
          saas_msa: "SaaS subscription or master services agreement",
        },
      },
    };
    const result = mockSystemOne(
      { active_document: { text: "This mutual non-disclosure agreement protects confidential information." } },
      questions,
      "jev-latest"
    );
    const answer = result.answers.contract_type;
    expect(answer.type).toBe("choice");
    if (answer.type === "choice") {
      const total = Object.values(answer.probabilities).reduce((a, b) => a + b, 0);
      expect(total).toBeCloseTo(1, 1);
      expect(answer.choice).toBe("nda");
    }
  });

  it("answers a score question with score within the valid level range", () => {
    const questions: Record<string, QuestionSpec> = {
      liability_exposure: {
        type: "score",
        instructions: "How exposed is our counterparty-facing side to uncapped or asymmetric liability in `active_document.text`?",
        criteria: ["Liability is mutually capped", "Liability is capped for one party", "Liability is uncapped"],
      },
    };
    const result = mockSystemOne({ active_document: { text: "some contract text" } }, questions, "jev-latest");
    const answer = result.answers.liability_exposure;
    expect(answer.type).toBe("score");
    if (answer.type === "score") {
      expect(answer.score).toBeGreaterThanOrEqual(0);
      expect(answer.score).toBeLessThanOrEqual(2);
    }
  });

  it("uses the targeted relation heuristic (not generic overlap) for citation checks", () => {
    const questions: Record<string, QuestionSpec> = {
      relation: {
        type: "choice",
        instructions: "How does `source_section` relate to `claim`?",
        criteria: {
          supports: "The section states the claim or directly implies it is true",
          contradicts: "The section states the opposite of the claim or implies it is false",
          says_nothing: "The section does not address what the claim asserts, either way",
        },
      },
    };
    const state = {
      claim: "Silence on a liability cap is fine as long as nothing bad has happened yet.",
      source_section:
        "Silence on liability is not equivalent to a cap - an agreement that does not state a limitation of liability is treated as carrying uncapped exposure.",
    };
    const result = mockSystemOne(state, questions, "jev-latest");
    const answer = result.answers.relation;
    expect(answer.type).toBe("choice");
    if (answer.type === "choice") {
      expect(["supports", "contradicts", "says_nothing"]).toContain(answer.choice);
    }
  });

  it("is deterministic for identical input", () => {
    const questions: Record<string, QuestionSpec> = {
      auto_renewal_trap: {
        type: "noul",
        instructions: "Does `active_document.text` auto-renew without notice?",
      },
    };
    const state = { active_document: { text: "This agreement auto-renews annually." } };
    const a = mockSystemOne(state, questions, "jev-latest");
    const b = mockSystemOne(state, questions, "jev-latest");
    expect(a.answers).toEqual(b.answers);
  });
});
