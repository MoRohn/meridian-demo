import { afterEach, describe, expect, it, vi } from "vitest";
import { RequestTimeoutError, postJson } from "./request";

afterEach(() => vi.unstubAllGlobals());

const reply = (body: unknown, status = 200) => new Response(typeof body === "string" ? body : JSON.stringify(body), { status });

describe("postJson", () => {
  it("posts JSON, gives the call a deadline, and returns the parsed reply", async () => {
    let init: RequestInit | undefined;
    vi.stubGlobal("fetch", vi.fn(async (_u: string, i: RequestInit) => ((init = i), reply({ ok: 1 }))));
    await expect(postJson("/api/x", { a: 1 }, { timeoutMs: 5000 })).resolves.toEqual({ ok: 1 });
    expect(init?.method).toBe("POST");
    expect(init?.body).toBe('{"a":1}');
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("uses the server's own message for a failure, and a status line when it has none", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => reply({ error: "text is required" }, 400)));
    await expect(postJson("/api/x", {}, { timeoutMs: 5000 })).rejects.toThrow("text is required");
    vi.stubGlobal("fetch", vi.fn(async () => reply("<html>bad gateway</html>", 502)));
    await expect(postJson("/api/x", {}, { timeoutMs: 5000 })).rejects.toThrow("Request failed (502)");
  });

  it("treats a reply that is not JSON as an error instead of returning nothing", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => reply("ok")));
    await expect(postJson("/api/x", {}, { timeoutMs: 5000 })).rejects.toThrow(/unreadable reply/);
  });

  it("gives up when nothing answers before the deadline, and says so", async () => {
    // A server that never answers: the fetch only ends when its signal aborts, as a real one does.
    vi.stubGlobal("fetch", vi.fn((_u: string, init: RequestInit) => new Promise((_res, rej) => init.signal!.addEventListener("abort", () => rej(init.signal!.reason)))));
    const started = Date.now();
    const err = (await postJson("/api/x", {}, { timeoutMs: 50 }).catch((e) => e)) as Error;
    expect(err).toBeInstanceOf(RequestTimeoutError);
    expect(err.message).toMatch(/No answer within/);
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it("does not call a deliberate cancel a timeout", async () => {
    vi.stubGlobal("fetch", vi.fn((_u: string, init: RequestInit) => new Promise((_res, rej) => init.signal!.addEventListener("abort", () => rej(init.signal!.reason)))));
    const cancel = new AbortController();
    const pending = postJson("/api/x", {}, { timeoutMs: 5000, signal: cancel.signal }).catch((e) => e);
    cancel.abort();
    expect(await pending).not.toBeInstanceOf(RequestTimeoutError);
  });
});
