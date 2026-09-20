import type { Block, ReportDoc } from "../doc";

const oneLine = (s: string) => s.replace(/\s+/g, " ").trim().replace(/\|/g, "\\|");

/** Text as a fenced code block, using a fence longer than any run of backticks inside it so nothing can break out. */
function fence(text: string): string {
  const longest = Math.max(2, ...(text.match(/`+/g) ?? []).map((m) => m.length));
  const ticks = "`".repeat(longest + 1);
  return `${ticks}text\n${text}\n${ticks}`;
}

function block(b: Block): string {
  switch (b.type) {
    case "heading":
      return `${"#".repeat(b.level)} ${b.text}`;
    case "paragraph": {
      const body = b.tone === "muted" && b.text ? `_${b.text}_` : b.text;
      return b.lead ? `**${b.lead}**${body ? ` ${body}` : ""}` : body;
    }
    case "list":
      return b.items.map((item, i) => `${b.ordered ? `${i + 1}.` : "-"} ${item}`).join("\n");
    case "quote":
      return b.text.split(/\n+/).map((line) => `> ${line}`).join("\n");
    case "code":
      return fence(b.text);
    case "table":
      return [`| ${b.columns.map(oneLine).join(" | ")} |`, `| ${b.columns.map(() => "---").join(" | ")} |`, ...b.rows.map((r) => `| ${r.map(oneLine).join(" | ")} |`)].join("\n");
  }
}

export function renderMarkdown(doc: ReportDoc): string {
  return `${doc.blocks.map(block).join("\n\n")}\n`;
}
