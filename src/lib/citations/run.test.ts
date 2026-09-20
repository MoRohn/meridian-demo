import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SAMPLE_CONTRACTS } from "../data/sampleContracts";
import { extractChecks } from "./extract";
import { startRun, type RunDeps } from "./run";
import { citationStore } from "./store";

const extraction = extractChecks({ text: SAMPLE_CONTRACTS[0].text, scope: "document" });
const ids = extraction.checks.filter((c) => c.resolution === "model").map((c) => c.id);
const judgedAll = (relation: string) => Object.fromEntries(ids.map((id) => [id, { relation, verdict: relation === "supports" ? "verified" : "contradicted", confidence: 0.9, basis: "calibrated" }]));
const ok = (relation: string, elapsedMs = 400) => ({ ok: true, judged: judgedAll(relation), model: "m", source: "live", elapsedMs, usage: { input_tokens: 1000, output_tokens: 100 }, inputBytes: 4000 });

type Call = { backend: "typesafe" | "openai"; sent: string[]; resolve: (body: object, status?: number) => void };
let calls: Call[];

/** A fetch whose every /api/citations request waits until the test answers it, so answers can land in any order. */
beforeEach(() => {
  calls = [];
  citationStore.reset();
  vi.stubGlobal("fetch", (_url: string, init: { body: string }) => new Promise((resolve) => {
    const { backend, checks } = JSON.parse(init.body);
    calls.push({ backend, sent: checks.map((c: { id: string }) => c.id), resolve: (body, status = 200) => resolve({ ok: status < 400, status, json: async () => body }) });
  }));
});
afterEach(() => vi.unstubAllGlobals());

function deps(over: Partial<RunDeps> = {}) {
  const log = { began: [] as string[], finished: [] as string[], metrics: [] as string[] };
  let id = 0;
  const d: RunDeps = {
    openaiConfigured: true,
    beginActivity: (actor, kind, label) => (log.began.push(`${actor}:${kind}:${label}`), ++id),
    finishActivity: (actor, _id, result) => void log.finished.push(`${actor}:${result.status}`),
    onMetrics: (actor) => void log.metrics.push(actor),
    ...over,
  };
  return { d, log };
}
const answer = (backend: "typesafe" | "openai", body: object) => calls.filter((c) => c.backend === backend).at(-1)!.resolve(body);
const flush = () => new Promise((r) => setTimeout(r, 0));

describe("a full run", () => {
  it("asks both backends at once, and records each answer as it lands, independently", async () => {
    const { d, log } = deps();
    const done = startRun("s", extraction, d);
    expect(calls.map((c) => c.backend).sort()).toEqual(["openai", "typesafe"]);
    expect(citationStore.get("s")).toMatchObject({ typesafe: { status: "pending" }, openai: { status: "pending" } });

    answer("typesafe", ok("contradicts"));
    await flush();
    expect(citationStore.get("s")).toMatchObject({ typesafe: { status: "done", model: "m", source: "live" }, openai: { status: "pending" } }); // OpenAI still out

    answer("openai", ok("supports", 6000));
    await done;
    const run = citationStore.get("s")!;
    expect(run.openai).toMatchObject({ status: "done", elapsedMs: 6000 });
    expect(Object.keys(run.typesafe.judged).sort()).toEqual([...ids].sort());
    expect(log.began).toHaveLength(2);
    expect(log.finished.sort()).toEqual(["openai:done", "typesafe:done"]);
    expect(log.metrics.sort()).toEqual(["openai", "typesafe"]);
  });

  it("keeps the model OpenAI was asked for when another judged, so the tab can say so", async () => {
    const { d } = deps();
    const run = startRun("swap", extraction, d);
    answer("typesafe", ok("contradicts"));
    answer("openai", { ...ok("contradicts"), model: "gpt-4o-mini-2024-07-18", fallbackFrom: "gpt-6-astra" });
    await run;
    expect(citationStore.get("swap")?.openai).toMatchObject({ status: "done", model: "gpt-4o-mini-2024-07-18", fallbackFrom: "gpt-6-astra" });
    expect(citationStore.get("swap")?.typesafe.fallbackFrom).toBeUndefined();
  });

  it("sends only what a model can judge: every check with a source, and none decided by rule", () => {
    startRun("s", extraction, deps().d);
    for (const call of calls) expect(call.sent).toEqual(ids);
    expect(ids).not.toContain("term_governing_law"); // a missing term is decided by rule
    expect(extraction.checks.find((c) => c.id === "term_governing_law")?.resolution).toBe("missing");
  });

  it("marks OpenAI not run, with the reason, when it is not configured, and does not call it", async () => {
    const done = startRun("s", extraction, deps({ openaiConfigured: false }).d);
    expect(calls.map((c) => c.backend)).toEqual(["typesafe"]);
    answer("typesafe", ok("contradicts"));
    await done;
    expect(citationStore.get("s")!.openai).toMatchObject({ status: "skipped", reason: "not_configured" });
  });

  it("makes no call at all for a text with nothing a model can judge", async () => {
    await startRun("s", { scope: "document", checks: [], sections: 0 }, deps().d);
    expect(calls).toEqual([]);
    expect(citationStore.get("s")).toMatchObject({ typesafe: { status: "skipped" }, openai: { status: "skipped" } });
  });
});

describe("when a model fails", () => {
  it("shows the failure on that model only, with its reason, and keeps the other's answers", async () => {
    const { d, log } = deps();
    const done = startRun("s", extraction, d);
    answer("typesafe", ok("contradicts"));
    answer("openai", { ok: false, reason: "error", message: "OpenAI 500: upstream" });
    await done;
    const run = citationStore.get("s")!;
    expect(run.openai).toMatchObject({ status: "error", message: "OpenAI 500: upstream" });
    expect(run.typesafe.status).toBe("done");
    expect(log.finished.sort()).toEqual(["openai:error", "typesafe:done"]);
  });

  it("treats a network failure or a bad request as that model's error too", async () => {
    const done = startRun("s", extraction, deps().d);
    calls.find((c) => c.backend === "openai")!.resolve({ error: "checks must be a list" }, 400);
    answer("typesafe", ok("contradicts"));
    await done;
    expect(citationStore.get("s")!.openai).toMatchObject({ status: "error", message: "checks must be a list" });
  });
});

describe("running one model again", () => {
  it("retries just OpenAI, leaving TypeSafe's answers and result exactly as they were", async () => {
    const first = startRun("s", extraction, deps().d);
    answer("typesafe", ok("contradicts"));
    answer("openai", { ok: false, reason: "error", message: "boom" });
    await first;
    const before = citationStore.get("s")!.typesafe;

    const retry = startRun("s", extraction, deps().d, "openai");
    expect(calls.filter((c) => c.backend === "typesafe")).toHaveLength(1); // no second TypeSafe call
    expect(citationStore.get("s")!.openai.status).toBe("pending");
    expect(citationStore.get("s")!.typesafe).toBe(before);
    answer("openai", ok("supports"));
    await retry;
    expect(citationStore.get("s")!.openai.status).toBe("done");
    expect(citationStore.get("s")!.typesafe).toBe(before);
  });

  it("starts OpenAI late, once it is configured, against the run that skipped it", async () => {
    const first = startRun("s", extraction, deps({ openaiConfigured: false }).d);
    answer("typesafe", ok("contradicts"));
    await first;
    expect(citationStore.get("s")!.openai.reason).toBe("not_configured");

    const late = startRun("s", extraction, deps({ openaiConfigured: true }).d, "openai");
    answer("openai", ok("supports"));
    await late;
    expect(citationStore.get("s")!.openai.status).toBe("done");
    expect(citationStore.get("s")!.typesafe.status).toBe("done");
  });
});

describe("a slow answer to an earlier request", () => {
  it("does not overwrite the results of the run that replaced it", async () => {
    const first = startRun("s", extraction, deps().d); // Re-check while the first run is still out
    const oldTypesafe = calls.filter((c) => c.backend === "typesafe")[0];
    const second = startRun("s", extraction, deps().d);
    const newTypesafe = calls.filter((c) => c.backend === "typesafe")[1];

    newTypesafe.resolve(ok("supports"));
    await flush();
    oldTypesafe.resolve(ok("contradicts")); // the old request finally lands
    await flush();
    expect(citationStore.get("s")!.typesafe.judged.term_liability.relation).toBe("supports");

    calls.filter((c) => c.backend === "openai").forEach((c) => c.resolve(ok("supports")));
    await Promise.all([first, second]);
    expect(citationStore.get("s")!.typesafe.judged.term_liability.relation).toBe("supports");
  });
});
