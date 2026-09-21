import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as sdk from "@typesafe-ai/sdk";

// Real error classes (the client tells failures apart by class); only the client itself is replaced.
const calls: { config: Record<string, unknown>; options?: { signal?: AbortSignal } }[] = [];
let behaviour: (options?: { signal?: AbortSignal }) => Promise<unknown> = async () => ({});
let constructionError: Error | null = null;

vi.mock("@typesafe-ai/sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@typesafe-ai/sdk")>();
  class FakeClient {
    config: Record<string, unknown>;
    constructor(config: Record<string, unknown>) {
      if (constructionError) throw constructionError;
      this.config = config;
    }
    systemOne(_req: unknown, options?: { signal?: AbortSignal }) {
      calls.push({ config: this.config, options });
      return behaviour(options);
    }
  }
  return { ...actual, TypeSafeClient: FakeClient };
});

import { TYPESAFE_ATTEMPT_TIMEOUT_MS, TYPESAFE_TOTAL_TIMEOUT_MS, describeTypesafeFailure, systemOne } from "./client";

const QUESTIONS = { q: { type: "noul", instructions: "x" } } as never;
const KEY = { apiKey: "sk-test-key-0000000000" };
const live = { model: "jev-1", answers: { q: { type: "noul", noul: 0.9 } }, usage: { input_tokens: 10, output_tokens: 0 } };
const http = (Cls: new (s: number, b: unknown, h: Headers) => Error, status: number) => new Cls(status, {}, new Headers());

beforeEach(() => {
  calls.length = 0;
  constructionError = null;
  behaviour = async () => live;
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("systemOne", () => {
  it("sets its own limits instead of leaning on the SDK's defaults, and gives every call a total deadline", async () => {
    const r = await systemOne({}, QUESTIONS, KEY);
    expect(r).toMatchObject({ source: "live", model: "jev-1" });
    expect(r.fallbackReason).toBeUndefined();
    expect(calls[0].config).toMatchObject({ timeout: TYPESAFE_ATTEMPT_TIMEOUT_MS, retry: { maxRetries: 1 } });
    expect(calls[0].options?.signal).toBeInstanceOf(AbortSignal);
    expect(TYPESAFE_TOTAL_TIMEOUT_MS).toBeGreaterThan(TYPESAFE_ATTEMPT_TIMEOUT_MS);
  });

  it("uses the demo heuristic without complaint when there is no key at all", async () => {
    const r = await systemOne({}, QUESTIONS);
    expect(r.source).toBe("mock");
    expect(r.fallbackReason).toBeUndefined();
    expect(calls).toHaveLength(0);
  });

  it("says why when a key was given but no client could be made, instead of quietly answering from the demo", async () => {
    constructionError = new sdk.TypeSafeError("apiKey is malformed");
    const r = await systemOne({}, QUESTIONS, KEY);
    expect(r.source).toBe("mock");
    expect(r.fallbackReason).toBe("apiKey is malformed");
  });

  it("says why when the live call fails, naming a rejected key rather than a generic error", async () => {
    behaviour = async () => {
      throw http(sdk.AuthenticationError, 401);
    };
    const r = await systemOne({}, QUESTIONS, KEY);
    expect(r.source).toBe("mock");
    expect(r.fallbackReason).toMatch(/rejected the API key \(401\)/);
    expect(JSON.stringify(r)).not.toContain(KEY.apiKey);
  });

  it("reports the total budget running out as a timeout", async () => {
    // The budget is an AbortSignal.timeout; swap in one the test can fire.
    const budget = new AbortController();
    vi.spyOn(AbortSignal, "timeout").mockReturnValue(budget.signal);
    behaviour = (options) => new Promise((_res, rej) => options!.signal!.addEventListener("abort", () => rej(new sdk.APIUserAbortError())));
    const pending = systemOne({}, QUESTIONS, KEY);
    budget.abort();
    const r = await pending;
    expect(r.source).toBe("mock");
    expect(r.fallbackReason).toBe(`TypeSafe did not answer within ${TYPESAFE_TOTAL_TIMEOUT_MS / 1000}s.`);
  });

  it("stops and throws, rather than answering from the demo, when the caller goes away", async () => {
    behaviour = (options) => new Promise((_res, rej) => options!.signal!.addEventListener("abort", () => rej(new sdk.APIUserAbortError())));
    const caller = new AbortController();
    const pending = systemOne({}, QUESTIONS, KEY, caller.signal);
    caller.abort();
    await expect(pending).rejects.toBeInstanceOf(sdk.APIUserAbortError);
  });
});

describe("describeTypesafeFailure", () => {
  it("names the cause of each kind of failure", () => {
    expect(describeTypesafeFailure(http(sdk.RateLimitError, 429))).toMatch(/rate limiting/);
    expect(describeTypesafeFailure(http(sdk.PermissionDeniedError, 403))).toMatch(/denied/);
    expect(describeTypesafeFailure(http(sdk.NotFoundError, 404))).toMatch(/model or endpoint/);
    expect(describeTypesafeFailure(http(sdk.InternalServerError, 503))).toBe("TypeSafe returned an error (503).");
    expect(describeTypesafeFailure(new sdk.APIConnectionError())).toMatch(/Could not reach/);
    expect(describeTypesafeFailure(new sdk.APITimeoutError(20000), 45000)).toBe("TypeSafe did not answer within 45s.");
    expect(describeTypesafeFailure(new Error("boom"))).toBe("The TypeSafe call failed.");
  });
});
