import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { DEFAULT_LEVEL, isLevel, levelAt, levelIndex, readStoredLevel, STORAGE_KEY, THEME_LEVELS, themeInitScript, writeStoredLevel } from "./theme";

const store = (initial: Record<string, string> = {}) => {
  const data = { ...initial };
  return { data, getItem: (k: string) => data[k] ?? null, setItem: (k: string, v: string) => void (data[k] = v) };
};

describe("levels", () => {
  it("are five, brightest to darkest, with the default in the middle", () => {
    expect(THEME_LEVELS.map((l) => l.id)).toEqual(["bright", "original", "default", "dark", "darkest"]);
    expect(DEFAULT_LEVEL).toBe("default");
    expect(levelIndex(DEFAULT_LEVEL)).toBe(2);
  });
  it("have a label and a description each", () => {
    for (const l of THEME_LEVELS) expect(l.label && l.description).toBeTruthy();
  });
  it("recognise only real ids", () => {
    expect(isLevel("dark")).toBe(true);
    for (const bad of ["", "Dark", "night", null, undefined, 3]) expect(isLevel(bad)).toBe(false);
  });
  it("map a slider position to a level, clamping out-of-range values", () => {
    expect(levelAt(0).id).toBe("bright");
    expect(levelAt(4).id).toBe("darkest");
    expect(levelAt(-3).id).toBe("bright");
    expect(levelAt(99).id).toBe("darkest");
    expect(levelAt(1.6).id).toBe("default");
  });
});

describe("storage", () => {
  it("returns the saved level", () => {
    expect(readStoredLevel(store({ [STORAGE_KEY]: "darkest" }))).toBe("darkest");
  });
  it("falls back to the default for nothing, junk, or a level that no longer exists", () => {
    expect(readStoredLevel(store())).toBe(DEFAULT_LEVEL);
    expect(readStoredLevel(store({ [STORAGE_KEY]: "purple" }))).toBe(DEFAULT_LEVEL);
  });
  it("never throws when storage is blocked", () => {
    const blocked = { getItem: () => { throw new Error("denied"); }, setItem: () => { throw new Error("denied"); } };
    expect(readStoredLevel(blocked)).toBe(DEFAULT_LEVEL);
    expect(() => writeStoredLevel("dark", blocked)).not.toThrow();
  });
  it("round-trips", () => {
    const s = store();
    writeStoredLevel("bright", s);
    expect(readStoredLevel(s)).toBe("bright");
  });
  it("uses the server-safe default when there is no browser", () => {
    expect(readStoredLevel()).toBe(DEFAULT_LEVEL);
  });
});

describe("themeInitScript (runs before first paint)", () => {
  const run = (saved: string | null, opts: { throws?: boolean } = {}) => {
    const attrs: Record<string, string> = {};
    const localStorage = { getItem: () => { if (opts.throws) throw new Error("denied"); return saved; } };
    const document = { documentElement: { setAttribute: (k: string, v: string) => void (attrs[k] = v) } };
    runInNewContext(themeInitScript, { localStorage, document });
    return attrs;
  };
  it("applies a saved level", () => {
    expect(run("dark")).toEqual({ "data-level": "dark" });
    expect(run("bright")).toEqual({ "data-level": "bright" });
  });
  it("leaves the default palette alone when nothing valid is saved", () => {
    expect(run(null)).toEqual({});
    expect(run("purple")).toEqual({});
  });
  it("cannot break the page when storage throws", () => {
    expect(run("dark", { throws: true })).toEqual({});
  });
  it("lists exactly the real levels, so it cannot drift from them", () => {
    for (const l of THEME_LEVELS) expect(themeInitScript).toContain(`"${l.id}"`);
  });
});
