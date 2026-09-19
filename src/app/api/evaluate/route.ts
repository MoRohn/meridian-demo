import { NextRequest, NextResponse } from "next/server";
import type { EvalOutcome, EvalRequest, EvalResult } from "@/lib/eval/types";

export const runtime = "nodejs";

const EVAL_SERVICE_URL = process.env.EVAL_SERVICE_URL || "http://localhost:8008";

/**
 * Server-side proxy to the DeepEval microservice (see eval-service/main.py)
 * — kept server-to-server, same pattern as every other backend call in this
 * app, so the eval service's own address/judge-model config never has to
 * be exposed to the browser. The eval service is genuinely optional
 * infrastructure (a separate Python process); a connection failure here
 * just means "not running," reported the same honest way `not_configured`
 * is reported for a missing OPENAI_API_KEY elsewhere in this app.
 */
export async function POST(req: NextRequest) {
  let body: EvalRequest;
  try {
    body = (await req.json()) as EvalRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body?.task || !body?.criteria || !body?.actualOutput) {
    return NextResponse.json({ error: "task, criteria, and actualOutput are required" }, { status: 400 });
  }

  try {
    const res = await fetch(`${EVAL_SERVICE_URL}/evaluate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        task: body.task,
        backend: body.backend,
        criteria: body.criteria,
        input: body.input,
        actual_output: body.actualOutput,
        context: body.context ?? null,
      }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!res.ok) {
      const detail = await res.json().catch(() => ({}));
      const message: string = detail?.detail ?? `Eval service ${res.status}`;
      // 503 is specifically "the service is up but its own judge model isn't
      // configured" — that's a not_configured state, not a real failure.
      const reason = res.status === 503 ? "not_configured" : "error";
      const outcome: EvalOutcome = { ok: false, reason, message };
      return NextResponse.json({ outcome });
    }

    const data = await res.json();
    const result: EvalResult = {
      score: data.score,
      reason: data.reason,
      success: data.success,
      judgeModel: data.judge_model,
    };
    const outcome: EvalOutcome = { ok: true, result };
    return NextResponse.json({ outcome });
  } catch (err) {
    // Most common case in dev: nobody has started the eval service — that's
    // an opt-in piece of infra, not a hard dependency of the app.
    const outcome: EvalOutcome = {
      ok: false,
      reason: "not_configured",
      message: `Eval service unreachable at ${EVAL_SERVICE_URL} (${(err as Error).message}). See eval-service/README.md to start it.`,
    };
    return NextResponse.json({ outcome });
  }
}
