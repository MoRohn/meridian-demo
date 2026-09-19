/**
 * Whether a user's API key may be forwarded to the eval service at this address. A key is only ever sent over an
 * encrypted connection or to this machine itself; forwarding it in plaintext to a remote host would expose it.
 */
export function isSafeKeyTransport(serviceUrl: string): boolean {
  try {
    const url = new URL(serviceUrl);
    if (url.protocol === "https:") return true;
    return url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]", "::1"].includes(url.hostname);
  } catch {
    return false;
  }
}

/** Masks a key wherever it appears in text that may be shown to a reader. */
export function redactKey(text: string, key: unknown): string {
  return typeof key === "string" && key.length > 0 ? text.split(key).join("[redacted]") : text;
}

/** Keys the service will accept: printable ASCII without whitespace, 16 to 300 characters (mirrors eval-service/main.py). */
export function isPlausibleKey(key: unknown): key is string {
  return typeof key === "string" && /^[\x21-\x7e]{16,300}$/.test(key);
}
