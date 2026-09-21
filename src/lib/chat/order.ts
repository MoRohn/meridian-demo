/** Which backend's findings a chat reply was composed from. */
export type ChatBackend = "typesafe" | "openai";

export const BACKEND_NAMES: Record<ChatBackend, string> = { typesafe: "TypeSafe", openai: "OpenAI" };

interface Reply {
  backend?: ChatBackend;
  /** Groups the replies to one question. */
  turn?: number;
  /** The backend failed, so there is no answer here to rank. */
  failed?: boolean;
}

/** "1st", "2nd", "3rd"… for the finish-order chip. */
export function ordinal(n: number): string {
  const teen = n % 100 >= 11 && n % 100 <= 13;
  const suffix = teen ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th";
  return `${n}${suffix}`;
}

/**
 * Where each reply finished among the replies to the same question. Replies are appended as each backend completes, so
 * array order is finish order. A rank is only given when two or more backends answered that question, and a failed call
 * has none: an error that came back quickly did not "win".
 */
export function finishRanks(messages: readonly Reply[]): (number | null)[] {
  const answered = new Map<number, number>();
  const total = new Map<number, number>();
  for (const m of messages) {
    if (m.backend && m.turn != null) total.set(m.turn, (total.get(m.turn) ?? 0) + 1);
  }
  return messages.map((m) => {
    if (!m.backend || m.turn == null || m.failed || (total.get(m.turn) ?? 0) < 2) return null;
    const rank = (answered.get(m.turn) ?? 0) + 1;
    answered.set(m.turn, rank);
    return rank;
  });
}

/** "766ms model reasoning · 12.2s LLM response": what the card's total time is made of, so it reconciles with the Trace tab. */
export function describeTiming(backend: ChatBackend, parts: { modelMs?: number; answerMs?: number }, format: (ms: number) => string): string | null {
  const pieces: string[] = [];
  if (parts.modelMs != null) pieces.push(`${format(parts.modelMs)} model reasoning`);
  if (parts.answerMs != null) pieces.push(`${format(parts.answerMs)} LLM response`);
  return pieces.length ? pieces.join(" · ") : null;
}
