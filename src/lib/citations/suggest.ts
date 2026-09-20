import { splitSections, type DocSection } from "./sections";

/**
 * Citations worth checking, pulled straight from a document with no model call: for each clause on a recognisable
 * topic, its own words (a verbatim quote) and a plain, testable claim a reviewer would typically make about that kind of
 * clause. Checking them shows, per document, which typical assumptions its actual clauses support, contradict, or ignore.
 */
export interface CitationSuggestion {
  /** The section this quote comes from; also the id a check reports. */
  id: string;
  sectionLabel: string;
  heading: string;
  topic: string;
  topicLabel: string;
  /** Verbatim from the clause (whitespace collapsed), so the exact-text search always finds it. */
  quote: string;
  claim: string;
}

const TOPICS: { topic: string; label: string; test: RegExp; claim: string }[] = [
  { topic: "auto_renewal", label: "Renewal", test: /auto(?:matically)?[\s-]+renew|renews?\b[^.]{0,60}\b(?:term|year|period)/i, claim: "The agreement renews automatically unless a party gives notice." },
  { topic: "indemnification", label: "Indemnity", test: /indemnif/i, claim: "Indemnification is mutual and limited to each party's own breaches." },
  { topic: "liability", label: "Liability", test: /limitation of liability|liabilit(?:y|ies)\b/i, claim: "Each party's total liability is capped at a stated amount." },
  { topic: "termination", label: "Termination", test: /terminat/i, claim: "Either party can terminate for convenience on short notice without paying a fee." },
  { topic: "data_protection", label: "Data", test: /personal (?:data|information)|data (?:processing|protection)|customer data/i, claim: "The agreement includes data protection obligations covering personal data." },
  { topic: "governing_law", label: "Governing law", test: /governed by|governing law|jurisdiction/i, claim: "A specific jurisdiction's law governs the agreement." },
  { topic: "restrictive_covenant", label: "Restriction", test: /shall not (?:work|compete|solicit)|non-?compet|restrictive covenant/i, claim: "The restriction is limited in geography and in duration." },
  { topic: "confidentiality", label: "Confidentiality", test: /confidential/i, claim: "Confidentiality obligations continue after the agreement ends." },
  { topic: "payment", label: "Payment", test: /\bfees?\b|payment|invoice/i, claim: "Payment is due by a stated date after invoice." },
];

const collapse = (s: string) => s.replace(/\s+/g, " ").trim();

/** The clause's first sentences, up to about 280 characters, ending on a sentence boundary. */
function excerpt(body: string): string {
  const sentences = collapse(body).split(/(?<=[.;])\s+(?=[A-Z"(])/);
  let out = "";
  for (const s of sentences) {
    if (out && (out + " " + s).length > 280) break;
    out = out ? `${out} ${s}` : s;
    if (out.length >= 60) break;
  }
  // A long single sentence is cut at a word, with no ellipsis: the quote must stay a verbatim substring of the clause.
  return out.length > 320 ? out.slice(0, 320).replace(/\s+\S*$/, "") : out;
}

const topicOf = (s: DocSection) => TOPICS.find((t) => t.test.test(`${s.heading} ${s.body}`));

export function suggestCitations(text: string | null | undefined, max = 6): CitationSuggestion[] {
  if (!text?.trim()) return [];
  const used = new Set<string>();
  const out: CitationSuggestion[] = [];
  for (const section of splitSections(text)) {
    const topic = topicOf(section);
    if (!topic || used.has(topic.topic)) continue; // one suggestion per topic keeps the list varied
    const quote = excerpt(section.body);
    if (quote.length < 30) continue;
    used.add(topic.topic);
    out.push({
      id: section.id,
      sectionLabel: `${section.id.replace("Doc ", "")} ${section.heading}`,
      heading: section.heading,
      topic: topic.topic,
      topicLabel: topic.label,
      quote,
      claim: topic.claim,
    });
    if (out.length >= max) break;
  }
  return out;
}
