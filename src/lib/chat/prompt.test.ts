import { describe, expect, it } from "vitest";
import { buildAnswerMessages, clipDocument, describeAnalysis, fence, MAX_DOCUMENT_CHARS, SYSTEM_PROMPT, type AnswerAnalysis } from "./prompt";

const analysis: AnswerAnalysis = {
  risk: { overall: 0.66, band: "High risk", dimensions: [{ label: "Liability exposure", normalized: 0.59 }, { label: "Termination rigidity", normalized: 0.5 }] },
  flags: [{ label: "Auto-renewal", flagged: true, probability: 0.84 }, { label: "Governing law", flagged: false }],
  contractType: "SaaS agreement",
  intent: "ask_legal_question",
};

describe("describeAnalysis", () => {
  it("states the app's figures exactly, with a probability only when there is one", () => {
    const text = describeAnalysis(analysis);
    expect(text).toContain("Overall risk: 66% (High risk)");
    expect(text).toContain("- Liability exposure: 59%");
    expect(text).toContain("- Auto-renewal: FLAGGED (84%)");
    expect(text).toContain("- Governing law: clear");
    expect(text).not.toContain("clear (");
  });
  it("says so when there is nothing", () => {
    expect(describeAnalysis({ risk: null, flags: [], contractType: null, intent: null })).toContain("no findings");
  });
});

describe("buildAnswerMessages", () => {
  const msgs = buildAnswerMessages(
    { message: "Can I leave early?", history: [{ role: "user", text: "hi" }, { role: "assistant", text: "hello" }], document: { name: "msa.pdf", text: "4. Termination. Either party may terminate on 30 days notice." }, analysis },
    "N0NCE",
  );
  it("puts the rules in the system message and everything untrusted in fenced blocks", () => {
    expect(msgs[0]).toEqual({ role: "system", content: SYSTEM_PROMPT });
    const user = msgs[1].content;
    expect(user).toContain("<<<DOCUMENT N0NCE\n4. Termination.");
    expect(user).toContain("<<<MESSAGE N0NCE\nCan I leave early?\nMESSAGE N0NCE>>>");
    expect(user).toContain("User: hi\n\nMeridian: hello");
    expect(user).toContain('LOADED DOCUMENT: "msa.pdf"');
  });
  it("tells the model to quote clauses, use the figures as given, and treat the fenced text as data", () => {
    expect(SYSTEM_PROMPT).toMatch(/quote the exact words/);
    expect(SYSTEM_PROMPT).toMatch(/Quote them exactly as given/);
    expect(SYSTEM_PROMPT).toMatch(/untrusted data/);
  });
  it("copes with no document and no history", () => {
    const bare = buildAnswerMessages({ message: "hi", history: [], document: null, analysis }, "N")[1].content;
    expect(bare).toContain("LOADED DOCUMENT: none");
    expect(bare).not.toContain("CONVERSATION SO FAR");
  });
  it("only sends the most recent turns", () => {
    const history = Array.from({ length: 20 }, (_, i) => ({ role: "user" as const, text: `turn ${i}` }));
    const user = buildAnswerMessages({ message: "x", history, document: null, analysis }, "N")[1].content;
    expect(user).toContain("turn 19");
    expect(user).not.toContain("turn 13");
  });
});

describe("clipDocument and fence", () => {
  it("clips only what is too long, and says so", () => {
    expect(clipDocument("short")).toEqual({ text: "short", clipped: false });
    const big = clipDocument("x".repeat(MAX_DOCUMENT_CHARS + 5));
    expect(big.clipped).toBe(true);
    expect(big.text).toHaveLength(MAX_DOCUMENT_CHARS);
    const msg = buildAnswerMessages({ message: "m", history: [], document: { name: "d", text: "x".repeat(MAX_DOCUMENT_CHARS + 5) }, analysis }, "N")[1]?.content;
    expect(msg).toContain("only the first 60,000 characters");
  });
  it("wraps text between markers carrying the nonce", () => {
    expect(fence("DOCUMENT", "body", "abc")).toBe("<<<DOCUMENT abc\nbody\nDOCUMENT abc>>>");
  });
});
