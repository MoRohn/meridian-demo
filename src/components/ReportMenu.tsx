"use client";

import { useState } from "react";
import { REPORT_FORMATS } from "@/lib/report/formats";
import type { ReportFormat } from "@/lib/report/doc";
import { useDialog } from "@/lib/useDialog";
import { Icon } from "./Icon";

/**
 * The header's Download report button. It opens a small popover to choose the file format (a web page by default, or PDF,
 * Word, Markdown). Building a PDF or Word file takes a moment, so the chosen row shows it is working, and a failure is
 * said in the popover rather than lost.
 */
export function ReportMenu({ disabled, onDownload }: { disabled: boolean; onDownload: (format: ReportFormat) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<ReportFormat | null>(null);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useDialog(open, () => setOpen(false));

  async function choose(format: ReportFormat) {
    setBusy(format);
    setError(null);
    try {
      await onDownload(format);
      setOpen(false);
    } catch (err) {
      setError((err as Error).message || "The report could not be created.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="relative">
      <button
        onClick={() => {
          setError(null);
          setOpen((o) => !o);
        }}
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label="Download report"
        title={disabled ? "Download report (available once a model has been called)" : "Download report: evaluation table, scoring and trace"}
        className="flex h-9 items-center justify-center gap-1.5 rounded-full text-secondary transition-colors hover:bg-surface-hover hover:text-deep disabled:pointer-events-none disabled:opacity-40 max-xl:w-9 xl:border xl:border-border-strong xl:px-3 xl:text-sm xl:font-medium"
      >
        <Icon name="download" size={18} />
        <span className="hidden xl:inline">Download report</span>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-30" aria-hidden onPointerDown={() => setOpen(false)} />
          <div
            ref={dialogRef}
            role="dialog"
            aria-label="Download report"
            tabIndex={-1}
            className="animate-in absolute right-0 top-full z-40 mt-2 w-[20rem] rounded-2xl border border-border bg-surface p-2 shadow-xl outline-none max-sm:fixed max-sm:inset-x-3 max-sm:top-14 max-sm:mt-0 max-sm:w-auto"
          >
            <h2 className="px-2.5 pb-1 pt-1.5 text-sm font-extrabold text-deep">Download report as</h2>
            <ul className="space-y-0.5">
              {REPORT_FORMATS.map((f) => (
                <li key={f.id}>
                  <button
                    onClick={() => void choose(f.id)}
                    disabled={busy !== null}
                    className="flex w-full items-start gap-2.5 rounded-xl px-2.5 py-2 text-left transition-colors hover:bg-surface-hover disabled:opacity-60"
                  >
                    <Icon name={busy === f.id ? "loader" : "document"} size={18} className="mt-0.5 text-deep" />
                    <span className="min-w-0">
                      <span className="block text-sm font-bold text-foreground">{f.label}</span>
                      <span className="block text-xs leading-snug text-muted">{f.hint}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            {error && (
              <p role="alert" className="mx-1 mt-1.5 rounded-lg border border-rose-600/30 bg-rose-600/[0.06] px-2.5 py-2 text-xs text-rose-900">
                {error}
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
