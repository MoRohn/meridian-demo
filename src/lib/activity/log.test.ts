import { beforeEach, describe, expect, it, vi } from "vitest";
import { activityLog, currentActivity, elapsedOf, formatElapsed, shownElapsed, wallOf } from "./log";

beforeEach(() => activityLog.reset());

describe("activityLog", () => {
  it("gives every call its own record and its own start time", () => {
    const a = activityLog.begin("typesafe", "chat", "first", 1000);
    const b = activityLog.begin("typesafe", "chat", "second", 5000);
    expect(a).not.toBe(b);
    const [ra, rb] = activityLog.list();
    expect([ra.startedAt, rb.startedAt]).toEqual([1000, 5000]);
  });

  it("finishes only the record it was given", () => {
    const a = activityLog.begin("typesafe", "chat", "first", 0);
    const b = activityLog.begin("typesafe", "excerpt", "second", 10);
    activityLog.finish(a, { status: "done", modelMs: 700, inputTokens: 5 }, 900);
    const [ra, rb] = activityLog.list();
    expect(b).toBe(rb.id);
    expect(ra).toMatchObject({ status: "done", modelMs: 700, inputTokens: 5, endedAt: 900 });
    expect(rb.status).toBe("pending");
  });

  it("ignores a finish for an unknown or already finished id, so a late reply cannot rewrite history", () => {
    const a = activityLog.begin("openai", "chat", "x", 0);
    activityLog.finish(a, { status: "done", modelMs: 100 }, 100);
    activityLog.finish(a, { status: "error", note: "late" }, 999);
    expect(activityLog.list()[0]).toMatchObject({ status: "done", modelMs: 100 });
    activityLog.reset();
    activityLog.finish(a, { status: "done" }); // the session was reset while this was in flight
    expect(activityLog.list()).toHaveLength(0);
  });

  it("returns a stable snapshot until something changes, and notifies subscribers when it does", () => {
    const listener = vi.fn();
    const off = activityLog.subscribe(listener);
    const before = activityLog.list();
    expect(activityLog.list()).toBe(before);
    activityLog.begin("judge", "evaluation", "x");
    expect(listener).toHaveBeenCalledTimes(1);
    expect(activityLog.list()).not.toBe(before);
    off();
    activityLog.begin("judge", "evaluation", "y");
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("keeps only the most recent records", () => {
    for (let i = 0; i < 230; i++) activityLog.begin("typesafe", "chat", `n${i}`, i);
    const all = activityLog.list();
    expect(all).toHaveLength(200);
    expect(all[all.length - 1].label).toBe("n229");
  });
});

describe("currentActivity", () => {
  it("shows the newest running call, not an older one that happened to finish last", () => {
    const old = activityLog.begin("typesafe", "chat", "old", 0);
    activityLog.begin("typesafe", "excerpt", "new", 50);
    activityLog.finish(old, { status: "done", modelMs: 10 }, 60);
    expect(currentActivity(activityLog.list(), "typesafe")?.label).toBe("new");
  });

  it("falls back to the last finished call, and is scoped to one actor", () => {
    const a = activityLog.begin("openai", "chat", "a", 0);
    activityLog.finish(a, { status: "done" }, 5);
    expect(currentActivity(activityLog.list(), "openai")?.label).toBe("a");
    expect(currentActivity(activityLog.list(), "typesafe")).toBeNull();
  });
});

describe("elapsedOf", () => {
  it("counts up from the record's own start while running, so a new action starts again from zero", () => {
    const id = activityLog.begin("typesafe", "chat", "x", 10_000);
    const rec = activityLog.list().find((r) => r.id === id)!;
    expect(elapsedOf(rec, 10_000)).toBe(0);
    expect(elapsedOf(rec, 12_500)).toBe(2500);
    expect(elapsedOf(rec, 9_000)).toBe(0); // never negative
  });

  it("freezes on the measured model time once done, else on wall-clock", () => {
    const a = activityLog.begin("typesafe", "chat", "x", 0);
    const b = activityLog.begin("openai", "chat", "y", 0);
    activityLog.finish(a, { status: "done", modelMs: 640 }, 900);
    activityLog.finish(b, { status: "error" }, 1200);
    const [ra, rb] = activityLog.list();
    expect(elapsedOf(ra, 99_999)).toBe(640);
    expect(elapsedOf(rb, 99_999)).toBe(1200);
  });
});

describe("shownElapsed", () => {
  it("shows a chat turn's whole time to answer, not just the backend's model call, and never jumps down when it ends", () => {
    const id = activityLog.begin("typesafe", "chat", "x", 1000);
    const running = activityLog.list().find((r) => r.id === id)!;
    expect(shownElapsed(running, 14_000)).toBe(13_000);
    activityLog.finish(id, { status: "done", modelMs: 766 }, 14_000);
    const done = activityLog.list().find((r) => r.id === id)!;
    expect(shownElapsed(done, 99_999)).toBe(13_000); // the chat card's number
    expect(elapsedOf(done, 99_999)).toBe(766); // the backend's own model time, which the Speed comparison uses
    expect(wallOf(done, 99_999)).toBe(13_000);
  });

  it("shows the model's own time for every other kind of call", () => {
    const id = activityLog.begin("openai", "citation", "x", 0);
    activityLog.finish(id, { status: "done", modelMs: 640 }, 900);
    expect(shownElapsed(activityLog.list().find((r) => r.id === id)!, 0)).toBe(640);
  });
});

describe("formatElapsed", () => {
  it("writes short times in ms and longer ones in seconds", () => {
    expect(formatElapsed(420)).toBe("420ms");
    expect(formatElapsed(1250)).toBe("1.3s");
  });
});
