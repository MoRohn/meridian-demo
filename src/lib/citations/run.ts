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
    ? { status: "done", judged: r.judged, model: r.model, source: r.source, elapsedMs: r.elapsedMs, usage: r.usage }
    : { ...emptySide(r.reason === "not_configured" ? "skipped" : "error"), reason: r.reason, message: r.message };

/**
 * Judges a document's checks: one batched request to each backend, fired at the same moment, each recording its own result
 * the instant it lands. Checks decided by rule (broken, external, missing) never leave the app, and a text with none to
 * judge makes no call at all.
 */
export async function startRun(sig: string, extraction: Extraction, deps: RunDeps): Promise<void> {
  const judgeable = extraction.checks.some((c) => c.resolution === "model");
  const openaiOn = deps.openaiConfigured && judgeable;
  citationStore.set({ sig, extraction, typesafe: emptySide(judgeable ? "pending" : "skipped"), openai: emptySide(openaiOn ? "pending" : "skipped") });
  if (!judgeable) return;

  const label = `Citation checks: ${extraction.checks.filter((c) => c.resolution === "model").length} claims`;
  const one = async (backend: "typesafe" | "openai") => {
    const activity = deps.beginActivity(backend, "citation", label);
    const result = await callBatch(backend, extraction, backend === "typesafe" ? deps.typesafeOverride : deps.openaiOverride);
    citationStore.update(sig, (run) => ({ ...run, [backend]: settled(result) }));
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

  await Promise.all([one("typesafe"), ...(openaiOn ? [one("openai")] : [])]);
}
