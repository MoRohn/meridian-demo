/**
 * Human-readable size for the Context Window meter — real measured byte
 * counts (see `ContextStats`/`requestBytes`/`inputBytes`), not estimates.
 * Uses binary units (1 KB = 1024 B) since that's what every other dev tool
 * reports request/response sizes in.
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}
