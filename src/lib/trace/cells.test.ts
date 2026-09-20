import { describe, expect, it } from "vitest";
import type { Answer } from "../typesafe/types";
import { impliedYesProbability, openaiCell, scoreCeiling, typesafeCell, yesTone } from "./cells";

const choice: Answer = { type: "choice", choice: "analyze_contract", probabilities: { small_talk: 0.02, analyze_contract: 0.91, check_compliance: 0.07 }, confidence: 0.75 };
const score: Answer = { type: "score", score: 1.18, legend: { "0": "a", "1": "b", "2": "c" }, probabilities: { "0": 0.1, "1": 0.55, "2": 0.35 }, confidence: 0.54 };

describe("typesafeCell", () => {
  it("reads a yes/no as Yes or No with its probability, toned by how sure it is", () => {
    expect(typesafeCell({ type: "noul", noul: 0.84 })).toMatchObject({ main: "Yes", sub: "84% probability of yes", bar: { value: 0.84, tone: "rose" } });
    expect(typesafeCell({ type: "noul", noul: 0.1 })).toMatchObject({ main: "No", bar: { tone: "emerald" } });
    expect(typesafeCell({ type: "noul", noul: 0.5 })).toMatchObject({ main: "Yes", bar: { tone: "amber" } });
  });

  it("reads a choice as the chosen option with its own probability, and keeps the whole distribution for the tooltip", () => {
    const c = typesafeCell(choice);
    expect(c.main).toBe("analyze_contract");
    expect(c.sub).toBe("91% · confidence 75%");
    expect(c.bar).toEqual({ value: 0.91, tone: "accent" });
    expect(c.detail).toBe("analyze_contract 91%, check_compliance 7%, small_talk 2%");
  });

  it("reads a score against its top level", () => {
    const c = typesafeCell(score);
    expect(c.main).toBe("1.18");
    expect(c.sub).toBe("of 2 · confidence 54%");
    expect(c.bar?.value).toBeCloseTo(0.59);
    expect(c.detail).toBe("level 0 10%, level 1 55%, level 2 35%");
  });

  it("falls back to the confidence when a choice's own probability is missing", () => {
    expect(typesafeCell({ ...choice, probabilities: {} }).sub).toBe("75% · confidence 75%");
  });
});

describe("scoreCeiling", () => {
  it("uses the legend, then the probabilities, then 1", () => {
    expect(scoreCeiling(score as Extract<Answer, { type: "score" }>)).toBe(2);
    expect(scoreCeiling({ type: "score", score: 1, legend: {}, probabilities: { "3": 1 }, confidence: 1 })).toBe(3);
    expect(scoreCeiling({ type: "score", score: 0, legend: {}, probabilities: {}, confidence: 1 })).toBe(1);
  });
});

describe("impliedYesProbability", () => {
  it("reads a confident yes as a high chance of yes and a confident no as a low one", () => {
    expect(impliedYesProbability(true, 0.99)).toBe(0.99);
    expect(impliedYesProbability(false, 0.99)).toBeCloseTo(0.01, 10);
  });
  it("has nothing to say without a reported confidence, and never leaves 0..1", () => {
    expect(impliedYesProbability(true, null)).toBeNull();
    expect(impliedYesProbability(true, 1.4)).toBe(1);
    expect(impliedYesProbability(false, 1.4)).toBe(0);
  });
});

describe("yesTone", () => {
  it("tones a likely yes rose, a likely no emerald, and the middle amber", () => {
    expect([yesTone(0.9), yesTone(0.6), yesTone(0.5), yesTone(0.4), yesTone(0.01)]).toEqual(["rose", "rose", "amber", "emerald", "emerald"]);
  });
});

describe("openaiCell", () => {
  it("says Yes or No for a yes/no question, never true or false", () => {
    expect(openaiCell({ type: "noul", noul: 1 }, true, 0.8)).toMatchObject({ main: "Yes", sub: "self-reported 80%" });
    expect(openaiCell({ type: "noul", noul: 1 }, false, null)).toMatchObject({ main: "No", sub: "" });
  });
  it("shows a choice or a level as it was answered", () => {
    expect(openaiCell(choice, "check_compliance", 0.9).main).toBe("check_compliance");
    expect(openaiCell(score, 2, 0.7)).toMatchObject({ main: "2", sub: "self-reported 70%" });
  });

  it("draws a yes/no bar on TypeSafe's scale: the probability of yes its confidence implies, toned like TypeSafe's", () => {
    const yes = openaiCell({ type: "noul", noul: 0 }, true, 0.99);
    expect(yes.bar).toEqual({ value: 0.99, tone: "rose" });
    const no = openaiCell({ type: "noul", noul: 0 }, false, 0.99);
    expect(no.bar?.value).toBeCloseTo(0.01, 10);
    expect(no.bar?.tone).toBe("emerald");
    expect(no.detail).toContain("1%");
  });
  it("draws a choice bar as its self-reported confidence in the chosen option", () => {
    expect(openaiCell(choice, "analyze_contract", 0.8).bar).toEqual({ value: 0.8, tone: "accent" });
  });
  it("draws a level bar as the level over the top level, whether or not a confidence was reported", () => {
    expect(openaiCell(score, 1, 0.7).bar).toEqual({ value: 0.5, tone: "amber" }); // level 1 of a top level of 2
    expect(openaiCell(score, 2, null).bar).toEqual({ value: 1, tone: "amber" });
  });
  it("draws no bar when it has no confidence to draw one from (except a level)", () => {
    expect(openaiCell({ type: "noul", noul: 0 }, true, null).bar).toBeNull();
    expect(openaiCell(choice, "analyze_contract", null).bar).toBeNull();
  });
});
