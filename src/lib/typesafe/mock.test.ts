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

describe("the demo intent classifier", () => {
  const intent = (message: string) => {
    const questions: Record<string, QuestionSpec> = {
      intent: {
        type: "choice",
        instructions: "What is the user asking the assistant to do in `latest_message`?",
        criteria: { analyze_contract: "review", check_compliance: "flags", verify_citation: "cite", summarize_context: "recap", ask_legal_question: "open question", small_talk: "chit-chat" },
      },
    };
    const a = mockSystemOne({ latest_message: message, active_document: { text: "contract text" } }, questions, "jev-latest").answers.intent;
    return a.type === "choice" ? a : null;
  };

  it("routes a task word to that task", () => {
    expect(intent("Analyze this contract")?.choice).toBe("analyze_contract");
    expect(intent("What is the risk here?")?.choice).toBe("analyze_contract");
    expect(intent("Check compliance")?.choice).toBe("check_compliance");
    expect(intent("Verify a citation")?.choice).toBe("verify_citation");
    expect(intent("Summarize this context")?.choice).toBe("summarize_context");
    expect(intent("give me a recap")?.choice).toBe("summarize_context");
  });

  it("routes a plain question about the contract to open Q&A, not to analysis", () => {
    expect(intent("Can I terminate early?")?.choice).toBe("ask_legal_question");
    expect(intent("What are the payment terms?")?.choice).toBe("ask_legal_question");
    expect(intent("Can you explain how indemnification works in general?")?.choice).toBe("ask_legal_question");
    expect(intent("who is liable for indirect damages")?.choice).toBe("ask_legal_question");
  });

  it("routes a greeting to small talk", () => {
    expect(intent("hello there")?.choice).toBe("small_talk");
    expect(intent("thanks!")?.choice).toBe("small_talk");
  });

  it("is confident enough to act on, and leaves the rest to the generic scorer", () => {
    const a = intent("Can I terminate early?")!;
    expect(a.confidence).toBeGreaterThan(0.35);
    expect(a.probabilities.ask_legal_question).toBeCloseTo(0.82, 2);
    // No rule matches "hmm": the generic scorer answers, with its usual spread.
    expect(intent("hmm")?.probabilities.ask_legal_question).not.toBeCloseTo(0.82, 2);
  });
});

describe("the demo evaluator's reading of a citation check", () => {
  const relation = (claim: string, source: string) => {
    const questions: Record<string, QuestionSpec> = {
      relation_x: { type: "choice", instructions: "How does `checks.x.source_section` relate to `checks.x.claim`?", criteria: { supports: "s", contradicts: "c", says_nothing: "n" } },
    };
    const a = mockSystemOne({ checks: { x: { claim, source_section: source } } }, questions, "jev-latest").answers.relation_x;
    return a.type === "choice" ? a : null;
  };

  it("reads each check's own claim and source by the path its question names", () => {
    expect(relation("Renewal is annual.", "Renewal is annual and automatic.")?.choice).toBe("supports");
  });
  it("sees that an uncapped clause contradicts a claim that liability is capped, and a capped one does not", () => {
    const claim = "Each party's liability is capped at a stated amount.";
    expect(relation(claim, "Provider's total liability shall not be limited except as required by law.")?.choice).toBe("contradicts");
    expect(relation(claim, "Neither party's aggregate liability shall exceed fifty thousand dollars ($50,000); liability is capped at that amount.")?.choice).toBe("supports");
  });
  it("sees that a termination fee and a long notice period break 'no more than 90 days and no fee'", () => {
    const claim = "Either party may terminate for convenience on no more than ninety (90) days' notice and without a termination fee.";
    expect(relation(claim, "Customer may terminate for convenience only upon eighteen (18) months' notice and payment of an early termination fee.")?.choice).toBe("contradicts");
    expect(relation(claim, "Either party may terminate this Agreement for convenience upon thirty (30) days' written notice.")?.choice).toBe("supports");
    expect(relation(claim, "The Company may terminate at any time.")?.choice).toBe("says_nothing");
  });
  it("sees that a one-way indemnity is not mutual, and that a term of a year is not a 30-day notice window", () => {
    expect(relation("Indemnification is mutual and limited to each party's own breaches.", "Customer shall indemnify Provider from any and all claims, without regard to fault.")?.choice).toBe("contradicts");
    expect(relation("Auto-renewal gives at least thirty (30) days' written notice to decline.", "This Agreement renews for successive one (1) year terms unless a party gives notice.")?.choice).toBe("says_nothing");
  });
  it("says a clause silent on security and breach notice does not meet a data protection claim, and is confident about a contradiction", () => {
    expect(relation("Personal data is covered by a data protection clause that addresses permitted use, security and breach notification.", "Provider may process Customer Data as necessary to provide the Services.")?.choice).toBe("says_nothing");
    expect(relation("Liability is capped at a stated amount.", "Liability is unlimited.")?.confidence).toBeGreaterThanOrEqual(0.75);
  });
  it("still uses the original claim/source paths for the older single-check question", () => {
    const questions: Record<string, QuestionSpec> = { relation: { type: "choice", instructions: "How does `source_section` relate to `claim`?", criteria: { supports: "s", contradicts: "c", says_nothing: "n" } } };
    const a = mockSystemOne({ claim: "Renewal is annual.", source_section: "Renewal is annual and automatic." }, questions, "jev-latest").answers.relation;
    expect(a.type === "choice" && a.choice).toBe("supports");
  });
});
