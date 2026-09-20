import type { Block, ReportDoc } from "../doc";

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** A table cell's tone, so Pass, Fail and warnings can be read at a glance rather than parsed. */
function chipClass(value: string): string | null {
  if (value === "Pass") return "good";
  if (value === "Fail" || value.startsWith("Failed")) return "bad";
  if (value === "Suspicious" || value === "Pending" || value === "Judge not configured") return "warn";
  return null;
}

function block(b: Block): string {
  switch (b.type) {
    case "heading":
      return `<h${b.level}>${escapeHtml(b.text)}</h${b.level}>`;
    case "paragraph": {
      const cls = b.tone ? ` class="${b.tone}"` : "";
      const lead = b.lead ? `<strong>${escapeHtml(b.lead)}</strong>${b.text ? " " : ""}` : "";
      return `<p${cls}>${lead}${escapeHtml(b.text)}</p>`;
    }
    case "list": {
      const tag = b.ordered ? "ol" : "ul";
      return `<${tag}>${b.items.map((i) => `<li>${escapeHtml(i)}</li>`).join("")}</${tag}>`;
    }
    case "quote":
      return `<blockquote>${b.text.split(/\n+/).map((l) => `<p>${escapeHtml(l)}</p>`).join("")}</blockquote>`;
    case "code":
      return `<pre>${escapeHtml(b.text)}</pre>`;
    case "table": {
      const head = b.columns.map((c) => `<th scope="col">${escapeHtml(c)}</th>`).join("");
      const body = b.rows
        .map((row) => {
          const cells = row.map((v) => {
            const chip = chipClass(v);
            return `<td>${chip ? `<span class="chip ${chip}">${escapeHtml(v)}</span>` : escapeHtml(v)}</td>`;
          });
          return `<tr>${cells.join("")}</tr>`;
        })
        .join("");
      return `<div class="scroll" tabindex="0"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
    }
  }
}

const CSS = `
:root { color-scheme: light; --ink: #1c2530; --muted: #5d6b7a; --line: #d9dfe6; --wash: #f4f6f8; --deep: #0f3d3e; --good: #146c43; --bad: #a12a2a; --warn: #8a5a00; }
* { box-sizing: border-box; }
body { margin: 0; background: #fff; color: var(--ink); font: 15px/1.6 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
main { max-width: 1480px; margin: 0 auto; padding: 32px 20px 64px; }
h1 { margin: 0 0 8px; font-size: 28px; line-height: 1.2; color: var(--deep); }
h2 { margin: 40px 0 8px; padding-bottom: 6px; border-bottom: 2px solid var(--line); font-size: 20px; color: var(--deep); }
h3 { margin: 28px 0 6px; font-size: 16px; color: var(--deep); }
h4 { margin: 20px 0 4px; font-size: 14px; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); }
p { margin: 6px 0; }
p.muted { color: var(--muted); font-size: 13px; }
p.warn { padding: 8px 12px; border: 1px solid #e6c98a; border-left-width: 4px; border-radius: 6px; background: #fdf6e7; color: var(--warn); }
ul, ol { margin: 6px 0; padding-left: 24px; }
li { margin: 2px 0; }
blockquote { margin: 6px 0; padding: 4px 14px; border-left: 4px solid var(--deep); background: var(--wash); border-radius: 0 6px 6px 0; }
blockquote p { margin: 4px 0; }
pre { margin: 6px 0; padding: 10px 12px; overflow-x: auto; white-space: pre-wrap; overflow-wrap: anywhere; background: var(--wash); border: 1px solid var(--line); border-radius: 6px; font: 12.5px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
.scroll { margin: 10px 0; overflow-x: auto; border: 1px solid var(--line); border-radius: 8px; }
table { width: 100%; border-collapse: collapse; font-size: 12px; line-height: 1.4; }
th, td { padding: 6px 8px; text-align: left; vertical-align: top; border-bottom: 1px solid var(--line); }
td:last-child { min-width: 16rem; }
th { background: var(--deep); color: #fff; font-weight: 600; white-space: nowrap; }
tbody tr:nth-child(even) { background: var(--wash); }
tbody tr:last-child td { border-bottom: 0; }
.chip { display: inline-block; padding: 1px 8px; border-radius: 999px; border: 1px solid currentColor; font-weight: 600; white-space: nowrap; }
.chip.good { color: var(--good); } .chip.bad { color: var(--bad); } .chip.warn { color: var(--warn); }
@page { size: A4 landscape; margin: 12mm; }
@media print {
  main { max-width: none; padding: 0; }
  body { font-size: 11px; }
  h2, h3, h4 { break-after: avoid; }
  tr, blockquote, pre { break-inside: avoid; }
  .scroll { overflow: visible; border: 0; }
  table { font-size: 9px; }
  th, tbody tr:nth-child(even), pre, blockquote, .chip { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
}
@media (max-width: 600px) { main { padding: 20px 14px 48px; } h1 { font-size: 23px; } }
`;

/** One self-contained page: styles inline, no scripts, no external files, so it opens anywhere and can be emailed as is. */
export function renderHtml(doc: ReportDoc): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(doc.title)}</title>
<style>${CSS}</style>
</head>
<body>
<main>
${doc.blocks.map(block).join("\n")}
</main>
</body>
</html>
`;
}
