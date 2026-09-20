import type { ActivityFinish, ActivityKind } from "../activity/log";
import { openaiActivityResult, typesafeActivityResult } from "../activity/outcomes";
import type { KeyOverride } from "../typesafe/client";
import type { CitationBatchResult } from "@/app/api/citations/route";
import type { Extraction } from "./extract";
import { citationStore, emptySide, type SideRun } from "./store";

/** What a run needs from the page: the saved keys, and the same activity and meter hooks every model call reports to. */
export interface RunDeps {
  typesafeOverride?: KeyOverride;
  openaiOverride?: KeyOverride;
  openaiConfigured: boolean;
  beginActivity: (actor: "typesafe" | "openai", kind: ActivityKind, label: string) => number;
  finishActivity: (actor: "typesafe" | "openai", id: number, result: ActivityFinish) => void;
  onMetrics?: (actor: "typesafe" | "openai", metrics: { task: string; inputBytes: number; inputTokens: number; outputTokens: number }) => void;
}

async function callBatch(backend: "typesafe" | "openai", extraction: Extraction, override: KeyOverride | undefined): Promise<CitationBatchResult> {
  const checks = extraction.checks.filter((c) => c.resolution === "model").map((c) => ({ id: c.id, claim: c.claim, source: c.source! }));
  try {
    const res = await fetch("/api/citations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ backend, checks, override }) });
    const data = await res.json();
    if (!res.ok) return { ok: false, reason: "error", message: data?.error ?? `Request failed (${res.status})` };
    return data as CitationBatchResult;
  } catch (err) {
    return { ok: false, reason: "error", message: (err as Error).message };
  }
}

const settled = (r: CitationBatchResult): SideRun =>
  r.ok
    ? { status: "done", judged: r.judged, model: r.model, source: r.source, elapsedMs: r.elapsedMs, usage: r.usage, ...(r.fallbackFrom ? { fallbackFrom: r.fallbackFrom } : {}) }
    : { ...emptySide(r.reason === "not_configured" ? "skipped" : "error"), reason: r.reason, message: r.message };

/** OpenAI is not run when there is no key for it: said as such, so it can be started later if a key arrives. */
const notConfigured = (): SideRun => ({ ...emptySide("skipped"), reason: "not_configured", message: "OpenAI is not configured." });

let requests = 0;

/**
 * Judges a document's checks: one batched request to each backend, fired at the same moment, each recording its own result
 * the instant it lands. Checks decided by rule (broken, external, missing) never leave the app, and a text with none to
 * judge makes no call at all.
 *
 * `only` re-runs one backend against the run already in the store (a Retry after a failure, or OpenAI started late once its
 * key is recognised), leaving the other side's answers untouched.
 */
export async function startRun(sig: string, extraction: Extraction, deps: RunDeps, only?: "typesafe" | "openai"): Promise<void> {
  const judgeable = extraction.checks.some((c) => c.resolution === "model");
  const token = ++requests;
  const existing = only ? citationStore.get(sig) : undefined;
  const openaiOn = deps.openaiConfigured && judgeable;

  if (existing && only) {
    citationStore.set({ ...existing, [only]: emptySide("pending"), tokens: { ...existing.tokens, [only]: token } });
  } else {
    citationStore.set({
      sig,
      extraction,
      typesafe: emptySide(judgeable ? "pending" : "skipped"),
      openai: openaiOn ? emptySide("pending") : judgeable ? notConfigured() : emptySide("skipped"),
      tokens: { typesafe: token, openai: token },
    });
  }
  if (!judgeable) return;

  const label = `Citation checks: ${extraction.checks.filter((c) => c.resolution === "model").length} claims`;
  const one = async (backend: "typesafe" | "openai") => {
    const activity = deps.beginActivity(backend, "citation", label);
    const result = await callBatch(backend, extraction, backend === "typesafe" ? deps.typesafeOverride : deps.openaiOverride);
    // An answer to a request that has since been replaced is dropped: it must not overwrite the newer one.
    citationStore.update(sig, (run) => (run.tokens[backend] === token ? { ...run, [backend]: settled(result) } : run));
    if (result.ok) {
      deps.onMetrics?.(backend, { task: "Citation checks", inputBytes: result.inputBytes, inputTokens: result.usage.input_tokens, outputTokens: result.usage.output_tokens });
      deps.finishActivity(
        backend,
        activity,
        backend === "typesafe"
          ? typesafeActivityResult(result.source === "live" ? "live" : "mock", result.elapsedMs, result.usage)
          : openaiActivityResult({ ok: true, result: { model: result.model, answers: {}, usage: result.usage, elapsedMs: result.elapsedMs, source: "live", requestBytes: result.inputBytes } }),
      );
    } else {
      deps.finishActivity(backend, activity, backend === "openai" ? openaiActivityResult(result) : { status: "error", note: result.message });
    }
  };

  const wanted = only ? [only] : (["typesafe", "openai"] as const);
  await Promise.all(wanted.filter((b) => b === "typesafe" || openaiOn).map(one));
}
