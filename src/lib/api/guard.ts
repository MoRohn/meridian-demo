import { NextResponse, type NextRequest } from "next/server";

/**
 * What every API route shares: the error contract, the input limits, and the checks that stand between an anonymous caller
 * and a paid model call.
 *
 * The error contract. A request that cannot be served answers with an HTTP error status and `{ error: string }`: 400 for a
 * malformed request, 404 for something that does not exist, 413/422 for a file that cannot be read, 429 for too many
 * requests, 500 (with a fixed, non-revealing message) for a bug. A request that WAS served but whose model call failed is
 * not an HTTP error: it answers 200 with the outcome as data (`{ ok: false, reason, message }`, see /api/citations and
 * /api/compare-openai), because one backend failing is a result the page shows next to the other backend's answer.
 *
 * Meridian has no user accounts, and the keys a reader saves in Settings travel with each request, so a session id is a
 * capability, not an identity: whoever holds the (random, unguessable) id holds the session. What bounds a caller who does
 * not hold one is the origin check and the rate limit below. Real authentication is the production change; see docs/production.md.
 */

export function apiError(message: string, status: number, headers?: HeadersInit): NextResponse {
  return NextResponse.json({ error: message }, { status, headers });
}

// ---- input limits -----------------------------------------------------------------------------------------------------------

/** A document the model can read (mirrors /api/extract, which cannot produce more than this). */
export const MAX_DOCUMENT_CHARS = 100_000;
export const MAX_DOCUMENT_NAME_CHARS = 200;
export const MAX_MESSAGE_CHARS = 8_000;

/** Ids the browser mints with crypto.randomUUID (or the `sess-<time>-<random>` fallback in page.tsx). Long enough to be unguessable. */
export const SESSION_ID = /^[A-Za-z0-9_-]{16,80}$/;

export function isValidSessionId(value: unknown): value is string {
  return typeof value === "string" && SESSION_ID.test(value);
}

/** A display name for an uploaded document: a plain string, control characters dropped, trimmed, and never empty or over-long. */
export function cleanDocumentName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  return name && name.length <= MAX_DOCUMENT_NAME_CHARS ? name : null;
}

// ---- who may call -----------------------------------------------------------------------------------------------------------

/**
 * True when a browser is calling from a page on another site. Browsers always send `Origin` on a POST, so a page on any
 * other origin that tries to use a visitor's browser as a proxy for this API is refused. Callers that send no Origin
 * (curl, the e2e scripts, server-to-server) are not browsers being driven by a third-party page; the rate limit bounds them.
 */
export function isCrossSite(req: NextRequest): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return false;
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  try {
    return new URL(origin).host !== host;
  } catch {
    return true;
  }
}

export const RATE_LIMIT = 120;
export const RATE_WINDOW_MS = 60_000;
const MAX_TRACKED_CLIENTS = 5_000;

const windows = new Map<string, { count: number; resetAt: number }>();

/** Who is calling, as best a server can tell: the first hop of x-forwarded-for (set by the platform's proxy), else "local". */
export function clientKey(req: NextRequest): string {
  const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || req.headers.get("x-real-ip")?.trim() || "local";
}

/** Counts one call for `key` in a fixed window. Returns the seconds to wait when the limit is spent, else null. */
export function takeToken(key: string, now: number = Date.now(), limit: number = RATE_LIMIT): number | null {
  if (windows.size >= MAX_TRACKED_CLIENTS) {
    for (const [k, w] of windows) if (w.resetAt <= now) windows.delete(k);
    while (windows.size >= MAX_TRACKED_CLIENTS) {
      const oldest = windows.keys().next().value;
      if (oldest === undefined) break;
      windows.delete(oldest);
    }
  }
  const current = windows.get(key);
  if (!current || current.resetAt <= now) {
    windows.set(key, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return null;
  }
  current.count += 1;
  return current.count > limit ? Math.max(1, Math.ceil((current.resetAt - now) / 1000)) : null;
}

/** Clears the counters (for tests). */
export function resetRateLimits(): void {
  windows.clear();
}

/**
 * The gate every route that can spend money or read a document goes through, first thing: a response to send back
 * (403 from another site, 429 past the limit), or null to carry on.
 */
export function guardApi(req: NextRequest): NextResponse | null {
  if (isCrossSite(req)) return apiError("Cross-site requests are not allowed", 403);
  const wait = takeToken(clientKey(req));
  if (wait !== null) return apiError("Too many requests. Wait a moment and try again.", 429, { "Retry-After": String(wait) });
  return null;
}
