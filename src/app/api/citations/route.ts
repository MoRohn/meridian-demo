import { NextRequest, NextResponse } from "next/server";
import { apiError, guardApi } from "@/lib/api/guard";
import { buildBatch, judgedFromOpenAI, judgedFromTypesafe, type BatchCheck, type Judged } from "@/lib/citations/batch";
import { runOpenAIEquivalent } from "@/lib/openai/client";
import { systemOne, type KeyOverride } from "@/lib/typesafe/client";
import { typesafeRequestBytes } from "@/lib/typesafe/measure";

export const runtime = "nodejs";

const MAX_CHECKS = 40;
const MAX_CLAIM = 700;
const MAX_SOURCE = 6000;
const ID = /^[a-z0-9_]{1,40}$/;

/** What one backend returns for a batch: every check's answer read into a relation and a verdict, plus what the call measured. */
export type CitationBatchResult =
  | { ok: true; judged: Record<string, Judged>; model: string; source: "live" | "mock"; elapsedMs: number; usage: { input_tokens: number; output_tokens: number }; inputBytes: number; fallbackFrom?: string }
  | { ok: false; reason: "not_configured" | "error"; message?: string };

function parse(body: unknown): { backend: "typesafe" | "openai"; checks: BatchCheck[]; override?: KeyOverride } | string {
  const b = body as { backend?: unknown; checks?: unknown; override?: KeyOverride } | null;
  if (b?.backend !== "typesafe" && b?.backend !== "openai") return "backend must be typesafe or openai";
  if (!Array.isArray(b.checks) || b.checks.length === 0 || b.checks.length > MAX_CHECKS) return `checks must be a list of 1 to ${MAX_CHECKS}`;
  const seen = new Set<string>();
  for (const c of b.checks as BatchCheck[]) {
    if (typeof c?.id !== "string" || !ID.test(c.id) || seen.has(c.id)) return "each check needs a unique id of lowercase letters, digits and underscores";
    seen.add(c.id);
    if (typeof c.claim !== "string" || !c.claim.trim() || c.claim.length > MAX_CLAIM) return `each claim must be 1 to ${MAX_CLAIM} characters`;
    if (typeof c.source !== "string" || !c.source.trim() || c.source.length > MAX_SOURCE) return `each source must be 1 to ${MAX_SOURCE} characters`;
  }
  return { backend: b.backend, checks: b.checks as BatchCheck[], override: b.override };
}

/**
 * Judges every check of a document or passage against its source in one request to one backend. The client fires TypeSafe's
 * and OpenAI's at the same moment, each resolving on its own, exactly as a chat turn does (see /api/compare-openai).
 *
 * Errors follow the contract in lib/api/guard.ts, with one deliberate reading of it: a malformed request is a 400 `{ error }`,
 * but a backend that fails (its key is missing, the provider is down, the call throws) is an outcome, answered 200 with
 * `{ ok: false, reason, message }`, so the page can show one side failing beside the other side's answers.
 */
export async function POST(req: NextRequest) {
  const blocked = guardApi(req);
  if (blocked) return blocked;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return apiError("Invalid JSON body", 400);
  }
  const parsed = parse(body);
  if (typeof parsed === "string") return apiError(parsed, 400);

  const batch = buildBatch(parsed.checks)!;
  const ids = parsed.checks.map((c) => c.id);
  try {
    if (parsed.backend === "typesafe") {
      const response = await systemOne(batch.state, batch.questions, parsed.override, req.signal);
      const result: CitationBatchResult = {
        ok: true,
        judged: judgedFromTypesafe(response.answers, ids),
        model: response.model,
        source: response.source,
        elapsedMs: response.elapsedMs,
        usage: response.usage,
        inputBytes: typesafeRequestBytes(batch.state, batch.questions),
      };
      return NextResponse.json(result);
    }
    const outcome = await runOpenAIEquivalent(batch.state, batch.questions, parsed.override);
    if (!outcome.ok) return NextResponse.json({ ok: false, reason: outcome.reason, message: outcome.message } satisfies CitationBatchResult);
    const result: CitationBatchResult = {
      ok: true,
      judged: judgedFromOpenAI(outcome.result.answers, ids),
      model: outcome.result.model,
      source: "live",
      elapsedMs: outcome.result.elapsedMs,
      usage: outcome.result.usage,
      inputBytes: outcome.result.requestBytes,
      // The model asked for was not available on this key and another judged instead; the page says so.
      ...(outcome.result.fallbackFrom ? { fallbackFrom: outcome.result.fallbackFrom } : {}),
    };
    return NextResponse.json(result);
  } catch (err) {
    console.error("[api/citations] error:", err);
    return NextResponse.json({ ok: false, reason: "error", message: (err as Error).message } satisfies CitationBatchResult);
  }
}
