import { NextRequest, NextResponse } from "next/server";
import { EVAL_KIND_IDS } from "@/lib/eval/kinds";
import { describeServiceError, parseJudgeFailure } from "@/lib/eval/serviceError";
import { toEvalHealth, type EvalHealth } from "@/lib/eval/health";
import { evalLogLine } from "@/lib/eval/log";
import type { EvalOutcome, EvalRequest, EvalResult } from "@/lib/eval/types";

export const runtime = "nodejs";

const EVAL_SERVICE_URL = process.env.EVAL_SERVICE_URL || "http://localhost:8008";
const EVAL_TIMEOUT_MS = 60_000;
const KINDS: readonly string[] = EVAL_KIND_IDS;
const BACKENDS: readonly string[] = ["typesafe", "openai"];

/**
 * Server-side proxy to the DeepEval microservice (see eval-service/main.py)
 * server-to-server, same pattern as every other backend call in this
 * app, so the eval service's own address/judge-model config never has to
 * be exposed to the browser. The eval service is genuinely optional
 * infrastructure (a separate Python process); a connection failure here
 * just means "not running," reported the same honest way `not_configured`
 * is reported for a missing OPENAI_API_KEY elsewhere in this app.
 */
export async function GET() {
  // Pre-flight for the UI: is the service up, is its judge key set, which judge and pass mark. Never throws.
  let health: EvalHealth;
  try {
    const res = await fetch(`${EVAL_SERVICE_URL}/health`, { signal: AbortSignal.timeout(2_000), cache: "no-store" });
    health = res.ok ? toEvalHealth(await res.json()) : { status: "offline" };
  } catch {
    health = { status: "offline" };
  }
  return NextResponse.json({ health });
}

export async function POST(req: NextRequest) {
  let body: EvalRequest;
  try {
    body = (await req.json()) as EvalRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!KINDS.includes(body?.kind) || !BACKENDS.includes(body?.backend) || !body?.actualOutput || typeof body.input !== "string") {
    return NextResponse.json({ error: "kind, backend, input, and actualOutput are required" }, { status: 400 });
  }

  const started = Date.now();
  const respond = (outcome: EvalOutcome) => {
    console.info(evalLogLine({ kind: body.kind, backend: body.backend, outcome, ms: Date.now() - started }));
    return NextResponse.json({ outcome });
  };

  try {
    const res = await fetch(`${EVAL_SERVICE_URL}/evaluate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind: body.kind,
        backend: body.backend,
        input: body.input,
        actual_output: body.actualOutput,
        context: body.context ?? null,
      }),
      signal: AbortSignal.timeout(EVAL_TIMEOUT_MS),
    });

    if (!res.ok) {
      const detail = await res.json().catch(() => ({}));
      const message = describeServiceError(detail?.detail, `Eval service ${res.status}`);
      // 503 is specifically "the service is up but its own judge model isn't
      // configured" that's a not_configured state, not a real failure.
      const reason = res.status === 503 ? "not_configured" : "error";
      const failure = parseJudgeFailure(message);
      const outcome: EvalOutcome = { ok: false, reason, message: failure.message, ...(failure.code ? { code: failure.code } : {}) };
      return respond(outcome);
    }

    const data = await res.json();
    const result: EvalResult = {
      score: data.score,
      reason: data.reason,
      success: data.success,
      threshold: data.threshold,
      judgeModel: data.judge_model,
      rubric: data.rubric,
      steps: Array.isArray(data.steps) ? data.steps : [],
      integrity: {
        status: data.integrity?.status === "suspicious" ? "suspicious" : "clean",
        signals: Array.isArray(data.integrity?.signals) ? data.integrity.signals : [],
        hiddenCharsRemoved: data.integrity?.hidden_chars_removed ?? 0,
      },
      latencyMs: data.latency_ms,
    };
    const outcome: EvalOutcome = { ok: true, result };
    return respond(outcome);
  } catch (err) {
    // The service answered the connection but not in time: it IS running, so
    // telling the reader to go start it would be the wrong diagnosis.
    if ((err as Error).name === "TimeoutError") {
      const outcome: EvalOutcome = {
        ok: false,
        reason: "error",
        message: `The judge model didn't answer within ${EVAL_TIMEOUT_MS / 1000}s. Try again, or set EVAL_JUDGE_MODEL to a faster model.`,
      };
      return respond(outcome);
    }
    // Most common case in dev: nobody has started the eval service
    // Opt-in piece of infra, not a hard dependency of the app.
    const outcome: EvalOutcome = {
      ok: false,
      reason: "not_configured",
      message: `Eval service unreachable at ${EVAL_SERVICE_URL} (${(err as Error).message}). See eval-service/README.md to start it.`,
    };
    return respond(outcome);
  }
}
