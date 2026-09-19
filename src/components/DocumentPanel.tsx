"use client";

import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { SAMPLE_CONTRACTS } from "@/lib/data/sampleContracts";
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

/**
 * Splits into page-sized chunks so the document reads as an actual paginated
 * document rather than one long scroll — breaking on a blank line near the
 * budget so a page never cuts a paragraph in half. This is a real, honest
 * design choice over rendering an actual PDF canvas: a canvas+text-layer PDF
 * renderer (pdfjs-dist, already a transitive dependency via pdf-parse) would
 * need its own worker setup, which is exactly what broke pdf-parse v2 under
 * Turbopack — and even working, a canvas's text layer is far more fragile to
 * select from than plain HTML. Paginated HTML gets the paper-page look with
 * zero risk to the selection-driven features this panel is built around.
 */
const CHARS_PER_PAGE = 2600;

function paginate(text: string): string[] {
  const pages: string[] = [];
  let rest = text;
  while (rest.length > CHARS_PER_PAGE) {
    let breakAt = rest.lastIndexOf("\n\n", CHARS_PER_PAGE);
    if (breakAt < CHARS_PER_PAGE * 0.4) breakAt = rest.lastIndexOf("\n", CHARS_PER_PAGE);
    if (breakAt < CHARS_PER_PAGE * 0.4) breakAt = CHARS_PER_PAGE;
    pages.push(rest.slice(0, breakAt).trimEnd());
    rest = rest.slice(breakAt).trimStart();
  }
  pages.push(rest);
  return pages;
}

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

  // Resetting state when a prop changes, done during render (React's own
  // recommended pattern for this) rather than in an effect: a newly loaded
  // document always opens as a small, scaled-down preview, and expanding
  // bumps to a comfortable reading size — reading size is something the
  // user opts into, not the default for a document they haven't looked at.
  const [prevDocId, setPrevDocId] = useState(document?.id ?? null);
  const [prevExpanded, setPrevExpanded] = useState(expanded);
  if ((document?.id ?? null) !== prevDocId) {
    setPrevDocId(document?.id ?? null);
    setZoom(PREVIEW_ZOOM);
    setCurrentPage(0);
  } else if (expanded !== prevExpanded) {
    setPrevExpanded(expanded);
    setZoom(expanded ? READING_ZOOM : PREVIEW_ZOOM);
  }

  // Refs are an imperative concern, not render output — clearing stale page
  // element references belongs in an effect, unlike the state resets above.
  useEffect(() => {
    pageRefs.current = [];
  }, [document?.id]);

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

  const pages = useMemo(() => (document ? paginate(document.text) : []), [document]);

  // Keeps the page indicator honest during free scrolling, not just when the
  // reader clicks Prev/Next — whichever page is most visible wins.
  useEffect(() => {
    const root = scrollRef.current;
    if (!root || pages.length <= 1) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio);
        if (visible.length === 0) return;
        const index = pageRefs.current.findIndex((el) => el === visible[0].target);
        if (index !== -1) setCurrentPage(index);
      },
      { root, threshold: [0.25, 0.5, 0.75] }
    );
    pageRefs.current.forEach((el) => el && observer.observe(el));
    return () => observer.disconnect();
  }, [pages.length]);

  function goToPage(index: number) {
    const clamped = Math.max(0, Math.min(pages.length - 1, index));
    pageRefs.current[clamped]?.scrollIntoView({ behavior: "smooth", block: "start" });
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
        <div className="absolute inset-0 z-20 flex items-center justify-center rounded-xl border-4 border-dashed border-accent bg-deep/90 backdrop-blur-sm">
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
                <div className="mr-1 flex items-center gap-1 rounded-full border border-border-strong bg-elevated px-1 py-0.5">
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
              <p className="truncate text-xs font-semibold text-accent-ink">
                Selected: see the <span className="underline">Risk</span> and <span className="underline">Compliance</span> tabs for its score, or the <span className="underline">Citations</span> tab to verify it as a quote →
              </p>
              <button
                onClick={() => onSelectionChange(null)}
                className="shrink-0 text-xs font-bold text-accent-ink hover:text-deep"
              >
                Clear
              </button>
            </div>
          ) : (
            <p className="border-b border-border bg-accent-soft px-4 py-1.5 text-xs font-semibold text-accent-ink short:hidden">
              Highlight any passage: score it in the Risk and Compliance tabs, or drop it straight into the Citations tab as a quote to verify.
            </p>
          )}

          <div className="relative flex-1 overflow-hidden">
            <div ref={scrollRef} tabIndex={0} role="region" aria-label="Document preview" className="h-full overflow-auto bg-elevated/60 p-3 sm:p-6" onMouseUp={handleTextMouseUp}>
              <div className="mx-auto flex max-w-[52rem] flex-col items-center gap-6">
                {pages.map((pageText, i) => (
                  <div
                    key={i}
                    ref={(el) => {
                      pageRefs.current[i] = el;
                    }}
                    className="w-full rounded-sm bg-[#fdfcf6] px-5 py-6 shadow-[0_1px_2px_rgba(0,0,0,0.06),0_8px_24px_rgba(0,0,0,0.12)] sm:px-14 sm:py-14"
                    style={{ aspectRatio: pages.length > 1 ? "8.5 / 11" : undefined, minHeight: pages.length > 1 ? undefined : "auto" }}
                  >
                    <pre
                      className="whitespace-pre-wrap break-words font-[var(--font-document)] leading-relaxed text-[#1c1a14] select-text"
                      style={{ fontSize: `${zoom}px` }}
                    >
                      {pageText}
                    </pre>
                    {pages.length > 1 && (
                      <p className="mt-6 text-center text-xs text-[#a8a290]">
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
