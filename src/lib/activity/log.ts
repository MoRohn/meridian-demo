/**
 * A session log of every model call the app makes, one record per call. It is the single source of truth for the header
 * timers, the activity windows, the activity trace and the cross-model performance figures, so they can never disagree.
 *
 * Each call gets its own record with its own start time. That is what makes a timer reset with every action: a timer is
 * derived from ONE record (now minus its start while it runs, its measured time once it has finished), so starting a new
 * action starts a new timer from zero, and an older call finishing late can only ever update its own record.
 *
 * Kept outside React (like the evaluation store) so it outlives tab switches; components subscribe to it.
 */
export type ActivityActor = "typesafe" | "openai" | "judge";
export type ActivityKind = "chat" | "excerpt" | "citation" | "evaluation";
export type ActivityState = "pending" | "done" | "error";

export interface ActivityRecord {
  id: number;
  actor: ActivityActor;
  kind: ActivityKind;
  /** What was being done, in a few words ("Analyze this contract", "Risk score evaluation"). */
  label: string;
  status: ActivityState;
  startedAt: number;
  endedAt: number | null;
  /** The model's own measured time when the server reported one; otherwise wall-clock is used. */
  modelMs: number | null;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
  /** A judge call's 0..1 score. */
  score?: number;
  /** No real model call is behind this (the local demo heuristic, or a backend that is not configured): timed, but left out of performance figures. */
  simulated?: boolean;
  /** Why a call failed, or anything else worth showing beside it. */
  note?: string;
}

export type ActivityFinish = Partial<Pick<ActivityRecord, "modelMs" | "model" | "inputTokens" | "outputTokens" | "costUsd" | "score" | "note" | "simulated">> & {
  status: "done" | "error";
};

const MAX_RECORDS = 200;

let records: ActivityRecord[] = [];
let nextId = 1;
const listeners = new Set<() => void>();

function commit(next: ActivityRecord[]) {
  records = next;
  listeners.forEach((l) => l());
}

export const activityLog = {
  /** Starts a new activity and returns its id. Its timer starts from zero right now. */
  begin(actor: ActivityActor, kind: ActivityKind, label: string, now: number = Date.now()): number {
    const id = nextId++;
    const record: ActivityRecord = { id, actor, kind, label, status: "pending", startedAt: now, endedAt: null, modelMs: null };
    commit([...records, record].slice(-MAX_RECORDS));
    return id;
  },
  /** Finishes one activity. An id that is unknown (the session was reset meanwhile) or already finished is ignored. */
  finish(id: number, result: ActivityFinish, now: number = Date.now()) {
    const at = records.findIndex((r) => r.id === id);
    if (at === -1 || records[at].status !== "pending") return;
    const { modelMs, ...rest } = result;
    const next = records.slice();
    next[at] = { ...records[at], ...rest, modelMs: modelMs ?? null, endedAt: now };
    commit(next);
  },
  /** Every record, oldest first. The same array is returned until something changes, so it is safe as a store snapshot. */
  list: (): readonly ActivityRecord[] => records,
  /** A new session starts with no history and nothing running: in-flight calls from before can no longer touch it. */
  reset() {
    commit([]);
  },
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => void listeners.delete(listener);
  },
};

/**
 * The record a timer for `actor` should show: whatever is running (the one started most recently, if several overlap),
 * otherwise the last one that finished. An older call finishing can therefore never take over a newer call's timer.
 */
export function currentActivity(all: readonly ActivityRecord[], actor: ActivityActor): ActivityRecord | null {
  let pending: ActivityRecord | null = null;
  let last: ActivityRecord | null = null;
  for (const r of all) {
    if (r.actor !== actor) continue;
    last = r;
    if (r.status === "pending") pending = r;
  }
  return pending ?? last;
}

/** How long a call has taken: the running clock while it is in flight, the measured time once it is done. */
export function elapsedOf(record: ActivityRecord, now: number): number {
  if (record.status === "pending") return Math.max(0, now - record.startedAt);
  return record.modelMs ?? Math.max(0, (record.endedAt ?? record.startedAt) - record.startedAt);
}

export function formatElapsed(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}
