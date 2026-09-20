/**
 * Splits a document into pages that each fill one sheet of the Document panel.
 *
 * A sheet holds a fixed number of text lines (`rows`) of a given width (`cols`, in characters), and both depend on the zoom and
 * the panel's width, so the caller measures them (see measure.ts) and this module only does the layout, which keeps it pure
 * and testable. The layout mimics how the browser wraps the text (`white-space: pre-wrap`, words kept whole), then:
 *
 *  - keeps a paragraph whole when it fits on a page, starting a new page rather than splitting it;
 *  - splits a paragraph taller than a page at a line boundary, never leaving a single line alone on either side;
 *  - keeps a heading with the paragraph that follows it instead of stranding it at the foot of a page.
 *
 * Every page is a slice of the source text, so nothing is dropped or altered, and `start` says where it begins so the reader's
 * place can be found again after the pages are re-flowed at another zoom.
 */

export interface PageLayout {
  /** Characters that fit across one line of a sheet. */
  cols: number;
  /** Lines that fit down one sheet. */
  rows: number;
}

export interface Page {
  text: string;
  /** Offset of the page's first character in the normalized source (see `normalizeText`). */
  start: number;
}

interface Line {
  start: number;
  end: number;
}

interface Fragment {
  start: number;
  end: number;
  lines: number;
  /** Blank lines between this fragment and the one before it. */
  gap: number;
  heading: boolean;
}

const MIN_COLS = 20;
const MIN_ROWS = 6;
/** A heading is a short single line that does not read as a sentence. */
const HEADING_MAX_CHARS = 90;

/** Line endings normalized, so offsets and the browser's rendering agree. */
export function normalizeText(text: string): string {
  return text.replace(/\r\n?/g, "\n");
}

/** The visual lines one logical line wraps to: words are kept whole, and a word longer than a line is broken. */
function wrapLine(text: string, start: number, end: number, cols: number): Line[] {
  const lines: Line[] = [];
  let lineStart = -1;
  let lineEnd = start;
  const flush = () => {
    if (lineStart >= 0) lines.push({ start: lineStart, end: lineEnd });
    lineStart = -1;
  };
  for (const match of text.slice(start, end).matchAll(/\S+/g)) {
    let from = start + match.index;
    const to = from + match[0].length;
    while (to - from > cols) {
      flush();
      lines.push({ start: from, end: from + cols });
      from += cols;
    }
    if (lineStart >= 0 && to - lineStart > cols) flush();
    // A logical line keeps its indentation: its first visual line starts at the line's own start.
    if (lineStart < 0) lineStart = lines.length === 0 ? start : from;
    lineEnd = to;
  }
  flush();
  return lines.length ? lines : [{ start, end: start }];
}

interface Block {
  lines: Line[];
  gap: number;
}

/** Paragraphs: runs of non-blank lines, each with the blank lines that came before it. */
function blocksOf(text: string, cols: number): Block[] {
  const blocks: Block[] = [];
  let gap = 0;
  let current: Block | null = null;
  let offset = 0;
  for (const raw of text.split("\n")) {
    const start = offset;
    const end = offset + raw.length;
    offset = end + 1;
    if (raw.trim() === "") {
      current = null;
      gap += 1;
      continue;
    }
    if (!current) {
      current = { lines: [], gap: blocks.length ? Math.max(1, gap) : 0 };
      blocks.push(current);
      gap = 0;
    }
    current.lines.push(...wrapLine(text, start, end, cols));
  }
  return blocks;
}

const looksLikeHeading = (block: Block, text: string): boolean => {
  if (block.lines.length !== 1) return false;
  const line = text.slice(block.lines[0].start, block.lines[0].end).trim();
  return line.length > 0 && line.length <= HEADING_MAX_CHARS && !/[.;:,]$/.test(line);
};

export function paginate(source: string, layout: PageLayout): Page[] {
  const text = normalizeText(source);
  const cols = Math.max(MIN_COLS, Math.floor(layout.cols));
  const rows = Math.max(MIN_ROWS, Math.floor(layout.rows));
  const blocks = blocksOf(text, cols);
  if (blocks.length === 0) return [{ text: "", start: 0 }];

  const pages: Fragment[][] = [];
  let current: Fragment[] = [];
  let used = 0;

  const close = () => {
    if (current.length) pages.push(current);
    current = [];
    used = 0;
  };
  /** Closes the page, carrying a heading left at its foot over to the next one. */
  const closeKeepingHeading = () => {
    const last = current[current.length - 1];
    const carried = current.length > 1 && last.heading ? current.pop()! : null;
    close();
    if (carried) {
      current = [{ ...carried, gap: 0 }];
      used = carried.lines;
    }
  };

  for (const block of blocks) {
    const first = block.lines[0];
    const last = block.lines[block.lines.length - 1];
    const whole: Fragment = { start: first.start, end: last.end, lines: block.lines.length, gap: block.gap, heading: looksLikeHeading(block, text) };
    const gap = current.length ? block.gap : 0;

    if (used + gap + whole.lines <= rows) {
      current.push({ ...whole, gap });
      used += gap + whole.lines;
      continue;
    }

    if (whole.lines <= rows) {
      closeKeepingHeading();
      current.push({ ...whole, gap: 0 });
      used = whole.lines;
      continue;
    }

    // Taller than a page: fill what is left of this one, then whole pages, with no lone line at either edge of a split.
    let room = current.length ? rows - used - gap : 0;
    if (room < 3) {
      closeKeepingHeading();
      room = rows - used;
    }
    let index = 0;
    let lead = current.length ? gap : 0;
    while (index < block.lines.length) {
      let take = Math.min(room, block.lines.length - index);
      if (block.lines.length - index - take === 1 && take > 2) take -= 1;
      current.push({ start: block.lines[index].start, end: block.lines[index + take - 1].end, lines: take, gap: lead, heading: false });
      used += lead + take;
      index += take;
      if (index < block.lines.length) {
        close();
        room = rows;
        lead = 0;
      }
    }
  }
  close();

  return pages.map((fragments) => ({ text: text.slice(fragments[0].start, fragments[fragments.length - 1].end), start: fragments[0].start }));
}

/** The page holding an offset: the last one that starts at or before it. */
export function pageAt(pages: Page[], offset: number): number {
  let found = 0;
  for (let i = 0; i < pages.length; i += 1) {
    if (pages[i].start <= offset) found = i;
    else break;
  }
  return found;
}
