/** Saves a file through the browser. Client-only: it needs a DOM. */
export function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Revoked on the next turn so the browser has started the download first.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
