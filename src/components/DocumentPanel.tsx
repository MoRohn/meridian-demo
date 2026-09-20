"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { SAMPLE_CONTRACTS } from "@/lib/data/sampleContracts";
import { differs, layoutFor, measureSheet, type SheetMetrics } from "@/lib/document/measure";
import { pageAt, paginate } from "@/lib/document/paginate";
import { Icon, type IconName } from "./Icon";

const DOC_ICONS: Record<string, IconName> = {
  "saas-msa-onesided": "document",
  "mutual-nda": "users",
  "employment-noncompete": "briefcase",
};

const ACCEPTED_EXTENSIONS = [".pdf", ".docx", ".txt"];
const MIN_ZOOM = 9;
const MAX_ZOOM = 30;
/** A document opens small/scaled-down — a preview, not a reading view — until the reader expands it. */
const PREVIEW_ZOOM = 11;
const READING_ZOOM = 17;
const ZOOM_STEP = 2;
const MIN_SELECTION_CHARS = 8;

function hasAcceptedExtension(name: string): boolean {
  const lower = name.toLowerCase();
  return ACCEPTED_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

/** How long scroll events must stop for before the page indicator trusts the scroll position again after a jump. */
const SETTLE_MS = 120;

/**
 * The Document panel only captures selections and reports them upward — it
 * deliberately doesn't run anything or show results itself. Highlighting a
 * passage scores it against the same Risk and Compliance tabs already used
 * for the whole document (see page.tsx / RiskDashboard.tsx /
 * ComplianceFlags.tsx), so a highlight's results always land somewhere
 * stable and full-sized rather than a small popover competing with the text
 * underneath it.
 */
export function DocumentPanel({
  document,
  activeDocumentId,
  onLoadDocument,
  onUpload,
  uploading,
  uploadError,
  onReset,
  selectedExcerpt,
  onSelectionChange,
  expanded,
  onToggleExpand,
}: {
  document: { id: string; name: string; text: string } | null;
  activeDocumentId: string | null;
  onLoadDocument: (id: string) => void;
  onUpload: (file: File) => void;
  uploading: boolean;
  uploadError: string | null;
  onReset: () => void;
  selectedExcerpt: string | null;
  onSelectionChange: (text: string | null) => void;
  /** Whether the document is taking over the whole left panel right now — see page.tsx. */
  expanded: boolean;
  onToggleExpand: () => void;
}) {
  const [zoom, setZoom] = useState(PREVIEW_ZOOM);
  const [dragging, setDragging] = useState(false);
  const dragCounter = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const pageRefs = useRef<(HTMLDivElement | null)[]>([]);
  const [currentPage, setCurrentPage] = useState(0);
  /** Where the reader is, as an offset into the text, so their place survives the pages being re-flowed at another zoom. */
  const anchorRef = useRef(0);
  /** Set while a Prev/Next jump is scrolling, so the indicator does not flicker through the pages in between. */
  const settleRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const frameRef = useRef<number | null>(null);
  /** The current render's `syncPage`. Timers and animation frames call it through here: one from an earlier render would pair today's sheets with yesterday's pages. */
  const syncRef = useRef<() => void>(() => {});
  const [metrics, setMetrics] = useState<SheetMetrics | null>(null);

  // Resetting state when a prop changes, done during render (React's own
  // recommended pattern for this) rather than in an effect: a newly loaded
  // document always opens at the compact PREVIEW_ZOOM size, whether or not the
  // panel is expanded (a chosen document opens expanded, see page.tsx). Only a
  // later Expand/Collapse click by the reader changes the size, bumping to a
  // comfortable reading size: reading size is something the user opts into.
  const [prevDocId, setPrevDocId] = useState(document?.id ?? null);
  const [prevExpanded, setPrevExpanded] = useState(expanded);
  if ((document?.id ?? null) !== prevDocId) {
    setPrevDocId(document?.id ?? null);
    // The panel is usually told to expand in the same update that loads the document; that is not the reader
    // opting in, so it must not also count as an Expand click and bump the size.
    setPrevExpanded(expanded);
    setZoom(PREVIEW_ZOOM);
    setCurrentPage(0);
  } else if (expanded !== prevExpanded) {
    setPrevExpanded(expanded);
    setZoom(expanded ? READING_ZOOM : PREVIEW_ZOOM);
  }

  function handleFilePicked(file: File | undefined) {
    if (!file || !hasAcceptedExtension(file.name)) return;
    onUpload(file);
  }

  function handleDragEnter(e: DragEvent) {
    e.preventDefault();
    dragCounter.current += 1;
    setDragging(true);
  }
  function handleDragLeave(e: DragEvent) {
    e.preventDefault();
    dragCounter.current -= 1;
    if (dragCounter.current <= 0) setDragging(false);
  }
  function handleDrop(e: DragEvent) {
    e.preventDefault();
    dragCounter.current = 0;
    setDragging(false);
    handleFilePicked(e.dataTransfer.files?.[0]);
  }

  function handleTextMouseUp() {
    const sel = window.getSelection();
    const text = sel?.toString().trim() ?? "";
    if (text.length < MIN_SELECTION_CHARS) return;
    onSelectionChange(text);
  }

  // Touch screens select with a long-press and drag handles, which never fires
  // mouseup; selectionchange (settled for a moment) covers them.
  const selectionHandler = useRef(handleTextMouseUp);
  useEffect(() => {
    selectionHandler.current = handleTextMouseUp;
  });
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    function onSelectionChange() {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const root = scrollRef.current;
        const anchor = window.getSelection()?.anchorNode;
        if (root && anchor && root.contains(anchor)) selectionHandler.current();
      }, 400);
    }
    window.document.addEventListener("selectionchange", onSelectionChange);
    return () => {
      clearTimeout(timer);
      window.document.removeEventListener("selectionchange", onSelectionChange);
    };
  }, []);

  // Pages are fitted to the sheet at the current zoom: the sheet is measured, and the text is laid out to fill it (see
  // lib/document/paginate.ts). Zooming or resizing the panel re-flows them, as a document viewer does.
  const { cols, rows } = layoutFor(metrics, zoom);
  const text = document?.text;
  const pages = useMemo(() => (text == null ? [] : paginate(text, { cols, rows })), [text, cols, rows]);

  useLayoutEffect(() => {
    pageRefs.current.length = pages.length;
    const measure = () => {
      const sheet = pageRefs.current[0];
      const block = sheet?.querySelector("pre");
      if (!sheet || !block) return;
      const next = measureSheet(sheet, block as HTMLElement);
      if (next) setMetrics((prev) => (differs(prev, next) ? next : prev));
    };
    measure();
    const root = scrollRef.current;
    if (!root || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    void window.document.fonts?.ready.then(measure);
    return () => observer.disconnect();
  }, [pages.length, zoom, document?.id]);

  function scrollToPage(index: number, behavior: ScrollBehavior) {
    const root = scrollRef.current;
    const sheet = pageRefs.current[index];
    if (!root || !sheet) return;
    // Land with the page's top edge where the first page's sits at rest, just inside the panel's padding.
    const top = sheet.getBoundingClientRect().top - root.getBoundingClientRect().top + root.scrollTop - parseFloat(getComputedStyle(root).paddingTop);
    root.scrollTo({ top: Math.max(0, top), behavior });
  }

  // A newly loaded document starts at its first page, whatever the last one's scroll position was.
  useLayoutEffect(() => {
    anchorRef.current = 0;
    scrollRef.current?.scrollTo({ top: 0 });
  }, [document?.id]);

  // After a re-flow, stay on the same passage: the page that now holds the offset the reader was at.
  useLayoutEffect(() => {
    if (pages.length === 0) return;
    const index = pageAt(pages, anchorRef.current);
    setCurrentPage(index);
    // The jump below fires scroll events of its own; the indicator waits for them to stop instead of chasing them.
    holdIndicator(SETTLE_MS);
    scrollToPage(index, "auto");
  }, [pages]);

  // The indicator follows the scroll position: the page under a line a third of the way down the viewport, or the last page
  // once the reader has scrolled to the end (a short last page could never reach that line).
  function syncPage() {
    const root = scrollRef.current;
    if (!root || pages.length === 0) return;
    let index = 0;
    if (root.scrollTop > 0 && root.scrollTop + root.clientHeight >= root.scrollHeight - 2) {
      index = pages.length - 1;
    } else {
      const line = root.getBoundingClientRect().top + root.clientHeight * 0.3;
      pageRefs.current.forEach((sheet, i) => {
        if (sheet && sheet.getBoundingClientRect().top <= line) index = i;
      });
    }
    anchorRef.current = pages[index]?.start ?? 0;
    setCurrentPage(index);
  }
  useLayoutEffect(() => {
    syncRef.current = syncPage;
  });

  function holdIndicator(ms: number) {
    if (settleRef.current) clearTimeout(settleRef.current);
    settleRef.current = setTimeout(() => {
      settleRef.current = null;
      syncRef.current();
    }, ms);
  }

  function handleScroll() {
    if (settleRef.current) {
      holdIndicator(SETTLE_MS);
      return;
    }
    if (frameRef.current != null) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      syncRef.current();
    });
  }

  useEffect(
    () => () => {
      if (settleRef.current) clearTimeout(settleRef.current);
      if (frameRef.current != null) cancelAnimationFrame(frameRef.current);
    },
    []
  );

  function goToPage(index: number) {
    const clamped = Math.max(0, Math.min(pages.length - 1, index));
    anchorRef.current = pages[clamped]?.start ?? 0;
    setCurrentPage(clamped);
    holdIndicator(250);
    scrollToPage(clamped, window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth");
  }

  return (
    <div
      className="relative flex h-full flex-col bg-background"
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={(e) => e.preventDefault()}
      onDrop={handleDrop}
    >
      {dragging && (
        <div className="absolute inset-0 z-20 flex items-center justify-center rounded-xl border-4 border-dashed border-accent bg-black/80 backdrop-blur-sm">
          <div className="rounded-2xl bg-surface px-6 py-4 text-center shadow-lg">
            <p className="text-lg font-extrabold text-deep">Drop to upload</p>
            <p className="text-sm font-medium text-muted">.pdf · .docx · .txt</p>
          </div>
        </div>
      )}

      <div className="border-b border-border px-3 py-2.5 sm:px-4 sm:py-3 short:py-1.5">
        <div className="mb-2 flex items-center justify-between short:mb-1">
          <p className="text-xs font-bold uppercase tracking-wide text-muted">Documents</p>
          <button onClick={onReset} className="-my-2 -mr-2 px-2 py-2.5 text-sm font-semibold text-secondary transition-colors hover:text-rose-800 lg:py-2">
            Reset session
          </button>
        </div>
        <div className="-mx-3 flex flex-nowrap gap-1.5 overflow-x-auto px-3 pb-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 sm:pb-0 lg:flex-nowrap lg:overflow-x-auto xl:flex-wrap xl:overflow-visible short:flex-nowrap short:overflow-x-auto">
          {SAMPLE_CONTRACTS.map((c) => {
            const active = activeDocumentId === c.id;
            return (
              <button
                key={c.id}
                onClick={() => onLoadDocument(c.id)}
                title={c.blurb}
                className={`flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3.5 py-2 text-sm font-semibold transition-all ${
                  active
                    ? "border-transparent bg-accent text-accent-ink shadow-sm"
                    : "border-border-strong bg-surface text-secondary hover:border-deep/30 hover:text-deep"
                }`}
              >
                <Icon name={DOC_ICONS[c.id] ?? "document"} size={16} />
                {c.name}
              </button>
            );
          })}
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-dashed border-border-strong bg-surface px-3.5 py-2 text-sm font-semibold text-secondary transition-all hover:border-deep/30 hover:text-deep disabled:opacity-50"
          >
            <Icon name={uploading ? "loader" : "upload"} size={16} />
            {uploading ? "Uploading…" : "Upload a file"}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPTED_EXTENSIONS.join(",")}
            className="hidden"
            onChange={(e) => {
              handleFilePicked(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
        </div>
        <p className="mt-1.5 hidden text-xs text-muted sm:block lg:hidden xl:block short:!hidden">drag a .pdf, .docx, or .txt file anywhere into this panel</p>
        {uploadError && <p className="mt-1.5 text-xs font-semibold text-rose-800">{uploadError}</p>}
      </div>

      {!document ? (
        <div className="flex flex-1 items-center justify-center p-6">
          <p className="max-w-xs text-center text-sm text-muted">
            No document loaded yet. Pick a sample above, or upload your own.
          </p>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1.5 border-b border-border bg-surface px-3 py-2 sm:px-4 short:flex-nowrap short:py-1">
            <p className="min-w-0 max-w-full truncate text-base font-bold text-foreground">{document.name}</p>
            <div className="flex shrink-0 items-center gap-1">
              {pages.length > 1 && (
                <div role="group" aria-label="Page navigation" className="mr-1 flex items-center gap-1 rounded-full border border-border-strong bg-elevated px-1 py-0.5">
                  <PageNavButton onClick={() => goToPage(currentPage - 1)} disabled={currentPage === 0} label="Previous page">
                    ‹
                  </PageNavButton>
                  <span className="w-16 text-center text-sm font-semibold tabular-nums text-secondary">
                    {currentPage + 1} / {pages.length}
                  </span>
                  <PageNavButton onClick={() => goToPage(currentPage + 1)} disabled={currentPage === pages.length - 1} label="Next page">
                    ›
                  </PageNavButton>
                </div>
              )}
              <ZoomButton onClick={() => setZoom((z) => Math.max(MIN_ZOOM, z - ZOOM_STEP))} disabled={zoom <= MIN_ZOOM} label="Zoom out">
                −
              </ZoomButton>
              <span className="w-12 text-center text-sm font-semibold tabular-nums text-secondary">{zoom}px</span>
              <ZoomButton onClick={() => setZoom((z) => Math.min(MAX_ZOOM, z + ZOOM_STEP))} disabled={zoom >= MAX_ZOOM} label="Zoom in">
                +
              </ZoomButton>
              <button
                onClick={onToggleExpand}
                title={expanded ? "Collapse back to split view" : "Expand to fill this panel"}
                className="ml-1 hidden h-8 items-center gap-1 rounded-full border border-border-strong bg-elevated px-3 text-sm font-bold text-secondary transition-colors hover:border-deep/30 hover:text-deep lg:flex"
              >
                {expanded ? "Collapse" : "Expand"}
              </button>
            </div>
          </div>

          {selectedExcerpt ? (
            <div className="flex items-center justify-between gap-3 border-b border-border bg-accent-soft px-4 py-1.5">
              <p className="truncate text-xs font-semibold text-accent-soft-ink">
                Selected: see the <span className="underline">Risk</span> and <span className="underline">Compliance</span> tabs for its score, or the <span className="underline">Citations</span> tab to verify it as a quote →
              </p>
              <button
                onClick={() => onSelectionChange(null)}
                className="shrink-0 text-xs font-bold text-accent-soft-ink hover:text-deep"
              >
                Clear
              </button>
            </div>
          ) : (
            <p className="border-b border-border bg-accent-soft px-4 py-1.5 text-xs font-semibold text-accent-soft-ink short:hidden">
              Highlight any passage: score it in the Risk and Compliance tabs, or drop it straight into the Citations tab as a quote to verify.
            </p>
          )}

          <div className="relative flex-1 overflow-hidden">
            <div ref={scrollRef} tabIndex={0} role="region" aria-label="Document preview" className="h-full overflow-auto bg-elevated/60 p-3 [scrollbar-gutter:stable] sm:p-6" onMouseUp={handleTextMouseUp} onScroll={handleScroll}>
              <div className="mx-auto flex max-w-[52rem] flex-col items-center gap-6">
                {pages.map((page, i) => (
                  <div
                    key={i}
                    ref={(el) => {
                      pageRefs.current[i] = el;
                    }}
                    role="group"
                    aria-label={pages.length > 1 ? `Page ${i + 1} of ${pages.length}` : "Document text"}
                    className="w-full rounded-sm bg-paper px-5 py-6 shadow-[0_1px_2px_rgba(0,0,0,0.06),0_8px_24px_rgba(0,0,0,0.12)] sm:px-14 sm:py-14"
                    style={{ aspectRatio: pages.length > 1 ? "8.5 / 11" : undefined, minHeight: pages.length > 1 ? undefined : "auto" }}
                  >
                    <pre
                      className="whitespace-pre-wrap break-words font-[var(--font-document)] leading-relaxed text-paper-ink select-text"
                      style={{ fontSize: `${zoom}px` }}
                    >
                      {page.text}
                    </pre>
                    {pages.length > 1 && (
                      <p className="mt-6 text-center text-xs text-paper-muted">
                        Page {i + 1} of {pages.length}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function ZoomButton({
  onClick,
  disabled,
  label,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className="flex h-10 w-10 items-center justify-center rounded-full border border-border-strong bg-elevated text-base font-bold lg:h-8 lg:w-8 text-secondary transition-colors hover:border-deep/30 hover:text-deep disabled:opacity-30"
    >
      {children}
    </button>
  );
}

function PageNavButton({
  onClick,
  disabled,
  label,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className="flex h-10 w-10 items-center justify-center rounded-full text-lg font-bold lg:h-7 lg:w-7 text-secondary transition-colors hover:text-deep disabled:opacity-25"
    >
      {children}
    </button>
  );
}
