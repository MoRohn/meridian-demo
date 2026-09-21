/**
 * How the browser calls Meridian's own API. Every call has a deadline, so a stalled server or model can never leave a panel
 * spinning for good, and every failure comes back as an Error whose message is written for the reader.
 *
 * The deadlines sit above what the server itself allows a call to take, so the server's own, more specific "no answer
 * within Ns" wins when there is one. They are the last resort, not the expected limit.
 */

/** Routes that only ask TypeSafe (the server gives it 45s in all). */
export const FAST_REQUEST_TIMEOUT_MS = 60_000;
/** Routes that can involve OpenAI, whose reasoning pass alone may take two minutes, or a model writing a reply. */
export const SLOW_REQUEST_TIMEOUT_MS = 300_000;

export class RequestTimeoutError extends Error {
  constructor(readonly timeoutMs: number) {
    super(`No answer within ${Math.round(timeoutMs / 1000)}s. The model or the server is not responding; try again.`);
    this.name = "RequestTimeoutError";
  }
}

const isTimeout = (err: unknown) => (err as Error | undefined)?.name === "TimeoutError" || (err as Error | undefined)?.name === "AbortError";

/**
 * POSTs JSON and returns the parsed reply. Throws a `RequestTimeoutError` when the deadline passes, and otherwise an Error with
 * the server's own `error` message (or "Request failed (status)"). A reply that is not JSON is an error, not `undefined`.
 */
export async function postJson<T = unknown>(url: string, body: unknown, options: { timeoutMs: number; signal?: AbortSignal }): Promise<T> {
  const deadline = AbortSignal.timeout(options.timeoutMs);
  const signal = options.signal ? AbortSignal.any([options.signal, deadline]) : deadline;
  let res: Response;
  try {
    res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error((data as { error?: string } | null)?.error ?? `Request failed (${res.status})`);
    if (data === null) throw new Error(`The server sent an unreadable reply (${res.status})`);
    return data as T;
  } catch (err) {
    // A caller that cancelled on purpose is not a timeout; only the deadline is.
    if (isTimeout(err) && deadline.aborted && !options.signal?.aborted) throw new RequestTimeoutError(options.timeoutMs);
    throw err;
  }
}
