import { beforeEach, describe, expect, it } from "vitest";
import { MAX_SESSIONS, SESSION_TTL_MS, clearSessions, getOrCreateSession, resetSession, sessionCount } from "./session";

beforeEach(clearSessions);

describe("session store", () => {
  it("returns the same session for the same id, and a new one after a reset", () => {
    const a = getOrCreateSession("a");
    a.history.push({ role: "user", text: "hi" });
    expect(getOrCreateSession("a")).toBe(a);
    const fresh = resetSession("a");
    expect(fresh).not.toBe(a);
    expect(getOrCreateSession("a").history).toEqual([]);
  });

  it("never holds more than MAX_SESSIONS, dropping the least recently used first", () => {
    const first = getOrCreateSession("s0");
    for (let i = 1; i <= MAX_SESSIONS; i += 1) getOrCreateSession(`s${i}`);
    expect(sessionCount()).toBe(MAX_SESSIONS);
    expect(getOrCreateSession("s0")).not.toBe(first); // s0 was evicted, so this is a new session
  });

  it("keeps a session that is in use ahead of ones that are not", () => {
    const busy = getOrCreateSession("busy");
    for (let i = 0; i < MAX_SESSIONS - 1; i += 1) {
      getOrCreateSession(`s${i}`);
      getOrCreateSession("busy"); // touched every time, so it is always the most recent
    }
    getOrCreateSession("one-more");
    expect(getOrCreateSession("busy")).toBe(busy);
  });

  it("expires an idle session", () => {
    const t0 = 1_000_000;
    const old = getOrCreateSession("idle", t0);
    old.history.push({ role: "user", text: "hi" });
    expect(getOrCreateSession("idle", t0 + SESSION_TTL_MS)).toBe(old);
    const later = getOrCreateSession("idle", t0 + 2 * SESSION_TTL_MS + 1);
    expect(later).not.toBe(old);
    expect(later.history).toEqual([]);
  });

  it("clears out expired sessions when another one is touched", () => {
    const t0 = 5_000_000;
    getOrCreateSession("x", t0);
    getOrCreateSession("y", t0);
    getOrCreateSession("z", t0 + SESSION_TTL_MS + 1);
    expect(sessionCount()).toBe(1);
  });
});
