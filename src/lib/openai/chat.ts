import { DEFAULT_MODEL, FALLBACK_MODEL, OPENAI_API_URL, isReasoningModel, looksLikeModelUnavailable } from "./client";
import type { KeyOverride } from "../typesafe/client";

/**
 * Free-text generation through OpenAI's chat completions: the counterpart of the function-calling client in client.ts,
 * used to write chat answers. It takes the key and model saved in Meridian's Settings (a saved key always beats
 * OPENAI_API_KEY), and, like that client, retries once on a model every account can call when the chosen one is not
 * available to the account yet.
 */
export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

export type ChatOutcome =
  | { ok: true; text: string; model: string; usage: { input_tokens: number; output_tokens: number }; elapsedMs: number; fallbackFrom?: string }
  | { ok: false; reason: "not_configured" | "error"; message?: string };

const TIMEOUT_MS = 60_000;

async function attempt(model: string, apiKey: string, messages: ChatMessage[]): Promise<ChatOutcome & { status?: number }> {
  const started = performance.now();
  const reasoning = isReasoningModel(model);
  const body = {
    model,
    messages,
    // Reasoning models spend part of this budget thinking, so it has to leave room for the answer itself.
    max_completion_tokens: reasoning ? 6000 : 1200,
    ...(reasoning ? { reasoning_effort: "low" } : { temperature: 0.3 }),
  };
  try {
    const res = await fetch(OPENAI_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const elapsedMs = Math.round(performance.now() - started);
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { ok: false, reason: "error", status: res.status, message: `OpenAI ${res.status}: ${text.slice(0, 300)}` };
    }
    const data = await res.json();
    const text = String(data.choices?.[0]?.message?.content ?? "").trim();
    if (!text) return { ok: false, reason: "error", message: "OpenAI returned an empty answer" };
    return {
      ok: true,
      text,
      model: data.model ?? model,
      usage: { input_tokens: data.usage?.prompt_tokens ?? 0, output_tokens: data.usage?.completion_tokens ?? 0 },
      elapsedMs,
    };
  } catch (err) {
    return { ok: false, reason: "error", message: (err as Error).message };
  }
}

export async function chatCompletion(messages: ChatMessage[], override?: KeyOverride): Promise<ChatOutcome> {
  const apiKey = override?.apiKey?.trim() || process.env.OPENAI_API_KEY;
  if (!apiKey) return { ok: false, reason: "not_configured" };
  const model = override?.model?.trim() || DEFAULT_MODEL;

  const first = await attempt(model, apiKey, messages);
  if (first.ok) return first;
  if (model !== FALLBACK_MODEL && looksLikeModelUnavailable(first.status ?? 0, first.message ?? "")) {
    const retry = await attempt(FALLBACK_MODEL, apiKey, messages);
    if (retry.ok) return { ...retry, fallbackFrom: model };
    return { ok: false, reason: "error", message: `${model} unavailable (${first.message}); fallback to ${FALLBACK_MODEL} also failed: ${retry.message}` };
  }
  return { ok: false, reason: "error", message: first.message };
}
