import { createSession, type SessionState } from "../orchestrator/state";

/**
 * In-memory, process-local session store. This is intentionally the
 * simplest thing that works for a demo running one dev/preview instance —
 * swap this module for a Redis or DynamoDB-backed store behind the same
 * three functions to run this multi-instance in production (see
 * docs/production.md). Everything upstream (the orchestrator, the API route)
 * only depends on this file's exports, so that swap touches nothing else.
 */
const sessions = new Map<string, SessionState>();

export function getOrCreateSession(id: string): SessionState {
  let session = sessions.get(id);
  if (!session) {
    session = createSession(id);
    sessions.set(id, session);
  }
  return session;
}

export function resetSession(id: string): SessionState {
  const session = createSession(id);
  sessions.set(id, session);
  return session;
}
