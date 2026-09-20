import { describe, expect, it } from "vitest";
import { shouldAutoEvaluate, type AutoEvaluateInput } from "./auto";

const READY: AutoEvaluateInput = { enabled: true, rendered: true, health: "ready", hasSavedKey: false, alreadyAutoRan: false, hasEntries: false, runnableCount: 2, awaitingOtherSide: false };
const go = (over: Partial<AutoEvaluateInput> = {}) => shouldAutoEvaluate({ ...READY, ...over });

describe("shouldAutoEvaluate", () => {
  it("fires when the panel is on screen, the service is ready, and there is something to judge", () => {
    expect(go()).toBe(true);
  });
  it("respects the setting: it spends judge calls, so it can be off", () => {
    expect(go({ enabled: false })).toBe(false);
  });
  it("waits until the panel is actually on screen, not merely mounted", () => {
    expect(go({ rendered: false })).toBe(false);
  });
  it("happens once per action, and never over a result the reader already has", () => {
    expect(go({ alreadyAutoRan: true })).toBe(false);
    expect(go({ hasEntries: true })).toBe(false);
  });
  it("needs something to evaluate, and waits for the other backend's answer rather than leaving it out", () => {
    expect(go({ runnableCount: 0 })).toBe(false);
    expect(go({ awaitingOtherSide: true })).toBe(false);
  });
  it("never guesses about the service: unknown or offline means no", () => {
    expect(go({ health: null })).toBe(false);
    expect(go({ health: "offline" })).toBe(false);
  });
  it("needs a judge key from somewhere: the service's own, or one saved in Settings", () => {
    expect(go({ health: "judge_not_configured" })).toBe(false);
    expect(go({ health: "judge_not_configured", hasSavedKey: true })).toBe(true);
  });
});
