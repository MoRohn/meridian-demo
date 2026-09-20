/**
 * Assistant replies are plain text with a little structure: paragraphs, "- " bullets, "1. " steps, "> " quoted clauses and
 * **bold**. This reads that structure so the chat can show it, without pulling in a Markdown engine or trusting model
 * output as HTML: the result is data, and the component turns each piece into React elements.
 */
export type ChatBlock =
  | { type: "paragraph"; text: string }
  | { type: "bullets"; items: string[] }
  | { type: "steps"; items: string[] }
  | { type: "quote"; text: string };

const BULLET = /^\s*[-*•]\s+(.*)$/;
const STEP = /^\s*\d+[.)]\s+(.*)$/;
const QUOTE = /^\s*>\s?(.*)$/;

export function parseChatText(text: string): ChatBlock[] {
  const blocks: ChatBlock[] = [];
  let run: ChatBlock | null = null;
  const flush = () => {
    if (run) blocks.push(run);
    run = null;
  };

  for (const raw of text.replace(/\r\n/g, "\n").split("\n")) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      flush();
      continue;
    }
    const bullet = line.match(BULLET);
    const step = line.match(STEP);
    const quote = line.match(QUOTE);
    if (bullet) {
      if (run?.type !== "bullets") {
        flush();
        run = { type: "bullets", items: [] };
      }
      (run as Extract<ChatBlock, { type: "bullets" }>).items.push(bullet[1]);
    } else if (step) {
      if (run?.type !== "steps") {
        flush();
        run = { type: "steps", items: [] };
      }
      (run as Extract<ChatBlock, { type: "steps" }>).items.push(step[1]);
    } else if (quote) {
      if (run?.type !== "quote") {
        flush();
        run = { type: "quote", text: "" };
      }
      const q = run as Extract<ChatBlock, { type: "quote" }>;
      q.text = q.text ? `${q.text} ${quote[1]}` : quote[1];
    } else if (run?.type === "paragraph") {
      run.text += ` ${line.trim()}`; // a soft line break inside a paragraph
    } else {
      flush();
      run = { type: "paragraph", text: line.trim() };
    }
  }
  flush();
  return blocks;
}

/** Splits a line into plain and **bold** runs. */
export function parseInline(text: string): { text: string; bold: boolean }[] {
  return text
    .split(/(\*\*[^*]+\*\*)/g)
    .filter(Boolean)
    .map((part) => (part.startsWith("**") && part.endsWith("**") && part.length > 4 ? { text: part.slice(2, -2), bold: true } : { text: part, bold: false }));
}
