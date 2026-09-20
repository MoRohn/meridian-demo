import { beforeEach, describe, expect, it, vi } from "vitest";
import { evalStore } from "./store";

const entry = (over = {}) => ({ sig: "s", outcome: null, pending: true, auto: false, ...over });
beforeEach(() => evalStore.reset());

describe("evalStore", () => {
  it("keeps a result per scope and backend, independently", () => {
    evalStore.set("risk", "typesafe", entry({ sig: "a" }));
    evalStore.set("risk", "openai", entry({ sig: "b" }));
    evalStore.set("compliance", "typesafe", entry({ sig: "c" }));
    expect(evalStore.get("risk", "typesafe")?.sig).toBe("a");
    expect(evalStore.get("risk", "openai")?.sig).toBe("b");
    expect(evalStore.get("compliance", "openai")).toBeUndefined();
  });

  it("outlives a tab switch: the same entry is there when the panel mounts again", () => {
    evalStore.set("reply", "typesafe", entry({ pending: false, outcome: { ok: false, reason: "error" } }));
    expect(evalStore.get("reply", "typesafe")?.pending).toBe(false); // a fresh panel reads this back
  });

  it("reports whether a scope has anything, and clears just that scope", () => {
    evalStore.set("risk", "typesafe", entry());
    evalStore.set("citation", "typesafe", entry());
    expect(evalStore.hasAny("risk")).toBe(true);
    evalStore.clearScope("risk");
    expect(evalStore.hasAny("risk")).toBe(false);
    expect(evalStore.hasAny("citation")).toBe(true);
  });

  it("remembers that a scope was auto-evaluated, so each action runs by itself once", () => {
    expect(evalStore.autoRanFor("risk")).toBe(false);
    evalStore.markAutoRan("risk");
    expect(evalStore.autoRanFor("risk")).toBe(true);
    expect(evalStore.autoRanFor("compliance")).toBe(false);
  });

  it("a reset forgets everything, results and first-time flags alike", () => {
    evalStore.set("risk", "typesafe", entry());
    evalStore.markAutoRan("risk");
    evalStore.reset();
    expect(evalStore.hasAny("risk")).toBe(false);
    expect(evalStore.autoRanFor("risk")).toBe(false);
  });

  it("notifies subscribers on every change and stops after unsubscribe", () => {
    const listener = vi.fn();
    const off = evalStore.subscribe(listener);
    const v0 = evalStore.version();
    evalStore.set("risk", "typesafe", entry());
    evalStore.reset();
    expect(listener).toHaveBeenCalledTimes(2);
    expect(evalStore.version()).toBe(v0 + 2);
    off();
    evalStore.set("risk", "typesafe", entry());
    expect(listener).toHaveBeenCalledTimes(2);
  });
});

describe("evalStore.rows", () => {
  it("lists every stored evaluation with its scope and backend", () => {
    evalStore.set("risk:excerpt", "openai", entry({ sig: "x", kind: "risk" }));
    evalStore.set("reply", "typesafe", entry({ sig: "y", kind: "reply" }));
    const rows = evalStore.rows().map((r) => [r.scope, r.backend, r.kind]);
    expect(rows).toEqual(expect.arrayContaining([["risk:excerpt", "openai", "risk"], ["reply", "typesafe", "reply"]]));
    expect(rows).toHaveLength(2);
  });
});
