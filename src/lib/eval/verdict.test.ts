import { describe, expect, it } from "vitest";
import { settleVerdict } from "./verdict";

const T = 0.6;
/** What DeepEval hands back for a judge that chose `choice` with one candidate token of probability p. */
const deepeval = (choice: number, p: number) => (choice * p) / p / 10;

describe("settleVerdict", () => {
  it("settles the case from the screenshot: 60% against a 60% mark passes, whatever the float says", () => {
    expect(settleVerdict(0.5999999999999999, T)).toEqual({ score: 0.6, success: true });
    expect(settleVerdict(0.6, T)).toEqual({ score: 0.6, success: true });
    expect(settleVerdict(0.6000000000000001, T)).toEqual({ score: 0.6, success: true });
  });

  it("gives a judge that chose a whole number that number, for every probability it might have had", () => {
    for (let choice = 0; choice <= 10; choice++) {
      for (let i = 0; i < 2000; i++) {
        const p = Math.exp(-((i * 0.6180339887) % 1) * 0.6);
        expect(settleVerdict(deepeval(choice, p), T)).toEqual({ score: choice / 10, success: choice >= 6 });
      }
    }
  });

  it("treats float noise past 1 as a 100%, not as a judge error", () => {
    expect(settleVerdict(1.0000000000000002, T)).toEqual({ score: 1, success: true });
    expect(settleVerdict(-1e-16, T)).toEqual({ score: 0, success: false });
  });

  it("decides on the whole percent the reader sees, rounded half up", () => {
    expect(settleVerdict(0.594, T)).toEqual({ score: 0.59, success: false });
    expect(settleVerdict(0.595, T)).toEqual({ score: 0.6, success: true });
    expect(settleVerdict(0.605, T)).toEqual({ score: 0.61, success: true });
    // ...which is what the panel shows: Math.round(score * 100) equals the percent that was compared.
    for (const raw of [0.594, 0.595, 0.599, 0.6, 0.604, 0.605]) expect(Math.round(settleVerdict(raw, T)!.score * 100)).toBe(Math.round(raw * 100));
  });

  it("holds for any pass mark", () => {
    expect(settleVerdict(0.65, 0.65)?.success).toBe(true);
    expect(settleVerdict(0.64, 0.65)?.success).toBe(false);
    expect(settleVerdict(0.6999999999999999, 0.7)?.success).toBe(true);
    expect(settleVerdict(1, 1)?.success).toBe(true);
    expect(settleVerdict(0.99, 1)?.success).toBe(false);
  });

  it("is idempotent, so a service that already settled the score changes nothing", () => {
    for (const raw of [0, 0.3, 0.59, 0.6, 0.85, 1]) {
      const once = settleVerdict(raw, T)!;
      expect(settleVerdict(once.score, T)).toEqual(once);
    }
  });

  it.each([[NaN], [Infinity], [-Infinity], [9.9], [99], [-0.1], [1.01], [-0.01], ["0.6"], [null], [undefined], [true]])("refuses %j rather than settling it", (bad) => {
    expect(settleVerdict(bad, T)).toBeNull();
  });
});
