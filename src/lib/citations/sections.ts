/**
 * Splits a document into its clauses so it can be used as a citation SOURCE: a quote is located inside one section, and
 * that section is what the model judges the claim against. Numbered contracts ("1. Term and Renewal. ...") split on their
 * numbering; anything else (a pasted letter, a PDF that lost its numbering) falls back to paragraphs.
 */
export interface DocSection {
  /** The id the citation check reports, e.g. "Doc §3" or "Doc ¶2". */
  id: string;
  /** The clause number as written ("3", "4.2"), or the paragraph number. */
  number: string;
  heading: string;
  /** The whole clause, heading included, with its original line breaks. */
  text: string;
  /** The clause without its heading, which is what a quote is taken from. */
  body: string;
}

const CLAUSE_START = /^\s*(?:section\s+|article\s+|§\s*)?(\d+(?:\.\d+)*)[.)]\s+(\S.*)$/i;
/** "Term and Renewal." at the start of a clause: a short Title Case phrase ended by a period. */
const HEADING = /^([A-Z][A-Za-z0-9 ,&/'()-]{2,60}?)\.\s+([\s\S]*)$/;

const collapse = (s: string) => s.replace(/\s+/g, " ").trim();

function headingAndBody(firstLine: string, rest: string): { heading: string; body: string } {
  const joined = `${firstLine}${rest ? "\n" + rest : ""}`;
  const m = joined.match(HEADING);
  if (m && m[1].split(/\s+/).length <= 8) return { heading: collapse(m[1]), body: collapse(m[2]) };
  const words = collapse(joined).split(" ");
  return { heading: words.slice(0, 6).join(" ") + (words.length > 6 ? "…" : ""), body: collapse(joined) };
}

export function splitSections(text: string): DocSection[] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const numbered: { number: string; first: string; rest: string[] }[] = [];
  for (const line of lines) {
    const m = line.match(CLAUSE_START);
    if (m) numbered.push({ number: m[1], first: m[2], rest: [] });
    else if (numbered.length > 0 && line.trim()) numbered[numbered.length - 1].rest.push(line.trim());
  }

  if (numbered.length >= 2) {
    return numbered.map((n) => {
      const { heading, body } = headingAndBody(n.first, n.rest.join("\n"));
      return { id: `Doc §${n.number}`, number: n.number, heading, text: collapse(`${heading}. ${body}`), body };
    });
  }

  // No usable numbering: paragraphs, so a pasted letter or a stripped PDF can still be cited.
  return text
    .split(/\n\s*\n/)
    .map((p) => collapse(p))
    .filter((p) => p.length >= 60)
    .map((p, i) => {
      const { heading, body } = headingAndBody(p, "");
      return { id: `Doc ¶${i + 1}`, number: String(i + 1), heading, text: p, body };
    });
}

/** The document's sections as citation sources, keyed by the id a check reports. Empty when there is no document. */
export function documentAuthorities(text: string | null | undefined): Record<string, string> {
  if (!text?.trim()) return {};
  return Object.fromEntries(splitSections(text).map((s) => [s.id, s.text]));
}
