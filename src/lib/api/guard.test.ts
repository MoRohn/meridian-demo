import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it } from "vitest";
import { RATE_LIMIT, RATE_WINDOW_MS, cleanDocumentName, guardApi, isCrossSite, isValidSessionId, resetRateLimits, takeToken } from "./guard";

const req = (headers: Record<string, string> = {}) => new NextRequest("http://localhost:3000/api/x", { method: "POST", headers });

beforeEach(resetRateLimits);

describe("isValidSessionId", () => {
  it("accepts what the browser mints", () => {
    expect(isValidSessionId(crypto.randomUUID())).toBe(true);
    expect(isValidSessionId("sess-1726855000000-k3j2h1g0f9")).toBe(true);
  });
  it("refuses short, odd, or non-string ids", () => {
    for (const bad of ["", "a", "short", "has spaces in it 12345", "../../etc/passwd-0000", "x".repeat(81), 42, null, undefined, {}]) {
      expect(isValidSessionId(bad)).toBe(false);
    }
  });
});

describe("cleanDocumentName", () => {
  it("trims, collapses whitespace and drops control characters", () => {
    expect(cleanDocumentName("  Master   Services\tAgreement\u0000.pdf ")).toBe("Master Services Agreement .pdf");
  });
  it("refuses a missing, empty, non-string or over-long name", () => {
    for (const bad of [undefined, null, 7, {}, "", "   ", "\u0000\u0001", "n".repeat(201)]) expect(cleanDocumentName(bad)).toBeNull();
  });
});

describe("isCrossSite", () => {
  it("lets a same-origin browser call and a caller with no Origin through", () => {
    expect(isCrossSite(req({ origin: "http://localhost:3000", host: "localhost:3000" }))).toBe(false);
    expect(isCrossSite(req({ host: "localhost:3000" }))).toBe(false);
  });
  it("refuses another site, and reads the forwarded host behind a proxy", () => {
    expect(isCrossSite(req({ origin: "https://evil.example", host: "localhost:3000" }))).toBe(true);
    expect(isCrossSite(req({ origin: "https://app.example", host: "internal:3000", "x-forwarded-host": "app.example" }))).toBe(false);
    expect(isCrossSite(req({ origin: "null", host: "localhost:3000" }))).toBe(true);
  });
});

describe("takeToken", () => {
  it("allows RATE_LIMIT calls in a window, then says how long to wait", () => {
    for (let i = 0; i < RATE_LIMIT; i += 1) expect(takeToken("a", 1_000)).toBeNull();
    const wait = takeToken("a", 1_000);
    expect(wait).toBeGreaterThan(0);
    expect(wait).toBeLessThanOrEqual(RATE_WINDOW_MS / 1000);
  });
  it("counts each client separately and starts a new window after the old one ends", () => {
    for (let i = 0; i <= RATE_LIMIT; i += 1) takeToken("a", 1_000);
    expect(takeToken("b", 1_000)).toBeNull();
    expect(takeToken("a", 1_000 + RATE_WINDOW_MS)).toBeNull();
  });
});

describe("guardApi", () => {
  it("passes a normal call and answers 403 / 429 with the error contract otherwise", async () => {
    expect(guardApi(req())).toBeNull();
    const cross = guardApi(req({ origin: "https://evil.example", host: "localhost:3000" }));
    expect(cross?.status).toBe(403);
    expect(await cross?.json()).toEqual({ error: "Cross-site requests are not allowed" });

    resetRateLimits();
    for (let i = 0; i < RATE_LIMIT; i += 1) guardApi(req({ "x-forwarded-for": "9.9.9.9" }));
    const limited = guardApi(req({ "x-forwarded-for": "9.9.9.9, 10.0.0.1" }));
    expect(limited?.status).toBe(429);
    expect(limited?.headers.get("Retry-After")).toMatch(/^\d+$/);
    expect(guardApi(req({ "x-forwarded-for": "8.8.8.8" }))).toBeNull();
  });
});
