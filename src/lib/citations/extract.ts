import { splitSections, type DocSection } from "./sections";
import { TOPICS, originOf, type Topic } from "./topics";

/**
 * The automatic first half of Citations: read a document (or a highlighted passage) and pull out what there is to check, with
 * no model call. Two kinds of check come out:
 *
 *   reference  A citation the text itself makes: a cross-reference ("under Section 4"), a legal citation ("15 U.S.C. § 1"),
 *              an attachment ("Exhibit A"). An internal one is checked against the section it cites; one that points at a
 *              section that does not exist is a broken reference, found by rule.
 *   term       A key term (renewal, liability cap, termination, ...): the clause that covers it, quoted verbatim, with the
 *              figures pulled out of it, to be checked against what the playbook expects. A core term with no clause at all
 *              is reported as missing.
 *
 * The second half (does the clause actually support the claim) is a model's judgment, run in one batched call per backend.
 */
export type CheckKind = "reference" | "term";
/** model: a model judges it. broken / external / missing: decided here, by rule, and never sent to a model. */
export type Resolution = "model" | "broken" | "external" | "missing";

export interface Check {
  id: string;
  kind: CheckKind;
  resolution: Resolution;
  title: string;
  /** Where the expectation comes from: "Playbook §4.2", "Standard term", "Cross-reference", "Legal citation", "Attachment". */
  origin: string;
  /** What is being checked, as a claim a reader can verify. */
  claim: string;
  /** What the reader is told is being checked, in one line. */
  question: string | null;
  /** Where the evidence sits in the text, as a reader would say it: "§4 Limitation of Liability". */
  where: string | null;
  /** The verbatim words from the document that the check rests on. */
  quote: string | null;
  /** The text a model judges the claim against: the clause, or the section a reference points to. Null for rule-decided checks. */
  source: string | null;
  /** The id the judge is shown as the source's location, e.g. "Doc §4". */
  sourceId: string | null;
  /** Figures and key wording pulled from the clause. */
  facts: string[];
  /** For rule-decided checks, the reason in plain words. */
  note: string | null;
}

export interface Extraction {
  scope: "document" | "excerpt";
  checks: Check[];
  /** How many clauses the text was split into. */
  sections: number;
  /** How many references beyond the cap were found and left unchecked. Absent when nothing was left out. */
  omittedReferences?: number;
}

const collapse = (s: string) => s.replace(/\s+/g, " ").trim();
const sentencesOf = (text: string) => collapse(text).split(/(?<=[.;!?])\s+(?=[A-Z"(“])/);
const clip = (s: string, n: number) => (s.length <= n ? s : `${s.slice(0, n).replace(/\s+\S*$/, "")}…`);

/** "§4 Limitation of Liability", or "Selected passage" for text that was not numbered. */
export function sectionLabel(s: DocSection | { id: string; heading: string }): string {
  if (s.id === "Selection") return "Selected passage";
  return `${s.id.replace("Doc ", "")} ${s.heading}`.trim();
}

/**
 * The sections a text is read as. A document is read as its numbered clauses, or its paragraphs. A highlighted passage is read
 * as numbered clauses if it spans some, and otherwise as one piece of text, "Selected passage", whatever its length.
 */
function sectionsOf(text: string, scope: "document" | "excerpt"): DocSection[] {
  const found = splitSections(text);
  const numbered = found.some((s) => s.id.startsWith("Doc \u00a7"));
  if (found.length > 0 && (scope === "document" || numbered)) return found;
  const body = collapse(text);
  return body.length >= 20 ? [{ id: "Selection", number: "", heading: "Selected passage", text: body, body }] : [];
}

// ---- key terms --------------------------------------------------------------------------------------------------------------

function relevance(topic: Topic, s: DocSection): number {
  if (topic.applies && !topic.applies(s.text)) return 0;
  const inHeading = topic.heading.test(s.heading) ? 3 : 0;
  const inBody = (s.body.match(new RegExp(topic.body.source, "gi")) ?? []).length;
  // A clause that says the very thing the claim is about beats one that only shares the topic word.
  const detail = topic.detail && inBody > 0 && topic.detail.test(s.text) ? 5 : 0;
  return inHeading + Math.min(inBody, 3) + detail;
}

/**
 * The words from the clause that carry the topic, verbatim: the run of sentences starting at the first one that mentions it,
 * long enough to mean something and short enough to read. One very long sentence is cut around the mention instead of at its
 * start, with an ellipsis where it is cut, so the quote shows the relevant part.
 */
function evidenceQuote(topic: Topic, s: DocSection): string {
  const sentences = sentencesOf(s.body);
  const start = Math.max(0, sentences.findIndex((x) => topic.body.test(x)));
  const first = sentences[start] ?? s.body;
  if (first.length > 320) {
    const at = Math.max(0, first.search(new RegExp(topic.body.source, "i")));
    const from = Math.max(0, at - 110);
    const to = Math.min(first.length, from + 300);
    const cut = first.slice(from, to).replace(from > 0 ? /^\S*\s/ : /^/, "").replace(to < first.length ? /\s\S*$/ : /$/, "");
    return `${from > 0 ? "\u2026" : ""}${cut}${to < first.length ? "\u2026" : ""}`;
  }
  let out = "";
  for (const sentence of sentences.slice(start)) {
    if (out && `${out} ${sentence}`.length > 320) break;
    out = out ? `${out} ${sentence}` : sentence;
    if (out.length >= 80) break;
  }
  return out || first;
}

/**
 * Whether a text reads as a contract, which is what makes the ABSENCE of a term worth reporting: a thank-you letter has no
 * governing-law clause and that is not a finding. It does if it says what contracts say ("shall", "the parties", "this
 * Agreement") a few times, or if several of the terms below turned up in it.
 */
function looksLikeContract(text: string, termsFound: number): boolean {
  const signals = (text.match(/\b(?:shall|hereby|the parties|each party|either party|this agreement|the agreement|whereas)\b/gi) ?? []).length;
  return termsFound >= 2 || signals >= 3;
}

function termChecks(sections: DocSection[], scope: "document" | "excerpt", fullText: string): Check[] {
  const checks: Check[] = [];
  const found = new Map<string, DocSection>();
  for (const topic of TOPICS) {
    const best = sections
      .map((s) => ({ s, score: relevance(topic, s) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)[0]?.s;
    if (best) found.set(topic.id, best);
  }
  const contract = looksLikeContract(fullText, found.size);
  for (const topic of TOPICS) {
    const best = found.get(topic.id);
    if (best) {
      checks.push({
        id: `term_${topic.id}`, kind: "term", resolution: "model", title: topic.label, origin: originOf(topic),
        claim: topic.claim, question: topic.claim, where: sectionLabel(best), quote: evidenceQuote(topic, best),
        source: best.text, sourceId: best.id, facts: topic.facts(best.text), note: null,
      });
    } else if (topic.core && scope === "document" && contract) {
      checks.push({
        id: `term_${topic.id}`, kind: "term", resolution: "missing", title: topic.label, origin: originOf(topic),
        claim: topic.claim, question: topic.claim, where: null, quote: null, source: null, sourceId: null, facts: [],
        note: "No clause on this was found in the document.",
      });
    }
  }
  return checks;
}

// ---- references written in the text -----------------------------------------------------------------------------------------

const INTERNAL = /\b(?:Sections?|Articles?|Clauses?)\s+(\d+(?:\.\d+)*(?:(?:\s*,\s*|\s+and\s+|\s+or\s+)\d+(?:\.\d+)*)*)|§§?\s*(\d+(?:\.\d+)*)/gi;

const LEGAL: [RegExp, string][] = [
  [/\b\d+\s+U\.?S\.?C\.?\s*(?:§+\s*)?\d+[\w.()-]*/g, "Legal citation"],
  [/\b\d+\s+C\.?F\.?R\.?\s*(?:§+\s*)?[\d.]+/g, "Legal citation"],
  [/\b(?:GDPR|CCPA|CPRA|HIPAA|FERPA|GLBA|FCRA|COPPA|DMCA|ERISA|FLSA|FMLA)\b(?:\s+(?:Art(?:icle)?\.?\s*\d+[\w()]*|§\s*\d+[\w.()-]*))?/g, "Legal citation"],
  [/\b[A-Z][A-Za-z.&'-]+(?: [A-Z][A-Za-z.&'-]+){0,3} v\. [A-Z][A-Za-z.&'-]+(?: [A-Z][A-Za-z.&'-]+){0,3}(?:,? \d+ [A-Z][A-Za-z.]*(?: ?\d[a-z]{1,2})? \d+)?/g, "Legal citation"],
];
const ATTACHMENT = /\b(?:Exhibit|Schedule|Appendix|Annex|Addendum)\s+[A-Z0-9]{1,3}\b/g;

/** The most references one text raises. Any beyond it are counted (see Extraction.omittedReferences), never silently dropped. */
export const MAX_REFERENCES = 12;

/** Words that, after "of the", still mean this document ("Section 4 of the Lease"), so the reference is internal. */
const OWN_DOCUMENT = /^(?:this\b|the\s+(?:this\s+)?(?:Agreement|Lease|Contract|MSA|Order|Addendum|Exhibit|Schedule|Policy|Plan|Terms)\b|(?:Agreement|Lease|Contract)\b)/i;

/** What follows a reference names a source outside the document: "of the Internal Revenue Code", "of Title 26", "of the Municipal Code". */
const OUTSIDE_SOURCE = /^\s*(?:\([a-z0-9]+\)\s*)*,?\s*(?:of|under)\s+((?:the\s+)?[A-Z0-9][^.;]*)/;

/**
 * Whether a "Section N" that is not among this document's clauses is most likely a citation to something else, rather
 * than a broken reference to this document. Two clues, either of which is enough: what follows it names an outside source
 * ("Section 1402 of the Internal Revenue Code"), or its number is far beyond anything this document numbers (a lease with
 * thirty clauses does not cite its own Section 1402). A small miss next to real clauses (Section 9 of 6) stays broken.
 */
function pointsOutside(number: string, after: string, numbered: DocSection[]): boolean {
  const named = after.match(OUTSIDE_SOURCE);
  if (named && !OWN_DOCUMENT.test(named[1].trim())) return true;
  const top = Math.max(0, ...numbered.map((s) => parseInt(s.number, 10)).filter(Number.isFinite));
  const n = parseInt(number, 10);
  return Number.isFinite(n) && n >= 100 && n > top * 4;
}

/** Finds the target of an internal reference among the whole document's numbered clauses: "4.2" falls back to clause 4, which is not split further. */
function targetOf(number: string, numbered: DocSection[]): DocSection | null {
  return numbered.find((s) => s.number === number) ?? numbered.find((s) => number.startsWith(`${s.number}.`)) ?? null;
}

function referenceChecks(sections: DocSection[], full: DocSection[]): { checks: Check[]; omitted: number } {
  const numbered = full.filter((s) => s.id.startsWith("Doc §"));
  const checks: Check[] = [];
  const seen = new Set<string>();
  let omitted = 0;

  const add = (c: Omit<Check, "id" | "kind" | "facts">, dedupe: string) => {
    if (seen.has(dedupe)) return;
    seen.add(dedupe);
    if (checks.length >= MAX_REFERENCES) {
      omitted += 1;
      return;
    }
    checks.push({ ...c, id: `ref_${checks.length + 1}`, kind: "reference", facts: [] });
  };

  for (const s of sections) {
    for (const sentence of sentencesOf(s.body)) {
      // Legal citations are found first and blanked out before internal references are read: "GDPR Article 28" and
      // "15 U.S.C. \u00a7 1681" contain numbers that are not sections of this document.
      let masked = sentence;
      for (const [pattern] of LEGAL) masked = masked.replace(pattern, (hit) => " ".repeat(hit.length));
      for (const m of masked.matchAll(INTERNAL)) {
        for (const number of m[1] ? (m[1].match(/\d+(?:\.\d+)*/g) ?? []) : [m[2]]) {
          if (!number || number === s.number) continue; // a clause naming itself is not a citation
          const target = targetOf(number, numbered);
          const base = { title: `Cites Section ${number}`, origin: "Cross-reference", claim: clip(sentence, 320), where: sectionLabel(s), quote: clip(sentence, 320) };
          if (numbered.length === 0) {
            add({ ...base, resolution: "external", question: null, source: null, sourceId: null, note: "This text has no numbered sections, so a section reference cannot be resolved." }, `${number}|${sentence}`);
          } else if (!target) {
            if (pointsOutside(number, masked.slice((m.index ?? 0) + m[0].length), numbered)) {
              add({ ...base, resolution: "external", question: null, source: null, sourceId: null, note: `Section ${number} is not one of this document's clauses. It appears to cite outside law or another document, so it cannot be checked here.` }, `${number}|${sentence}`);
            } else {
              add({ ...base, resolution: "broken", question: null, source: null, sourceId: null, note: `Section ${number} does not exist in this document.` }, `${number}|${sentence}`);
            }
          } else {
            add({ ...base, title: `Cites ${sectionLabel(target)}`, resolution: "model", question: `Does ${sectionLabel(target)} say what this sentence relies on?`, source: target.text, sourceId: target.id, note: null }, `${target.id}|${sentence}`);
          }
        }
      }
      for (const [pattern, origin] of LEGAL) {
        for (const m of sentence.matchAll(pattern)) {
          const cite = collapse(m[0]).replace(/[.,;:]+$/, ""); // the sentence's own punctuation is not part of the citation
          add({ title: cite, origin, claim: clip(sentence, 320), question: null, where: sectionLabel(s), quote: clip(sentence, 320), resolution: "external", source: null, sourceId: null, note: "An outside source. It is not among the loaded sources, so it cannot be checked here." }, `${cite}|${sentence}`);
        }
      }
      for (const m of sentence.matchAll(ATTACHMENT)) {
        add({ title: m[0], origin: "Attachment", claim: clip(sentence, 320), question: null, where: sectionLabel(s), quote: clip(sentence, 320), resolution: "external", source: null, sourceId: null, note: "An attachment that is not part of this text, so it cannot be checked here." }, `${m[0]}|${sentence}`);
      }
    }
  }
  return { checks, omitted };
}

/**
 * Everything to check in `text`. For a highlighted passage, `text` is the passage and `fullText` the whole document, so a
 * reference inside the passage is still resolved against the document's own sections. A passage gets no "missing" findings:
 * a paragraph not mentioning governing law says nothing about the contract.
 */
export function extractChecks(args: { text: string; fullText?: string; scope: "document" | "excerpt" }): Extraction {
  const { text, scope } = args;
  if (!text?.trim()) return { scope, checks: [], sections: 0 };
  const sections = sectionsOf(text, scope);
  const full = scope === "document" ? sections : splitSections(args.fullText ?? text);
  const refs = referenceChecks(sections, full);
  return {
    scope,
    checks: [...refs.checks, ...termChecks(sections, scope, text)],
    sections: sections.length,
    ...(refs.omitted > 0 ? { omittedReferences: refs.omitted } : {}),
  };
}
