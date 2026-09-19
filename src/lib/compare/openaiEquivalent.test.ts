import { describe, expect, it } from "vitest";
import { buildFunctionCallingSchema, matchReferencePrice } from "./openaiEquivalent";
import type { QuestionSpec } from "../typesafe/types";

describe("buildFunctionCallingSchema", () => {
  it("adds a self-reported *_confidence field alongside every question", () => {
    const questions: Record<string, QuestionSpec> = {
      is_urgent: { type: "noul", instructions: "Is this urgent?" },
    };
    const schema = buildFunctionCallingSchema(questions);
    expect(schema.parameters.required).toEqual(["is_urgent", "is_urgent_confidence"]);
    expect(schema.parameters.properties).toHaveProperty("is_urgent_confidence");
  });

  it("translates a Choice question into a string enum", () => {
    const questions: Record<string, QuestionSpec> = {
      contract_type: {
        type: "choice",
        instructions: "What kind of contract is this?",
        criteria: { nda: "confidentiality agreement", saas_msa: "SaaS agreement" },
      },
    };
    const schema = buildFunctionCallingSchema(questions);
    const prop = schema.parameters.properties.contract_type as { type: string; enum: string[] };
    expect(prop.type).toBe("string");
    expect(prop.enum).toEqual(["nda", "saas_msa"]);
  });

  it("translates a Score question into a bounded integer", () => {
    const questions: Record<string, QuestionSpec> = {
      liability_exposure: {
        type: "score",
        instructions: "How risky?",
        criteria: ["low", "medium", "high"],
      },
    };
    const schema = buildFunctionCallingSchema(questions);
    const prop = schema.parameters.properties.liability_exposure as { type: string; minimum: number; maximum: number };
    expect(prop.type).toBe("integer");
    expect(prop.minimum).toBe(0);
    expect(prop.maximum).toBe(2);
  });

  it("marks the schema strict-compatible (no additional properties)", () => {
    const schema = buildFunctionCallingSchema({});
    expect(schema.parameters.additionalProperties).toBe(false);
  });
});

describe("matchReferencePrice", () => {
  it("matches a dated snapshot id to its base model's reference price, not a shorter prefix collision", () => {
    // "gpt-4o-mini-2024-07-18" must match the "gpt-4o-mini" entry, not "gpt-4o" —
    // this only works because the reference table lists the more specific
    // "gpt-4o-mini" prefix before the shorter "gpt-4o" one.
    const price = matchReferencePrice("gpt-4o-mini-2024-07-18");
    expect(price.model).toContain("gpt-4o-mini");
  });

  it("matches the base gpt-4o model when no mini suffix is present", () => {
    const price = matchReferencePrice("gpt-4o-2024-05-13");
    expect(price.model).toContain("gpt-4o");
    expect(price.model).not.toContain("mini");
  });

  it("falls back to the first reference entry for an unrecognized model name", () => {
    const price = matchReferencePrice("some-future-model-nobody-has-heard-of");
    expect(price).toBeDefined();
  });
});
