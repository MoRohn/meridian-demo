import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { THEME_LEVELS, type ThemeLevelId } from "./theme";

/**
 * Reads the REAL stylesheet and checks every brightness level against it, so a palette edit that quietly breaks
 * legibility, ordering or the brand fails here rather than in someone's eyes.
 */
const CSS = readFileSync(join(__dirname, "../app/globals.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

type Tokens = Record<string, string>;

function tokensFor(level: ThemeLevelId): Tokens {
  const out: Tokens = {};
  for (const [, selector, body] of CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    // Statements such as `@import "x";` end in `;` rather than a block, so only what follows the last `;` is the selector.
    const selectors = (selector.split(";").pop() ?? "").split(",").map((s) => s.trim());
    const isBase = selectors.includes(":root");
    const isThisLevel = selectors.includes(`:root[data-level="${level}"]`);
    if (!isBase && !isThisLevel) continue;
    for (const [, name, value] of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out[name] = value.trim();
  }
  return out;
}

const hex = (h: string) => { const n = h.replace("#", ""); return [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16)); };
const lin = (c: number) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
const lum = (h: string) => { const [r, g, b] = hex(h); return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b); };
const contrast = (a: string, b: string) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
const lstar = (h: string) => { const y = lum(h); return y > 0.008856 ? 116 * y ** (1 / 3) - 16 : 903.3 * y; };
/** An rgba() tint laid over a solid color, as the browser would paint it. */
function over(rgba: string, base: string): string {
  const m = rgba.match(/rgba\(\s*(\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)/)!;
  const b = hex(base);
  const mixed = [1, 2, 3].map((i, k) => Math.round(Number(m[i]) * Number(m[4]) + b[k] * (1 - Number(m[4]))));
  return "#" + mixed.map((v) => v.toString(16).padStart(2, "0")).join("");
}

const IDS = THEME_LEVELS.map((l) => l.id);
const T = Object.fromEntries(IDS.map((id) => [id, tokensFor(id)])) as Record<ThemeLevelId, Tokens>;

describe("every level defines the complete palette", () => {
  const required = ["--bg", "--bg-elevated", "--surface", "--surface-hover", "--border", "--border-strong", "--text", "--text-secondary", "--text-muted", "--deep", "--fill", "--fill-alt", "--on-fill", "--accent", "--accent-soft", "--accent-ink", "--accent-soft-ink", "--paper", "--paper-ink", "--paper-muted"];
  it.each(IDS)("%s", (id) => {
    for (const name of required) expect(T[id][name], `${id} is missing ${name}`).toBeTruthy();
  });
});

describe("legibility: WCAG AA (4.5:1) for every text/background pair, on every level", () => {
  const SURFACES = ["--bg", "--surface", "--bg-elevated", "--surface-hover"];
  it.each(IDS)("%s: body, secondary and muted text on every surface", (id) => {
    const t = T[id];
    for (const s of SURFACES) {
      expect(contrast(t["--text"], t[s]), `text on ${s}`).toBeGreaterThanOrEqual(7);
      expect(contrast(t["--text-secondary"], t[s]), `secondary on ${s}`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(t["--text-muted"], t[s]), `muted on ${s}`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(t["--deep"], t[s]), `deep (headings, icons) on ${s}`).toBeGreaterThanOrEqual(4.5);
    }
  });
  it.each(IDS)("%s: text on fills, on solid lime, and on the soft lime tint", (id) => {
    const t = T[id];
    expect(contrast(t["--on-fill"], t["--fill"]), "on-fill on fill").toBeGreaterThanOrEqual(4.5);
    expect(contrast(t["--accent-ink"], t["--accent"]), "ink on solid lime").toBeGreaterThanOrEqual(4.5);
    for (const s of ["--bg", "--surface"]) expect(contrast(t["--accent-soft-ink"], over(t["--accent-soft"], t[s])), `soft-ink on the tint over ${s}`).toBeGreaterThanOrEqual(4.5);
  });
  it.each(IDS)("%s: the document paper", (id) => {
    const t = T[id];
    expect(contrast(t["--paper-ink"], t["--paper"])).toBeGreaterThanOrEqual(7);
    expect(contrast(t["--paper-muted"], t["--paper"])).toBeGreaterThanOrEqual(4.5);
  });
  it.each(IDS)("%s: the emerald, rose and amber status text, on plain surfaces AND on the tinted chips and rows it really sits on", (id) => {
    const t = T[id];
    const stock: Record<string, string> = { "--color-emerald-800": "#065f46", "--color-rose-800": "#9f1239", "--color-amber-800": "#92400e", "--color-emerald-900": "#064e3b", "--color-rose-900": "#881337", "--color-amber-900": "#78350f" };
    // Tailwind's 600 tints a chip (10%), sometimes over a 500 tint of the row it sits in (6%): the darkest place this text lands.
    const tint: Record<string, [string, string]> = { emerald: ["#059669", "#10b981"], rose: ["#e11d48", "#f43f5e"], amber: ["#d97706", "#f59e0b"] };
    const mix = (fg: string, a: number, bg: string) => "#" + hex(fg).map((c, i) => Math.round(c * a + hex(bg)[i] * (1 - a)).toString(16).padStart(2, "0")).join("");
    for (const [name, fallback] of Object.entries(stock)) {
      const color = t[name] ?? fallback;
      const [c600, c500] = tint[name.match(/emerald|rose|amber/)![0]];
      for (const s of SURFACES) {
        const backgrounds = [t[s], mix(c600, 0.1, t[s]), mix(c600, 0.1, mix(c500, 0.06, t[s]))];
        for (const bg of backgrounds) expect(contrast(color, bg), `${name} on ${bg} (over ${s})`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
  it.each(IDS)("%s: the fill is distinct from the surface it sits on (a visible active tab)", (id) => {
    expect(contrast(T[id]["--fill"], T[id]["--surface"])).toBeGreaterThanOrEqual(3);
  });
});

describe("the ladder", () => {
  const L = (id: ThemeLevelId) => lstar(T[id]["--bg"]);
  it("gets strictly darker from bright to darkest", () => {
    const values = IDS.map(L);
    for (let i = 1; i < values.length; i++) expect(values[i], `${IDS[i]} vs ${IDS[i - 1]}`).toBeLessThan(values[i - 1]);
  });
  it("makes 'default' only slightly darker than 'original', and 'bright' a step of about the same size brighter", () => {
    const stepDown = L("original") - L("default");
    const stepUp = L("bright") - L("original");
    expect(stepDown).toBeGreaterThan(3);
    expect(stepDown).toBeLessThan(10);
    expect(stepUp).toBeGreaterThan(3);
    expect(stepUp).toBeLessThan(10);
  });
  it("puts the two dark levels well below the light ones, with a clear step between them", () => {
    expect(L("default") - L("dark")).toBeGreaterThan(40);
    expect(L("dark") - L("darkest")).toBeGreaterThan(10);
  });
  it("uses light text on the dark levels and dark text on the light ones", () => {
    for (const id of ["bright", "original", "default"] as const) expect(lum(T[id]["--text"])).toBeLessThan(lum(T[id]["--bg"]));
    for (const id of ["dark", "darkest"] as const) expect(lum(T[id]["--text"])).toBeGreaterThan(lum(T[id]["--bg"]));
  });
});

describe("the original level is exactly the palette Meridian shipped with", () => {
  it("keeps every original value", () => {
    expect(T.original).toMatchObject({
      "--bg": "#dbe3c5", "--bg-elevated": "#e8e3cd", "--surface": "#e8e3cd", "--surface-hover": "#d8dfba",
      "--border": "#c3cea3", "--border-strong": "#a3b285", "--text": "#0a1610", "--text-secondary": "#2a3826",
      "--text-muted": "#526049", "--deep": "#071510", "--accent": "#d8e35a", "--accent-strong": "#c3ce3f",
    });
  });
});

describe("the default level is the one a new visitor gets", () => {
  it("is what the bare :root declares, so first paint needs no JavaScript", () => {
    const base = tokensFor("default");
    expect(base["--bg"]).toBe("#cbd4b1");
    expect(CSS).toMatch(/:root,\s*:root\[data-level="default"\]\s*\{/);
  });
});

describe("the slider's preview swatches", () => {
  it.each(IDS)("%s swatch is that level's real background", (id) => {
    expect(tokensFor("default")[`--swatch-${id}`], `--swatch-${id}`).toBe(T[id]["--bg"]);
  });
});
