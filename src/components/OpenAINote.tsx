import type { OpenAIRunOutcome } from "@/lib/openai/types";

/**
 * The trace/monitoring line for the OpenAI side of a comparison — shown
 * right below the measurement (probability bars, scores, flags) for
 * whichever task just ran, the same way TypeSafe's answers are never shown
 * without knowing which model produced them. Renders nothing when there's
 * nothing worth reporting (not configured, or a clean run on the requested
 * model) so it never adds noise to the common case.
 */
export function OpenAINote({ outcome }: { outcome: OpenAIRunOutcome | null | undefined }) {
  if (!outcome) return null;

  if (outcome.ok) {
    if (!outcome.result.fallbackFrom) return null;
    return (
      <div className="mt-2 flex items-start gap-1.5 rounded-lg border border-amber-600/30 bg-amber-600/[0.06] px-2.5 py-1.5">
        <span className="shrink-0 text-xs font-bold uppercase tracking-wide text-amber-800">Log:</span>
        <p className="text-xs font-semibold text-amber-800">
          Requested model <code className="font-mono">{outcome.result.fallbackFrom}</code> wasn&rsquo;t available on
          this key, fell back to <code className="font-mono">{outcome.result.model}</code>.
        </p>
      </div>
    );
  }

  if (outcome.reason === "not_configured") return null;

  return (
    <div className="mt-2 flex items-start gap-1.5 rounded-lg border border-rose-600/30 bg-rose-600/[0.06] px-2.5 py-1.5">
      <span className="shrink-0 text-xs font-bold uppercase tracking-wide text-rose-800">Log:</span>
      <p className="break-words font-mono text-xs text-rose-800">{outcome.message ?? "OpenAI call failed with no error detail."}</p>
    </div>
  );
}
