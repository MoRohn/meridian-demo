import { describe, expect, it } from "vitest";
import { fmtUsd, TYPESAFE_PRICING, usdForTokens } from "./pricing";

describe("usdForTokens", () => {
  it("computes cost linearly from a per-million-token rate", () => {
    expect(usdForTokens(1_000_000, 2.5)).toBeCloseTo(2.5, 6);
    expect(usdForTokens(500_000, 2.5)).toBeCloseTo(1.25, 6);
    expect(usdForTokens(0, 2.5)).toBe(0);
  });

  it("TypeSafe output tokens are priced at $0", () => {
    expect(TYPESAFE_PRICING.outputPerMillionUsd).toBe(0);
    expect(usdForTokens(1_000_000, TYPESAFE_PRICING.outputPerMillionUsd)).toBe(0);
  });
});

describe("fmtUsd", () => {
  it("renders exactly $0.00 for zero", () => {
    expect(fmtUsd(0)).toBe("$0.00");
  });

  it("uses scientific notation for very small non-zero amounts", () => {
    expect(fmtUsd(0.00000042)).toMatch(/^\$\d\.\d\de-\d+$/);
  });

  it("renders ordinary amounts with six decimal places", () => {
    expect(fmtUsd(0.0123)).toBe("$0.012300");
  });
});
