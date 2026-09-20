import type { Judged } from "./batch";
import type { Extraction } from "./extract";

/**
 * Session-level memory for citation runs, outside React (like the evaluation store and the activity log): the tab's content
 * remounts whenever a tab is switched, and a run is one paid batch of model calls per backend, so its results have to
 * outlive the tab. A run is keyed by what it read (which document, the whole or a highlighted passage), so switching between
 * a selection and the whole document finds each one's results again, and a run starts at most once per key.
 */
export type SideStatus = "idle" | "pending" | "done" | "error" | "skipped";

export interface SideRun {
  status: SideStatus;
  judged: Record<string, Judged>;
  model?: string;
  source?: "live" | "mock";
  elapsedMs?: number;
  usage?: { input_tokens: number; output_tokens: number };
  /** The model that was asked for, when another one judged because it was not available on the key. */
  fallbackFrom?: string;
  reason?: "not_configured" | "error";
  message?: string;
}

export interface CitationRun {
  sig: string;
  extraction: Extraction;
  typesafe: SideRun;
  openai: SideRun;
  /**
   * Which request each side's answer belongs to. A side re-run (Re-check, or a Retry of just one model) gets a new number,
   * and a slow answer to an earlier request that lands afterwards carries the old one and is ignored.
   */
  tokens: { typesafe: number; openai: number };
}

export const emptySide = (status: SideStatus = "idle"): SideRun => ({ status, judged: {} });

/** A short stable fingerprint of a text, for keys. */
export function hash(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

/** What a run read: the document (by id) and either the whole of it or one highlighted passage. */
export const citationSig = (documentKey: string, scope: "document" | "excerpt", text: string) => `${documentKey}|${scope}|${hash(text)}`;

const MAX_RUNS = 12;
const runs = new Map<string, CitationRun>();
const claimed = new Set<string>();
const listeners = new Set<() => void>();
let version = 0;
const emit = () => {
  version += 1;
  listeners.forEach((l) => l());
};

export const citationStore = {
  get: (sig: string): CitationRun | undefined => runs.get(sig),
  set(run: CitationRun) {
    runs.delete(run.sig); // most recently written last, so the oldest is the one dropped
    runs.set(run.sig, run);
    while (runs.size > MAX_RUNS) runs.delete(runs.keys().next().value as string);
    emit();
  },
  /** Applies a change to a run if it is still there; a run cleared by a reset meanwhile is left alone. */
  update(sig: string, change: (run: CitationRun) => CitationRun) {
    const run = runs.get(sig);
    if (run) {
      runs.set(sig, change(run));
      emit();
    }
  },
  /** True the first time a key is claimed, false after: the guard that makes a run start once even if the tab renders twice. */
  claim(sig: string): boolean {
    if (claimed.has(sig)) return false;
    claimed.add(sig);
    return true;
  },
  /** Forgets one run so the next visit runs it again. */
  drop(sig: string) {
    runs.delete(sig);
    claimed.delete(sig);
    emit();
  },
  /** A new session starts clean. */
  reset() {
    runs.clear();
    claimed.clear();
    emit();
  },
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => void listeners.delete(listener);
  },
  version: () => version,
};
