import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { clearSessions, getOrCreateSession } from "@/lib/memory/session";
import { resetRateLimits } from "@/lib/api/guard";

vi.mock("@/lib/orchestrator/run", () => ({ handleTurn: vi.fn(async () => ({ reply: "ok" })) }));
vi.mock("@/lib/typesafe/client", () => ({ isLive: () => false }));
vi.mock("@/lib/openai/client", () => ({ isOpenAIConfigured: () => false }));

const { POST } = await import("./route");

const SESSION = "session-0123456789abcdef";
const post = (body: unknown, headers: Record<string, string> = {}) =>
  POST(new NextRequest("http://localhost:3000/api/chat", { method: "POST", body: JSON.stringify(body), headers }));

beforeEach(() => {
  clearSessions();
  resetRateLimits();
});

describe("POST /api/chat: who may hold a session", () => {
  it("refuses a missing, short or malformed session id, and creates no session for it", async () => {
    for (const sessionId of [undefined, "", "a", "short-id", "has spaces and is long enough", 12345678901234567890, { id: 1 }]) {
      const res = await post({ action: "reset", sessionId });
      expect(res.status).toBe(400);
    }
    expect(getOrCreateSession("probe-0123456789abcdef").history).toEqual([]);
  });

  it("serves a valid id", async () => {
    const res = await post({ action: "reset", sessionId: SESSION });
    expect(res.status).toBe(200);
    expect((await res.json()).session.id).toBe(SESSION);
  });

  it("says whether the server has its own keys, and never sends them", async () => {
    const res = await post({ action: "reset", sessionId: SESSION });
    const data = await res.json();
    expect(data.envKeys).toEqual({ typesafe: false, openai: false });
    expect(JSON.stringify(data)).not.toMatch(/sk-|apiKey/i);
  });

  it("refuses a page on another site, and a caller past the rate limit", async () => {
    expect((await post({ action: "reset", sessionId: SESSION }, { origin: "https://evil.example", host: "localhost:3000" })).status).toBe(403);
    let last = 200;
    for (let i = 0; i < 125; i += 1) last = (await post({ action: "reset", sessionId: SESSION })).status;
    expect(last).toBe(429);
  });
});

describe("POST /api/chat: load_document_text input", () => {
  const load = (fields: object) => post({ action: "load_document_text", sessionId: SESSION, text: "1. Term.\nThis agreement renews.", name: "MSA.pdf", ...fields });

  it("loads a document with a clean name", async () => {
    const res = await load({ name: "  Master   Services\u0000 Agreement.pdf " });
    expect(res.status).toBe(200);
    expect((await res.json()).session.activeDocument.name).toBe("Master Services Agreement.pdf");
  });

  it("refuses a missing or non-string name instead of storing undefined in the session", async () => {
    for (const name of [undefined, null, 5, {}, "", "   ", "n".repeat(201)]) {
      const res = await load({ name });
      expect(res.status).toBe(400);
    }
    expect(getOrCreateSession(SESSION).activeDocument).toBeUndefined();
  });

  it("refuses text that is not a string, or is over the document limit", async () => {
    expect((await load({ text: 7 })).status).toBe(400);
    expect((await load({ text: "" })).status).toBe(400);
    expect((await load({ text: "x".repeat(100_001) })).status).toBe(413);
    expect(getOrCreateSession(SESSION).activeDocument).toBeUndefined();
  });
});

describe("POST /api/chat: message input", () => {
  it("refuses a message that is not a string or is too long", async () => {
    expect((await post({ action: "message", sessionId: SESSION, message: 5 })).status).toBe(400);
    expect((await post({ action: "message", sessionId: SESSION, message: "   " })).status).toBe(400);
    expect((await post({ action: "message", sessionId: SESSION, message: "x".repeat(8_001) })).status).toBe(413);
    expect((await post({ action: "message", sessionId: SESSION, message: "hello" })).status).toBe(200);
  });
});
