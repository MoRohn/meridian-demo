/**
 * Single entry point the rest of the app uses to reach a Jev model.
 *
 * When a TypeSafe API key is available — either `TYPESAFE_API_KEY` in the
 * environment, or one entered by the user in the Settings modal (⚙ in the
 * header, stored client-side, sent per-request — see
 * src/lib/settings.ts) — every call goes to the real Jev model via
 * @typesafe-ai/sdk's TypeSafeClient. Otherwise it transparently falls back
 * to the local heuristic mock in mock.ts so the app runs end-to-end without
 * credentials. Callers never branch on this — they get back the same
 * `SystemOneResponse` shape either way, tagged with `source` so the UI can
 * be transparent about which one answered.
 *
 * A user-supplied key always takes priority over the environment variable
 * for that request — that's the point of letting someone paste a key into
 * the UI at all.
 */
import {
  APIConnectionError,
  APIError,
  APITimeoutError,
  APIUserAbortError,
  AuthenticationError,
  NotFoundError,
  PermissionDeniedError,
  RateLimitError,
  TypeSafeClient,
  TypeSafeError,
} from "@typesafe-ai/sdk";
import { mockSystemOne } from "./mock";
import type { QuestionSpec, State, SystemOneResponse } from "./types";

const DEFAULT_MODEL = process.env.TYPESAFE_MODEL || "jev-latest";

/**
 * The SDK's own limits are per attempt (10s, two retries, and a server's Retry-After honoured for up to a minute), with no
 * total budget, so a slow or rate-limiting service could hold a request far longer than any single number suggests. These are
 * set here, explicitly: each attempt gets 20s, one retry, and the whole call, backoff included, is cut off at 45s.
 */
export const TYPESAFE_ATTEMPT_TIMEOUT_MS = 20_000;
export const TYPESAFE_TOTAL_TIMEOUT_MS = 45_000;
const CLIENT_LIMITS = { timeout: TYPESAFE_ATTEMPT_TIMEOUT_MS, retry: { maxRetries: 1 } } as const;

/**
 * Why a TypeSafe call failed, in words for the reader. It names the cause (a rejected key, a rate limit, a timeout) and never
 * echoes a response body or anything that could hold the key.
 */
export function describeTypesafeFailure(err: unknown, totalMs: number = TYPESAFE_TOTAL_TIMEOUT_MS): string {
  if (err instanceof AuthenticationError) return "TypeSafe rejected the API key (401). Check the key in Settings, or TYPESAFE_API_KEY.";
  if (err instanceof PermissionDeniedError) return "TypeSafe denied this key access (403).";
  if (err instanceof RateLimitError) return "TypeSafe is rate limiting this key (429).";
  if (err instanceof NotFoundError) return "TypeSafe does not recognise the requested model or endpoint (404).";
  if (err instanceof APITimeoutError) return `TypeSafe did not answer within ${Math.round(totalMs / 1000)}s.`;
  if (err instanceof APIUserAbortError) return "The request was cancelled before TypeSafe answered.";
  if (err instanceof APIError) return `TypeSafe returned an error (${err.status}).`;
  if (err instanceof APIConnectionError) return "Could not reach TypeSafe (a network error).";
  if (err instanceof TypeSafeError) return err.message;
  return "The TypeSafe call failed.";
}

export interface KeyOverride {
  apiKey?: string;
  model?: string;
}

// The env-based client is cached (it can't change at runtime); a
// user-supplied key gets a fresh, uncached client per call, since different
// browsers/tabs can supply different keys.
let envClient: TypeSafeClient | null | undefined;
/** Why the environment's key could not make a client, so the failure is reported instead of quietly treated as "no key". */
let envClientError: string | null = null;

function getEnvClient(): TypeSafeClient | null {
  if (envClient !== undefined) return envClient;
  const apiKey = process.env.TYPESAFE_API_KEY;
  if (!apiKey) {
    envClient = null;
    return envClient;
  }
  try {
    envClient = new TypeSafeClient({ apiKey, defaultModel: DEFAULT_MODEL, ...CLIENT_LIMITS });
  } catch (err) {
    envClient = null;
    envClientError = describeTypesafeFailure(err);
    console.error(`[typesafe] TYPESAFE_API_KEY is set but no client could be made: ${envClientError}`);
  }
  return envClient;
}

export function isLive(override?: KeyOverride): boolean {
  return Boolean(override?.apiKey?.trim()) || getEnvClient() !== null;
}

/** Answers from the local demo heuristic, for when there is no key or the live call could not be made. `reason` says which of the failures it was. */
function demoAnswers(state: State, questions: Record<string, QuestionSpec>, model: string, started: number, reason?: string): SystemOneResponse {
  const result = mockSystemOne(state, questions, model);
  return { ...result, elapsedMs: Math.round(performance.now() - started), ...(reason ? { fallbackReason: reason } : {}) };
}

/**
 * Asks TypeSafe the questions. With no key at all it answers from the local demo heuristic, by design. With a key that cannot
 * be used, or a live call that fails, it also falls back to the heuristic so the app keeps working, but says why in
 * `fallbackReason` (a rejected key, a timeout) so a misconfiguration is never mistaken for the real model. The call is cut off
 * after TYPESAFE_TOTAL_TIMEOUT_MS, and stops early, without falling back, when the caller's `signal` aborts.
 */
export async function systemOne(
  state: State,
  questions: Record<string, QuestionSpec>,
  override?: KeyOverride,
  signal?: AbortSignal,
): Promise<SystemOneResponse> {
  const model = override?.model?.trim() || DEFAULT_MODEL;
  const userKey = override?.apiKey?.trim();

  const started = performance.now();
  let c: TypeSafeClient | null;
  let unusable: string | undefined;
  if (userKey) {
    try {
      c = new TypeSafeClient({ apiKey: userKey, defaultModel: model, ...CLIENT_LIMITS });
    } catch (err) {
      c = null;
      unusable = describeTypesafeFailure(err);
    }
  } else {
    c = getEnvClient();
    if (!c && process.env.TYPESAFE_API_KEY) unusable = envClientError ?? undefined;
  }
  if (!c) {
    if (unusable) console.error(`[typesafe] using the demo heuristic: ${unusable}`);
    return demoAnswers(state, questions, model, started, unusable);
  }

  const budget = AbortSignal.timeout(TYPESAFE_TOTAL_TIMEOUT_MS);
  try {
    // The raw object shape (as opposed to the choice()/noul()/score() helpers)
    // is accepted directly by the API and is a better fit here: the
    // orchestrator assembles a different set of questions on every turn.
    const result = await c.systemOne(
      { state: state as never, questions: questions as never, model },
      { signal: signal ? AbortSignal.any([signal, budget]) : budget },
    );
    return {
      model: result.model,
      answers: result.answers as SystemOneResponse["answers"],
      usage: {
        input_tokens: result.usage?.input_tokens ?? 0,
        output_tokens: result.usage?.output_tokens ?? 0,
      },
      source: "live",
      elapsedMs: Math.round(performance.now() - started),
    };
  } catch (err) {
    if (signal?.aborted) throw err; // the caller went away: nothing is waiting for an answer, live or demo
    const reason = budget.aborted ? describeTypesafeFailure(new APITimeoutError(TYPESAFE_TOTAL_TIMEOUT_MS)) : describeTypesafeFailure(err);
    console.error(`[typesafe] live call failed, using the demo heuristic: ${reason}`);
    return demoAnswers(state, questions, model, started, reason);
  }
}
