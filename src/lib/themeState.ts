import { useSyncExternalStore } from "react";
import { DEFAULT_LEVEL, isLevel, readStoredLevel, STORAGE_KEY, writeStoredLevel, type ThemeLevelId } from "./theme";

/**
 * The live half of the theme: the level in effect in this browser, changing it, and a hook that follows it. Kept apart
 * from theme.ts, which is pure and is imported by the server-rendered layout.
 */
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

const currentLevel = (): ThemeLevelId => {
  if (typeof document === "undefined") return DEFAULT_LEVEL;
  const attr = document.documentElement.getAttribute("data-level");
  return isLevel(attr) ? attr : DEFAULT_LEVEL;
};

/** Applies a level to the page. `animate` fades the colors over a fraction of a second, unless the reader prefers reduced motion. */
export function applyLevel(level: ThemeLevelId, options: { animate?: boolean } = {}): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  const reduce = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  if (options.animate && !reduce) {
    root.classList.add("theme-fade");
    window.setTimeout(() => root.classList.remove("theme-fade"), 350);
  }
  root.setAttribute("data-level", level);
  notify();
}

export function setLevel(level: ThemeLevelId): void {
  applyLevel(level, { animate: true });
  writeStoredLevel(level);
}

/** The level in effect, live: updates when it is changed here or in another tab. */
export function useThemeLevel(): ThemeLevelId {
  return useSyncExternalStore(
    (onChange) => {
      listeners.add(onChange);
      const onStorage = (e: StorageEvent) => {
        if (e.key === STORAGE_KEY) applyLevel(readStoredLevel());
      };
      window.addEventListener("storage", onStorage);
      return () => {
        listeners.delete(onChange);
        window.removeEventListener("storage", onStorage);
      };
    },
    currentLevel,
    () => DEFAULT_LEVEL,
  );
}
