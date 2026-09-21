import { buildFunctionCallingSchema } from "../compare/openaiEquivalent";
import type { QuestionSpec, State } from "../typesafe/types";
import type { OpenAIRunOutcome, OpenAIRunResult } from "./types";
import type { KeyOverride } from "../typesafe/client";

export const DEFAULT_MODEL = process.env.OPENAI_MODEL || "gpt-6-astra";
/** Long-established, universally-available model — the safety net when a newer/rolling-out model (like the flagship default above) 404s or 400s for an account that doesn't have it yet, or rejects a request shape it doesn't support. */
export const FALLBACK_MODEL = "gpt-4o-mini";
export const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";
/** The Responses API: the one that accepts function tools together with reasoning, and returns a summary of the reasoning. */
export const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
/** How long any one OpenAI call may run before it is abandoned, so a stalled connection cannot hold a request open. */
export const OPENAI_TIMEOUT_MS = 60_000;
/** A reasoning pass over a dozen questions takes longer than a plain tool call, so it gets more room before it is abandoned. */
export const OPENAI_REASONING_TIMEOUT_MS = 120_000;

export const REASONING_EFFORTS = ["none", "minimal", "low", "medium", "high"] as const;
export type ReasoningEffort = (typeof REASONING_EFFORTS)[number];
export const DEFAULT_REASONING_EFFORT: ReasoningEffort = "medium";

/** How hard OpenAI's reasoning models think about the turn's judgments: `OPENAI_REASONING_EFFORT`, or medium. "none" turns reasoning off. */
export function reasoningEffort(env: string | undefined = process.env.OPENAI_REASONING_EFFORT): ReasoningEffort {
  const wanted = env?.trim().toLowerCase();
  return (REASONING_EFFORTS as readonly string[]).includes(wanted ?? "") ? (wanted as ReasoningEffort) : DEFAULT_REASONING_EFFORT;
}

/** The plain-words error for a failed OpenAI fetch: a timeout says so instead of surfacing the runtime's "The operation was aborted". */
export function describeFetchError(err: unknown, timeoutMs: number = OPENAI_TIMEOUT_MS): string {
  const e = err as Error | undefined;
  if (e?.name === "TimeoutError" || e?.name === "AbortError") return `OpenAI did not answer within ${timeoutMs / 1000}s`;
  return e?.message || "OpenAI request failed";
}

/**
 * Reasoning-family models (o-series, gpt-5+) spend reasoning tokens on tool calls, and /v1/chat/completions rejects
 * that outright ("Function tools with reasoning_effort are not supported ... set reasoning_effort to 'none'"). So the
 * judgments go through the Responses API, where reasoning and a forced function call work together and the model
 * returns a summary of what it reasoned. If that API refuses the request, the call falls back to chat completions with
 * reasoning explicitly off (rather than whatever the API defaults to) and the result says reasoning was unavailable.
 */
const REASONING_MODEL_PREFIXES = ["o1", "o3", "o4", "gpt-5", "gpt-6"];
export function isReasoningModel(model: string): boolean {
  return REASONING_MODEL_PREFIXES.some((p) => model.startsWith(p));
}

/** True for the class of errors that mean "this exact model/request shape isn't callable," as opposed to auth/rate-limit/network failures a fallback model wouldn't fix either. */
export function looksLikeModelUnavailable(status: number, body: string): boolean {
  if (status !== 400 && status !== 404) return false;
  return /model|reasoning_effort|function tool/i.test(body);
}

/** A user-supplied key (Settings modal) always takes priority over OPENAI_API_KEY for that request. */
export function isOpenAIConfigured(override?: KeyOverride): boolean {
  return Boolean(override?.apiKey?.trim()) || Boolean(process.env.OPENAI_API_KEY);
}

const SYSTEM_PROMPT =
  "You are evaluating a single turn of a legal-context intake conversation. You will be given " +
  "the current state as JSON and a tool that records every judgment needed this turn. Call the " +
  "tool exactly once, filling in every field it defines — including a self-reported confidence " +
  "(0-1) for each judgment. Base every answer only on the provided state.";

/**
 * Runs the SAME question set the orchestrator sent to TypeSafe through
 * OpenAI's chat-completions API instead, using function calling (with
 * Structured Outputs' `strict` mode, so arguments are schema-valid) to get
 * an equivalent set of judgments. This is what makes the "TypeSafe vs
 * OpenAI-style" comparison a live measurement instead of a structural
 * estimate: same state, same questions, two real backends, both actually
 * called and both actually measured.
 *
 * Returns `{ ok: false, reason: "not_configured" }` when no key is
 * available — neither `OPENAI_API_KEY` nor a user-supplied one — this is an
 * opt-in comparison, not a hard dependency of the app.
 */
type AttemptResult =
  | { ok: true; result: OpenAIRunResult }
  | { ok: false; status: number | null; message: string };

type Schema = ReturnType<typeof buildFunctionCallingSchema>;

/** The answers a tool call's arguments hold: each question's value and the confidence the model reported beside it. */
function readAnswers(args: string, questions: Record<string, QuestionSpec>): OpenAIRunResult["answers"] {
  const raw = JSON.parse(args) as Record<string, unknown>;
  const answers: OpenAIRunResult["answers"] = {};
  for (const id of Object.keys(questions)) {
    const value = raw[id];
    if (value === undefined) continue;
    const conf = raw[`${id}_confidence`];
    answers[id] = { value: value as string | number | boolean, selfReportedConfidence: typeof conf === "number" ? conf : null };
  }
  return answers;
}

/** One forced function call through chat completions. Reasoning models are told not to reason, since this endpoint refuses function tools otherwise. */
async function attemptChat(model: string, apiKey: string, schema: Schema, questions: Record<string, QuestionSpec>, state: State): Promise<AttemptResult> {
  const started = performance.now();
  const requestBody = {
    model,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: JSON.stringify(state) },
    ],
    tools: [{ type: "function", function: { ...schema, strict: true } }],
    tool_choice: { type: "function", function: { name: schema.name } },
    ...(isReasoningModel(model) ? { reasoning_effort: "none" } : {}),
  };
  const requestBytes = Buffer.byteLength(JSON.stringify(requestBody), "utf8");
  try {
    const res = await fetch(OPENAI_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(OPENAI_TIMEOUT_MS),
    });
    const elapsedMs = Math.round(performance.now() - started);
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { ok: false, status: res.status, message: `OpenAI ${res.status}: ${body.slice(0, 300)}` };
    }
    const data = await res.json();
    const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall) return { ok: false, status: null, message: "No tool call in OpenAI response" };
    return {
      ok: true,
      result: {
        model: data.model ?? model,
        answers: readAnswers(toolCall.function.arguments, questions),
        usage: { input_tokens: data.usage?.prompt_tokens ?? 0, output_tokens: data.usage?.completion_tokens ?? 0 },
        elapsedMs,
        source: "live",
        requestBytes,
      },
    };
  } catch (err) {
    return { ok: false, status: null, message: describeFetchError(err) };
  }
}

/** The text of the reasoning summary a Responses API reply carries, or null when the model returned none. */
export function readReasoningSummary(output: unknown): string | null {
  if (!Array.isArray(output)) return null;
  const parts: string[] = [];
  for (const item of output) {
    if (item?.type !== "reasoning" || !Array.isArray(item.summary)) continue;
    for (const part of item.summary) if (typeof part?.text === "string" && part.text.trim()) parts.push(part.text.trim());
  }
  return parts.length ? parts.join("\n\n") : null;
}

/**
 * The same forced function call through the Responses API, with the model's reasoning on. Output tokens include the
 * reasoning tokens (they are billed as output), so the cost computed from `usage` covers the thinking too.
 */
async function attemptReasoning(model: string, apiKey: string, schema: Schema, questions: Record<string, QuestionSpec>, state: State, effort: ReasoningEffort): Promise<AttemptResult> {
  const started = performance.now();
  const requestBody = {
    model,
    instructions: SYSTEM_PROMPT,
    input: JSON.stringify(state),
    tools: [{ type: "function", name: schema.name, description: schema.description, parameters: schema.parameters, strict: true }],
    tool_choice: { type: "function", name: schema.name },
    reasoning: { effort, summary: "auto" },
  };
  const requestBytes = Buffer.byteLength(JSON.stringify(requestBody), "utf8");
  try {
    const res = await fetch(OPENAI_RESPONSES_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(OPENAI_REASONING_TIMEOUT_MS),
    });
    const elapsedMs = Math.round(performance.now() - started);
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { ok: false, status: res.status, message: `OpenAI ${res.status}: ${body.slice(0, 300)}` };
    }
    const data = await res.json();
    const call = Array.isArray(data.output) ? data.output.find((o: { type?: string }) => o?.type === "function_call") : undefined;
    if (!call) return { ok: false, status: null, message: "No function call in OpenAI response" };
    const reasoningTokens = data.usage?.output_tokens_details?.reasoning_tokens;
    return {
      ok: true,
      result: {
        model: data.model ?? model,
        answers: readAnswers(call.arguments, questions),
        usage: { input_tokens: data.usage?.input_tokens ?? 0, output_tokens: data.usage?.output_tokens ?? 0 },
        elapsedMs,
        source: "live",
        requestBytes,
        reasoning: { effort, summary: readReasoningSummary(data.output), tokens: typeof reasoningTokens === "number" ? reasoningTokens : null },
      },
    };
  } catch (err) {
    return { ok: false, status: null, message: describeFetchError(err, OPENAI_REASONING_TIMEOUT_MS) };
  }
}

/**
 * One attempt on one model. A reasoning model thinks first (Responses API); if that API refuses the request the same model
 * answers without reasoning, and the result carries why. Other failures (auth, rate limit, a timeout) are returned as they are:
 * dropping reasoning would not fix them, and quietly answering without it would hide a slow or failing call.
 */
async function attemptCall(model: string, apiKey: string, schema: Schema, questions: Record<string, QuestionSpec>, state: State): Promise<AttemptResult> {
  const effort = reasoningEffort();
  if (!isReasoningModel(model)) return attemptChat(model, apiKey, schema, questions, state);
  if (effort === "none") {
    const plain = await attemptChat(model, apiKey, schema, questions, state);
    return plain.ok ? { ok: true, result: { ...plain.result, reasoning: { effort: "none", summary: null, tokens: null, note: "Reasoning is turned off (OPENAI_REASONING_EFFORT=none)." } } } : plain;
  }
  const thought = await attemptReasoning(model, apiKey, schema, questions, state, effort);
  if (thought.ok || ![400, 404, 422].includes(thought.status ?? 0)) return thought;
  const plain = await attemptChat(model, apiKey, schema, questions, state);
  return plain.ok
    ? { ok: true, result: { ...plain.result, reasoning: { effort: "none", summary: null, tokens: null, note: `Reasoning was not available for this request, so ${model} answered without it (${thought.message}).` } } }
    : plain; // its error is the one the caller reads to decide whether the model itself is unavailable
}

export async function runOpenAIEquivalent(
  state: State,
  questions: Record<string, QuestionSpec>,
  override?: KeyOverride
): Promise<OpenAIRunOutcome> {
  const apiKey = override?.apiKey?.trim() || process.env.OPENAI_API_KEY;
  if (!apiKey) return { ok: false, reason: "not_configured" };
  const model = override?.model?.trim() || DEFAULT_MODEL;

  const schema = buildFunctionCallingSchema(questions);
  const first = await attemptCall(model, apiKey, schema, questions, state);
  if (first.ok) return { ok: true, result: first.result };

  // A brand-new flagship model can 400/404 for accounts that don't have
  // access yet (staged rollouts) — that's not a real integration failure,
  // so retry once against a model every account can call before giving up.
  if (model !== FALLBACK_MODEL && looksLikeModelUnavailable(first.status ?? 0, first.message)) {
    const retry = await attemptCall(FALLBACK_MODEL, apiKey, schema, questions, state);
    if (retry.ok) {
      return { ok: true, result: { ...retry.result, fallbackFrom: model } };
    }
    return {
      ok: false,
      reason: "error",
      message: `${model} unavailable (${first.message}); fallback to ${FALLBACK_MODEL} also failed: ${retry.message}`,
    };
  }

  return { ok: false, reason: "error", message: first.message };
}

// Re-exported so callers that only need the result shape don't reach into ./types directly.
export type { OpenAIRunResult } from "./types";
