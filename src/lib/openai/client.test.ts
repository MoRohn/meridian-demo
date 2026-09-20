import { afterEach, describe, expect, it, vi } from "vitest";
import { OPENAI_TIMEOUT_MS, describeFetchError, runOpenAIEquivalent } from "./client";

afterEach(() => vi.unstubAllGlobals());

describe("describeFetchError", () => {
  it("says a timeout was a timeout", () => {
    const timeout = Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });
    expect(describeFetchError(timeout)).toBe(`OpenAI did not answer within ${OPENAI_TIMEOUT_MS / 1000}s`);
  });
  it("passes any other error message through", () => {
    expect(describeFetchError(new Error("fetch failed"))).toBe("fetch failed");
    expect(describeFetchError(undefined)).toBe("OpenAI request failed");
  });
});

describe("runOpenAIEquivalent", () => {
  it("gives every call an abort signal, and reports a stalled call as an error instead of hanging", async () => {
    const seen: (AbortSignal | undefined)[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      seen.push(init.signal ?? undefined);
      throw Object.assign(new Error("aborted"), { name: "TimeoutError" });
    }));
    const outcome = await runOpenAIEquivalent({}, { q: { type: "noul", instructions: "x" } } as never, { apiKey: "sk-test-key-0000000000" });
    expect(seen[0]).toBeInstanceOf(AbortSignal);
    expect(outcome).toEqual({ ok: false, reason: "error", message: `OpenAI did not answer within ${OPENAI_TIMEOUT_MS / 1000}s` });
    expect(seen).toHaveLength(1); // a timeout is not "model unavailable", so there is no fallback retry
  });
});
