/**
 * Fonts for the PDF report. jsPDF's built-in fonts cover Latin-1 only, so the PDF embeds DejaVu Sans (public/fonts),
 * which covers Latin, Greek, Cyrillic, arrows, maths and currency symbols. Whatever the font still cannot draw (CJK,
 * emoji, right-to-left scripts, which need shaping this renderer does not do) is replaced with a visible marker, never
 * dropped or drawn as a wrong glyph, and the PDF says so at its end. The web page and Word versions keep every character.
 */
export interface PdfFonts {
  regular: Uint8Array;
  bold: Uint8Array;
  italic: Uint8Array;
  mono: Uint8Array;
}

export const PDF_FONT_FILES: Record<keyof PdfFonts, string> = {
  regular: "DejaVuSansCondensed.ttf",
  bold: "DejaVuSansCondensed-Bold.ttf",
  italic: "DejaVuSansCondensed-Oblique.ttf",
  mono: "DejaVuSansMono.ttf",
};

let cached: Promise<PdfFonts> | null = null;

/** Downloads the four font files once per page load (they are static files served with the app, then cached by the browser). */
export function fetchPdfFonts(base = "/fonts"): Promise<PdfFonts> {
  cached ??= (async () => {
    const entries = await Promise.all(
      (Object.keys(PDF_FONT_FILES) as (keyof PdfFonts)[]).map(async (key) => {
        const res = await fetch(`${base}/${PDF_FONT_FILES[key]}`);
        if (!res.ok) throw new Error(`Could not load the PDF font ${PDF_FONT_FILES[key]} (${res.status}).`);
        return [key, new Uint8Array(await res.arrayBuffer())] as const;
      }),
    );
    return Object.fromEntries(entries) as unknown as PdfFonts;
  })().catch((err) => {
    cached = null; // a failed download must not poison every later attempt
    throw err;
  });
  return cached;
}

/** Base64 of a byte array, in chunks so a multi-hundred-KB font does not overflow the argument limit. */
export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/** Which code points a TrueType font has a glyph for, read from its cmap table (formats 4 and 12, which cover every Unicode range in use). */
export function glyphCoverage(font: Uint8Array): (codePoint: number) => boolean {
  const v = new DataView(font.buffer, font.byteOffset, font.byteLength);
  const tables = v.getUint16(4);
  let cmap = -1;
  for (let i = 0; i < tables; i++) {
    const at = 12 + i * 16;
    if (String.fromCharCode(font[at], font[at + 1], font[at + 2], font[at + 3]) === "cmap") cmap = v.getUint32(at + 8);
  }
  if (cmap < 0) throw new Error("Font has no cmap table.");

  const ranges: [number, number][] = [];
  const subtables = v.getUint16(cmap + 2);
  for (let i = 0; i < subtables; i++) {
    const platform = v.getUint16(cmap + 4 + i * 8);
    const encoding = v.getUint16(cmap + 6 + i * 8);
    if (!(platform === 0 || (platform === 3 && (encoding === 1 || encoding === 10)))) continue; // Unicode maps only
    const t = cmap + v.getUint32(cmap + 8 + i * 8);
    const format = v.getUint16(t);
    if (format === 4) {
      const segments = v.getUint16(t + 6) / 2;
      const ends = t + 14;
      const starts = ends + segments * 2 + 2;
      for (let s = 0; s < segments; s++) {
        const end = v.getUint16(ends + s * 2);
        if (end !== 0xffff) ranges.push([v.getUint16(starts + s * 2), end]);
      }
    } else if (format === 12) {
      const groups = v.getUint32(t + 12);
      for (let g = 0; g < groups; g++) ranges.push([v.getUint32(t + 16 + g * 12), v.getUint32(t + 20 + g * 12)]);
    }
  }
  return (cp) => ranges.some(([lo, hi]) => cp >= lo && cp <= hi);
}

/** Scripts written right to left. The font has some of their glyphs, but drawn left to right unshaped they would read backwards or as broken letters. */
const isRightToLeft = (cp: number) => (cp >= 0x0590 && cp <= 0x08ff) || (cp >= 0xfb1d && cp <= 0xfdff) || (cp >= 0xfe70 && cp <= 0xfeff);
/** Characters that draw nothing: soft hyphens, zero-width marks, joiners, variation selectors, byte-order marks. */
const isInvisible = (cp: number) => cp === 0xad || (cp >= 0x200b && cp <= 0x200f) || (cp >= 0x202a && cp <= 0x202e) || cp === 0x2060 || (cp >= 0xfe00 && cp <= 0xfe0f) || cp === 0xfeff;

export interface PdfText {
  /** The text as the PDF will draw it: control characters become spaces, invisible ones vanish, unsupported ones become the marker. */
  clean(text: string): string;
  /** Every distinct character that was replaced so far, for the note at the end of the PDF. */
  replaced(): string[];
}

export function makePdfText(covers: (codePoint: number) => boolean): PdfText {
  const marker = covers(0xfffd) ? "�" : "?";
  const replaced = new Set<string>();
  return {
    clean(text) {
      let out = "";
      for (const ch of text) {
        const cp = ch.codePointAt(0)!;
        if (ch === "\n") out += ch;
        else if (cp < 0x20 || (cp >= 0x7f && cp <= 0x9f)) out += " ";
        else if (isInvisible(cp)) continue;
        // Beyond the BMP (emoji, rare CJK) is out too: jsPDF draws text one UTF-16 unit at a time, so those cannot be drawn even where the font has them.
        else if (isRightToLeft(cp) || cp > 0xffff || !covers(cp)) {
          replaced.add(ch);
          out += marker;
        } else out += ch;
      }
      return out;
    },
    replaced: () => [...replaced],
  };
}
