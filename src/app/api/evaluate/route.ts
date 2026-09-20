import { NextRequest, NextResponse } from "next/server";
import { apiError, guardApi } from "@/lib/api/guard";
import { EVAL_KIND_IDS } from "@/lib/eval/kinds";
import { describeServiceError, parseJudgeFailure } from "@/lib/eval/serviceError";
import { toEvalHealth, type EvalHealth } from "@/lib/eval/health";
import { evalLogLine } from "@/lib/eval/log";
import { isPlausibleKey, isSafeKeyTransport, redactKey } from "@/lib/eval/transport";
import { settleVerdict } from "@/lib/eval/verdict";
import type { EvalOutcome, EvalRequest, EvalResult } from "@/lib/eval/types";

export const runtime = "nodejs";

const EVAL_SERVICE_URL = process.env.EVAL_SERVICE_URL || "http://localhost:8008";
const EVAL_TIMEOUT_MS = 60_000;
/** Shared secret the service may require (EVAL_SERVICE_TOKEN); sent server-to-server only, never to the browser. */
const EVAL_SERVICE_TOKEN = process.env.EVAL_SERVICE_TOKEN?.trim();
/** The service's own limits (eval-service/main.py): a request over one is rejected there, so it is rejected here first with a clear reason. */
const MAX_INPUT_CHARS = 20_000;
const MAX_OUTPUT_CHARS = 20_000;
const MAX_CONTEXT_CHARS = 120_000;
const KINDS: readonly string[] = EVAL_KIND_IDS;
const BACKENDS: readonly string[] = ["typesafe", "openai"];
const JUDGE_PROVIDERS = ["openai", "anthropic", "gemini"] as const;
const PROVIDER_LABELS: Record<(typeof JUDGE_PROVIDERS)[number], string> = { openai: "OpenAI", anthropic: "Claude", gemini: "Gemini" };
/** A model id is a short name, never free text (mirrors eval-service/main.py): it ends up in a provider's request. */
const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,99}$/;

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
  const blocked = guardApi(req);
  if (blocked) return blocked;
  let body: EvalRequest;
  try {
    body = (await req.json()) as EvalRequest;
  } catch {
    return apiError("Invalid JSON body", 400);
  }

  if (!body || typeof body !== "object" || !KINDS.includes(body.kind) || !BACKENDS.includes(body.backend)) {
    return apiError("kind and backend must each be one of the supported values", 400);
  }
  if (typeof body.input !== "string" || body.input.length > MAX_INPUT_CHARS) {
    return apiError(`input must be a string of at most ${MAX_INPUT_CHARS} characters`, 400);
  }
  if (typeof body.actualOutput !== "string" || !body.actualOutput.trim() || body.actualOutput.length > MAX_OUTPUT_CHARS) {
    return apiError(`actualOutput must be a non-empty string of at most ${MAX_OUTPUT_CHARS} characters`, 400);
  }
  if (body.context != null && (typeof body.context !== "string" || body.context.length > MAX_CONTEXT_CHARS)) {
    return apiError(`context must be a string of at most ${MAX_CONTEXT_CHARS} characters`, 400);
  }

  // Who judges, from Settings: a provider, a model, and that provider's key. Provider and model are validated here as the
  // service validates them, so nothing but a known provider and a model-shaped id is ever forwarded.
  const provider = body.override?.provider;
  if (provider !== undefined && !(JUDGE_PROVIDERS as readonly string[]).includes(provider)) {
    return apiError(`provider must be one of: ${JUDGE_PROVIDERS.join(", ")}`, 400);
  }
  const judgeModel = body.override?.model;
  if (judgeModel !== undefined && (typeof judgeModel !== "string" || !MODEL_ID.test(judgeModel))) {
    return apiError("model is not a valid model id", 400);
  }

  // A key saved in Settings is used for the judge on this request only. It goes to the service in a header (never the
  // body), only over a safe transport, and is never logged or stored here.
  const savedKey = body.override?.apiKey;
  const canSendKey = isPlausibleKey(savedKey) && isSafeKeyTransport(EVAL_SERVICE_URL);
  const keyWithheld = isPlausibleKey(savedKey) && !canSendKey;

  const started = Date.now();
  const respond = (outcome: EvalOutcome) => {
    console.info(evalLogLine({ kind: body.kind, backend: body.backend, outcome, ms: Date.now() - started }));
    return NextResponse.json({ outcome });
  };

  try {
    const res = await fetch(`${EVAL_SERVICE_URL}/evaluate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(EVAL_SERVICE_TOKEN ? { "X-Eval-Token": EVAL_SERVICE_TOKEN } : {}),
        ...(canSendKey ? { "X-Judge-Api-Key": savedKey } : {}),
        ...(provider ? { "X-Judge-Provider": provider } : {}),
        ...(judgeModel ? { "X-Judge-Model": judgeModel } : {}),
      },
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
      const label = PROVIDER_LABELS[provider ?? "openai"];
      const hint = keyWithheld && res.status === 503 ? ` Your saved ${label} key was not sent because the evaluation service address is neither https nor local; use https, or set the key on the service.` : "";
      const failure = parseJudgeFailure(message + hint);
      const outcome: EvalOutcome = { ok: false, reason, message: failure.message, ...(failure.code ? { code: failure.code } : {}) };
      return respond(outcome);
    }

    const data = await res.json();
    // Pass or fail is decided here on the score as it is shown, the same rule for every judge and both backends, so it does
    // not depend on the service's raw float (or on an older service that has not been updated). See lib/eval/verdict.ts.
    const settled = settleVerdict(data.score, data.threshold);
    const result: EvalResult = {
      score: settled?.score ?? data.score,
      reason: data.reason,
      success: settled?.success ?? data.success,
      threshold: data.threshold,
      judgeModel: data.judge_model,
      rubric: data.rubric,
      steps: Array.isArray(data.steps) ? data.steps : [],
      bands: Array.isArray(data.bands) ? data.bands : [],
      integrity: {
        status: data.integrity?.status === "suspicious" ? "suspicious" : "clean",
        signals: Array.isArray(data.integrity?.signals) ? data.integrity.signals : [],
        hiddenCharsRemoved: data.integrity?.hidden_chars_removed ?? 0,
      },
      latencyMs: data.latency_ms,
      judgeCostUsd: typeof data.judge_cost_usd === "number" ? data.judge_cost_usd : null,
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
    // The address and the low-level error are for whoever runs the server, not the reader: they go to the server log
    // (with the key redacted), and the browser gets a plain sentence with a stable code.
    console.warn(`[api/evaluate] eval service unreachable at ${EVAL_SERVICE_URL}: ${redactKey((err as Error).message, savedKey)}`);
    const outcome: EvalOutcome = { ok: false, reason: "not_configured", code: "service_offline", message: "The evaluation service isn't running." };
    return respond(outcome);
  }
}
