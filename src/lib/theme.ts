/**
 * Brightness levels, from brightest to darkest. The palette for each lives in src/app/globals.css under
 * `:root[data-level="<id>"]`; this module is the model around it: which levels exist, which is the default, how the
 * choice is stored and applied, and the tiny script that applies it before first paint.
 */
export const THEME_LEVELS = [
  { id: "bright", label: "Bright", description: "One step brighter than the original." },
  { id: "original", label: "Original", description: "The palette Meridian shipped with." },
  { id: "default", label: "Default", description: "Slightly darker than the original. What you see first." },
  { id: "dark", label: "Dark", description: "Dark surfaces with light text." },
  { id: "darkest", label: "Darkest", description: "The deepest level, easiest on the eyes at night." },
] as const;

export type ThemeLevelId = (typeof THEME_LEVELS)[number]["id"];

export const DEFAULT_LEVEL: ThemeLevelId = "default";
export const STORAGE_KEY = "meridian.theme";

export const isLevel = (value: unknown): value is ThemeLevelId => THEME_LEVELS.some((l) => l.id === value);
export const levelIndex = (id: ThemeLevelId) => THEME_LEVELS.findIndex((l) => l.id === id);
export const levelAt = (index: number) => THEME_LEVELS[Math.min(THEME_LEVELS.length - 1, Math.max(0, Math.round(index)))];

type ReadableStorage = Pick<Storage, "getItem">;
type WritableStorage = Pick<Storage, "setItem">;

/** The saved level, or the default when nothing valid is saved or storage is unavailable (private mode, blocked, SSR). */
export function readStoredLevel(storage?: ReadableStorage): ThemeLevelId {
  try {
    const store = storage ?? (typeof window === "undefined" ? undefined : window.localStorage);
    const saved = store?.getItem(STORAGE_KEY);
    return isLevel(saved) ? saved : DEFAULT_LEVEL;
  } catch {
    return DEFAULT_LEVEL;
  }
}

export function writeStoredLevel(level: ThemeLevelId, storage?: WritableStorage): void {
  try {
    const store = storage ?? (typeof window === "undefined" ? undefined : window.localStorage);
    store?.setItem(STORAGE_KEY, level);
  } catch {
    // Storage unavailable: the choice still applies for this visit, it just won't be remembered.
  }
}

/**
 * Runs before first paint (inlined in <head> by layout.tsx) so a saved level never flashes the default first. It is
 * built from the level ids above so the list can never drift, and it must not throw: a page that cannot read storage
 * simply keeps the default palette.
 */
export const themeInitScript = `(function(){try{var l=localStorage.getItem(${JSON.stringify(STORAGE_KEY)});if(${JSON.stringify(THEME_LEVELS.map((x) => x.id))}.indexOf(l)>-1)document.documentElement.setAttribute("data-level",l)}catch(e){}})()`;
