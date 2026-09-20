import { createSession, type SessionState } from "../orchestrator/state";

/**
 * In-memory, process-local session store. This is intentionally the
 * simplest thing that works for a demo running one dev/preview instance —
 * swap this module for a Redis or DynamoDB-backed store behind the same
 * exported functions to run this multi-instance in production (see
 * docs/production.md). Everything upstream (the orchestrator, the API route)
 * only depends on this file's exports, so that swap touches nothing else.
 *
 * The store is bounded so a caller minting session ids cannot grow the process without limit: idle sessions expire, and
 * past MAX_SESSIONS the least recently used one is dropped. A dropped session simply starts over on its next request.
 */
export const MAX_SESSIONS = 500;
export const SESSION_TTL_MS = 60 * 60 * 1000;

/** Map iteration order is insertion order, so the first entry is always the least recently used. */
const sessions = new Map<string, { session: SessionState; touchedAt: number }>();

function touch(id: string, session: SessionState, now: number): void {
  sessions.delete(id);
  sessions.set(id, { session, touchedAt: now });
}

function evict(now: number): void {
  for (const [id, entry] of sessions) {
    if (now - entry.touchedAt <= SESSION_TTL_MS) break; // ordered by recency, so nothing after this one is expired either
    sessions.delete(id);
  }
  while (sessions.size > MAX_SESSIONS) {
    const oldest = sessions.keys().next().value;
    if (oldest === undefined) break;
    sessions.delete(oldest);
  }
}

export function getOrCreateSession(id: string, now: number = Date.now()): SessionState {
  const existing = sessions.get(id);
  const live = existing && now - existing.touchedAt <= SESSION_TTL_MS ? existing.session : undefined;
  const session = live ?? createSession(id);
  touch(id, session, now);
  evict(now);
  return session;
}

export function resetSession(id: string, now: number = Date.now()): SessionState {
  const session = createSession(id);
  touch(id, session, now);
  evict(now);
  return session;
}

/** How many sessions are held right now (for tests and monitoring). */
export function sessionCount(): number {
  return sessions.size;
}

/** Drops every session (for tests). */
export function clearSessions(): void {
  sessions.clear();
}
