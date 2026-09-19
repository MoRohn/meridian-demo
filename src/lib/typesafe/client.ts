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
import { TypeSafeClient } from "@typesafe-ai/sdk";
import { mockSystemOne } from "./mock";
import type { QuestionSpec, State, SystemOneResponse } from "./types";

const DEFAULT_MODEL = process.env.TYPESAFE_MODEL || "jev-latest";

export interface KeyOverride {
  apiKey?: string;
  model?: string;
}

// The env-based client is cached (it can't change at runtime); a
// user-supplied key gets a fresh, uncached client per call, since different
// browsers/tabs can supply different keys.
let envClient: TypeSafeClient | null | undefined;

function getEnvClient(): TypeSafeClient | null {
  if (envClient !== undefined) return envClient;
  const apiKey = process.env.TYPESAFE_API_KEY;
  if (!apiKey) {
    envClient = null;
    return envClient;
  }
  try {
    envClient = new TypeSafeClient({ apiKey, defaultModel: DEFAULT_MODEL });
  } catch {
    envClient = null;
  }
  return envClient;
}

export function isLive(override?: KeyOverride): boolean {
  return Boolean(override?.apiKey?.trim()) || getEnvClient() !== null;
}

export async function systemOne(
  state: State,
  questions: Record<string, QuestionSpec>,
  override?: KeyOverride
): Promise<SystemOneResponse> {
  const model = override?.model?.trim() || DEFAULT_MODEL;
  const userKey = override?.apiKey?.trim();

  let c: TypeSafeClient | null;
  if (userKey) {
    try {
      c = new TypeSafeClient({ apiKey: userKey, defaultModel: model });
    } catch {
      c = null;
    }
  } else {
    c = getEnvClient();
  }

  const started = performance.now();
  if (!c) {
    const result = mockSystemOne(state, questions, model);
    return { ...result, elapsedMs: Math.round(performance.now() - started) };
  }
  try {
    // The raw object shape (as opposed to the choice()/noul()/score() helpers)
    // is accepted directly by the API and is a better fit here: the
    // orchestrator assembles a different set of questions on every turn.
    const result = await c.systemOne({
      state: state as never,
      questions: questions as never,
      model,
    });
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
    console.error("[typesafe] live call failed, falling back to mock:", err);
    const result = mockSystemOne(state, questions, model);
    return { ...result, elapsedMs: Math.round(performance.now() - started) };
  }
}
