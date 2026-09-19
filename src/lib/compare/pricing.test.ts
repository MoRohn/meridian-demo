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
  it("shows zero, negative and non-numeric amounts as $0.00", () => {
    for (const n of [0, -1, NaN]) expect(fmtUsd(n)).toBe("$0.00");
  });

  it("writes amounts under a dollar with six decimals, every leading zero included", () => {
    expect(fmtUsd(6.53e-5)).toBe("$0.000065");
    expect(fmtUsd(0.011624)).toBe("$0.011624");
    expect(fmtUsd(0.5)).toBe("$0.500000");
    expect(fmtUsd(0.000001)).toBe("$0.000001");
  });

  it("never uses scientific notation, whatever the size", () => {
    for (const n of [6.53e-5, 4.2e-7, 1e-12, 0.0123, 5, 1234567]) expect(fmtUsd(n)).not.toMatch(/e[+-]?\d/i);
  });

  it("reads a sub-microdollar amount as '<$0.000001' instead of a misleading $0.000000", () => {
    expect(fmtUsd(4.2e-7)).toBe("<$0.000001");
    expect(fmtUsd(1e-12)).toBe("<$0.000001");
  });

  it("uses cents with thousands separators from a dollar up", () => {
    expect(fmtUsd(1)).toBe("$1.00");
    expect(fmtUsd(12.3456)).toBe("$12.35");
    expect(fmtUsd(1234.5)).toBe("$1,234.50");
    expect(fmtUsd(1234567.891)).toBe("$1,234,567.89");
  });

  it("does not print $1.000000 when an amount rounds up to a dollar", () => {
    expect(fmtUsd(0.9999996)).toBe("$1.00");
  });

  it("gives every figure below a dollar the same width, so a column of costs lines up", () => {
    const widths = [6.53e-5, 0.011624, 0.5, 0.000001].map((n) => fmtUsd(n).length);
    expect(new Set(widths).size).toBe(1);
  });
});
