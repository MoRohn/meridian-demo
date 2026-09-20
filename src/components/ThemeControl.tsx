"use client";

import { useState } from "react";
import { DEFAULT_LEVEL, levelAt, levelIndex, THEME_LEVELS } from "@/lib/theme";
import { setLevel, useThemeLevel } from "@/lib/themeState";
import { useDialog } from "@/lib/useDialog";
import { Icon } from "./Icon";

/**
 * Brightness control: a five-stop slider from the brightest level to the darkest, in a popover off a header button. The
 * slider's track previews the five backgrounds; each stop is also a labelled button, so it can be set by dragging, by
 * arrow keys, or by picking a name. The choice applies instantly, is remembered, and is applied before first paint on
 * the next visit (see themeInitScript).
 */
export function ThemeControl() {
  const level = useThemeLevel();
  const [open, setOpen] = useState(false);
  const dialogRef = useDialog(open, () => setOpen(false));
  const current = levelAt(levelIndex(level));
  const dark = levelIndex(level) >= levelIndex("dark");

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label={`Display brightness: ${current.label}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        title="Display brightness"
        className="flex h-9 w-9 items-center justify-center rounded-full text-secondary transition-colors hover:bg-surface-hover hover:text-deep"
      >
        <Icon name={dark ? "moon" : "sun"} size={20} />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-30" aria-hidden onPointerDown={() => setOpen(false)} />
          <div
            ref={dialogRef}
            role="dialog"
            aria-label="Display brightness"
            tabIndex={-1}
            className="animate-in absolute right-0 top-full z-40 mt-2 w-[22rem] rounded-2xl border border-border bg-surface p-4 shadow-xl outline-none max-sm:fixed max-sm:inset-x-3 max-sm:top-14 max-sm:mt-0 max-sm:w-auto"
          >
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 className="text-sm font-extrabold text-deep">Brightness</h2>
              <span className="rounded-full border border-border-strong bg-elevated px-2.5 py-0.5 text-xs font-bold text-secondary" aria-hidden>
                {current.label}
              </span>
            </div>

            <div className="flex items-center gap-3">
              <Icon name="sun" size={18} className="text-muted" />
              <input
                type="range"
                min={0}
                max={THEME_LEVELS.length - 1}
                step={1}
                value={levelIndex(level)}
                onChange={(e) => setLevel(levelAt(Number(e.target.value)).id)}
                aria-label="Brightness level"
                aria-valuetext={`${current.label}: ${current.description}`}
                className="level-slider min-w-0 flex-1"
              />
              <Icon name="moon" size={18} className="text-muted" />
            </div>

            <div className="mt-2 grid grid-cols-5 gap-1">
              {THEME_LEVELS.map((l) => (
                <button
                  key={l.id}
                  onClick={() => setLevel(l.id)}
                  aria-pressed={l.id === level}
                  className={`flex flex-col items-center gap-1 rounded-lg px-0.5 py-1.5 text-[11px] leading-none transition-colors hover:bg-surface-hover ${
                    l.id === level ? "font-extrabold text-deep" : "font-medium text-secondary"
                  }`}
                >
                  <span
                    aria-hidden
                    className={`h-3.5 w-3.5 rounded-full border ${l.id === level ? "border-deep ring-2 ring-deep/40" : "border-border-strong"}`}
                    style={{ background: `var(--swatch-${l.id})` }}
                  />
                  {l.label}
                </button>
              ))}
            </div>

            <p className="mt-3 text-xs leading-relaxed text-muted">{current.description}</p>
            {level !== DEFAULT_LEVEL && (
              <button onClick={() => setLevel(DEFAULT_LEVEL)} className="mt-2 text-xs font-bold text-secondary underline underline-offset-2 hover:text-deep">
                Reset to default
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
