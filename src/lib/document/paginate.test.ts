import { describe, expect, it } from "vitest";
import { layoutFor } from "./measure";
import { normalizeText, pageAt, paginate } from "./paginate";

const layout = { cols: 60, rows: 20 };
const paragraph = (n: number, words = 30) => `${n}. ` + Array.from({ length: words }, (_, i) => `word${n}x${i}`).join(" ");
const doc = (count: number, words = 30) => Array.from({ length: count }, (_, i) => paragraph(i + 1, words)).join("\n\n");
const squash = (s: string) => s.replace(/\s+/g, " ").trim();

/** Visual lines a page needs at this width, counted the way the layout counts them. */
function height(text: string, cols: number): number {
  return text.split("\n").reduce((sum, line) => {
    if (line.trim() === "") return sum + 1;
    let lines = 1;
    let width = 0;
    for (const word of line.trim().split(/\s+/)) {
      if (width > 0 && width + 1 + word.length > cols) {
        lines += 1;
        width = word.length;
      } else width += (width ? 1 : 0) + word.length;
    }
    return sum + lines;
  }, 0);
}

describe("paginate", () => {
  it("puts a document that fits on one page on one page", () => {
    expect(paginate("Short.\n\nAlso short.", layout)).toEqual([{ text: "Short.\n\nAlso short.", start: 0 }]);
  });

  it("gives an empty document one empty page", () => {
    expect(paginate("", layout)).toEqual([{ text: "", start: 0 }]);
    expect(paginate("  \n\n ", layout)).toEqual([{ text: "", start: 0 }]);
  });

  it("loses and adds nothing: the pages read back as the whole text, in order", () => {
    const text = doc(25);
    const pages = paginate(text, layout);
    expect(pages.length).toBeGreaterThan(3);
    expect(squash(pages.map((p) => p.text).join(" "))).toBe(squash(text));
  });

  it("never lets a page hold more lines than fit on a sheet", () => {
    for (const rows of [8, 20, 45]) {
      for (const page of paginate(doc(40), { cols: 60, rows })) expect(height(page.text, 60)).toBeLessThanOrEqual(rows);
    }
  });

  it("fills pages instead of leaving them nearly empty", () => {
    const pages = paginate(doc(60, 12), { cols: 60, rows: 30 });
    for (const page of pages.slice(0, -1)) expect(height(page.text, 60)).toBeGreaterThan(30 * 0.6);
  });

  it("keeps a paragraph whole when it fits on a page, starting a new page rather than splitting it", () => {
    const pages = paginate(doc(30), layout);
    for (const page of pages) expect(page.text.split("\n\n").every((p) => /^\d+\. word\d+x0 /.test(p))).toBe(true);
  });

  it("splits a paragraph taller than a page at a line, with no single line left alone at either side", () => {
    const tall = paragraph(1, 400);
    const pages = paginate(`Intro line.\n\n${tall}\n\nAfter.`, layout);
    expect(pages.length).toBeGreaterThan(2);
    for (const page of pages) expect(height(page.text, 60)).toBeLessThanOrEqual(20);
    for (const page of pages.slice(1, -1)) expect(height(page.text, 60)).toBeGreaterThan(1);
    expect(squash(pages.map((p) => p.text).join(" "))).toBe(squash(`Intro line. ${tall} After.`));
  });

  it("keeps a heading with the paragraph after it", () => {
    // 17 lines, a blank, and the heading fill 19 of a page's 20 rows; the 10-line paragraph after it cannot join them.
    const lines = (n: number) => Array.from({ length: n }, (_, i) => `line ${i + 1} of the clause`).join("\n");
    const pages = paginate(`${lines(17)}\n\nTERMINATION\n\n${lines(10)}`, layout);
    expect(pages).toHaveLength(2);
    expect(pages[0].text.includes("TERMINATION")).toBe(false);
    expect(pages[1].text.startsWith("TERMINATION\n\nline 1")).toBe(true);
  });

  it("does not move a paragraph that only looks like a heading when it is the whole page", () => {
    const pages = paginate(`HEADING ONLY\n\n${paragraph(1, 300)}`, layout);
    expect(pages[0].text.startsWith("HEADING ONLY")).toBe(true);
  });

  it("breaks a word longer than a line rather than overflowing", () => {
    const pages = paginate(`x${"y".repeat(500)}`, layout);
    expect(squash(pages.map((p) => p.text).join(""))).toBe(`x${"y".repeat(500)}`);
  });

  it("treats Windows and old Mac line endings like any other", () => {
    const text = doc(12);
    expect(paginate(text.replace(/\n/g, "\r\n"), layout)).toEqual(paginate(text, layout));
    expect(normalizeText("a\r\nb\rc")).toBe("a\nb\nc");
  });

  it("keeps a line's indentation and its blank lines inside a page", () => {
    const [page] = paginate("Schedule\n    indented line\n\n\nafter two blanks", layout);
    expect(page.text).toBe("Schedule\n    indented line\n\n\nafter two blanks");
  });

  it("is deterministic and starts each page after the one before", () => {
    const text = doc(30);
    const pages = paginate(text, layout);
    expect(paginate(text, layout)).toEqual(pages);
    pages.forEach((p, i) => i && expect(p.start).toBeGreaterThan(pages[i - 1].start));
  });

  it("makes more, shorter pages when the text is bigger", () => {
    const text = doc(40);
    const small = paginate(text, layoutFor(null, 11)).length;
    const large = paginate(text, layoutFor(null, 22)).length;
    expect(large).toBeGreaterThan(small * 2);
  });
});

describe("pageAt", () => {
  it("finds the page holding an offset, so a reader keeps their place when pages re-flow", () => {
    const text = doc(30);
    const before = paginate(text, layoutFor(null, 11));
    const after = paginate(text, layoutFor(null, 20));
    const offset = before[before.length >> 1].start;
    const page = after[pageAt(after, offset)];
    expect(page.start).toBeLessThanOrEqual(offset);
    expect(after[pageAt(after, offset) + 1]?.start ?? Infinity).toBeGreaterThan(offset);
    expect(pageAt(after, 0)).toBe(0);
    expect(pageAt(after, text.length)).toBe(after.length - 1);
  });
});
