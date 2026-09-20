/**
 * Re-runs whatever produced the content it sits next to — the whole
 * document, or the highlighted excerpt when one is selected — without
 * retyping a chat message. Every evaluation tab (Trace, Risk, Compliance)
 * gets one of these once it has something to re-run.
 */
export function RerunButton({
  onClick,
  pending = false,
  label = "Re-run",
  disabled = false,
  title,
}: {
  onClick: () => void;
  pending?: boolean;
  label?: string;
  /** Unavailable right now (not the same as running); `title` says why. */
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={pending || disabled}
      title={title ?? label}
      aria-label={label}
      className="flex shrink-0 items-center gap-1.5 rounded-full border border-border-strong bg-elevated px-3 py-2.5 text-xs font-bold lg:px-2.5 lg:py-1 text-secondary transition-colors hover:border-deep/30 hover:text-deep disabled:opacity-50"
    >
      <span aria-hidden className={`inline-block text-sm leading-none ${pending ? "animate-spin" : ""}`}>
        ↻
      </span>
      {pending ? "Re-running…" : label}
    </button>
  );
}
