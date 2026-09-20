import { describe, expect, it } from "vitest";
import { typesafeRequestBytes } from "./measure";
import type { QuestionSpec } from "./types";

const question = { type: "noul", instructions: "Is this a greeting?" } as unknown as QuestionSpec;

describe("typesafeRequestBytes", () => {
  it("counts the questions as well as the state", () => {
    const state = { text: "hello" };
    const withQuestions = typesafeRequestBytes(state, { greeting: question });
    expect(withQuestions).toBeGreaterThan(typesafeRequestBytes(state, {}));
    expect(withQuestions).toBe(Buffer.byteLength(JSON.stringify({ state, questions: { greeting: question } }), "utf8"));
  });

  it("counts UTF-8 bytes, not characters", () => {
    const ascii = typesafeRequestBytes({ text: "--" }, {});
    const dashes = typesafeRequestBytes({ text: "——" }, {}); // two em dashes: 3 bytes each
    expect(dashes - ascii).toBe(4);
  });
});
