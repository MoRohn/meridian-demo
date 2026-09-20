import type { AnswerAnalysis } from "./prompt";

/**
 * The answer when no answer-model key is saved: not a model's words, but the document's own. It finds the clauses most
 * relevant to the question and quotes them with their section, then adds the app's findings. It cannot interpret, and it
 * says so; what it gives is real, checkable text from the contract rather than a canned refusal.
 */
export interface Clause {
  /** "Section 4" when the clause is numbered, otherwise a position such as "Paragraph 3". */
  ref: string;
  /** The clause's heading when it has one ("Limitation of Liability"), otherwise its first words. */
  title: string;
  text: string;
}

const STOPWORDS = new Set(
  "a an and are as at be but by can could did do does for from had has have how i if in into is it its me my of on or our shall she should so than that the their them then there these they this to us was we were what when where which who whom why will with would you your about any all also am been being both each few more most no nor not only other out over own same some such too very terms clause clauses agreement contract document section provision".split(" "),
);

/**
 * A crude stem: enough to match "terminate", "terminated", "terminating" and "termination" to one another. Endings are
 * removed and the root is cut to six letters, so the different endings of one word cannot leave different roots.
 */
export function stem(word: string): string {
  let w = word.toLowerCase();
  for (const suffix of ["ations", "ation", "ings", "ing", "ions", "ion", "ates", "ated", "ate", "ies", "ied", "es", "ed", "s", "ly"]) {
    if (w.length - suffix.length >= 4 && w.endsWith(suffix)) {
      w = w.slice(0, -suffix.length);
      break;
    }
  }
  return w.slice(0, 6);
}

/** Words that mean the same thing in a contract, so a question about "payment" finds the clause titled "Fees". */
const SYNONYM_GROUPS: Record<string, string[]> = {
  fee: ["pay", "payment", "paid", "fee", "fees", "invoice", "price", "pricing", "cost", "charge", "billing", "compensation", "salary"],
  termination: ["terminate", "termination", "cancel", "cancellation", "exit", "quit", "leave", "resign", "notice"],
  liability: ["liability", "liable", "damages", "damage", "indemnify", "indemnity", "indemnification", "responsible", "responsibility", "cap"],
  renewal: ["renew", "renewal", "renews", "extend", "extension", "evergreen"],
  confidentiality: ["confidential", "confidentiality", "secret", "disclose", "disclosure", "private", "proprietary", "nda"],
  law: ["law", "governing", "jurisdiction", "court", "venue", "dispute", "arbitration"],
  data: ["data", "privacy", "personal", "breach", "security", "gdpr", "leak", "incident"],
  compete: ["compete", "competition", "noncompete", "non-compete", "restrictive", "solicit", "solicitation"],
};
const CANON = new Map<string, string>();
for (const [group, words] of Object.entries(SYNONYM_GROUPS)) for (const w of words) CANON.set(stem(w), group);

export function keywords(text: string): string[] {
  return (text.toLowerCase().match(/[a-z][a-z'-]+/g) ?? [])
    .filter((w) => !STOPWORDS.has(w) && w.length > 2)
    .map((w) => {
      const s = stem(w);
      return CANON.get(s) ?? s;
    });
}

/** Splits a contract into clauses: blank-line separated blocks, each labelled by its number or heading when it has one. */
export function splitClauses(text: string): Clause[] {
  const blocks = text.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);
  const clauses: Clause[] = [];
  blocks.forEach((block, i) => {
    const numbered = block.match(/^(\d+(?:\.\d+)*)[.)]?\s+([^\n.]{2,80}?)[.:]\s+([\s\S]*)$/);
    if (numbered) {
      clauses.push({ ref: `Section ${numbered[1]}`, title: numbered[2].trim(), text: block });
      return;
    }
    const numberOnly = block.match(/^(\d+(?:\.\d+)*)[.)]?\s+([\s\S]*)$/);
    if (numberOnly) {
      clauses.push({ ref: `Section ${numberOnly[1]}`, title: numberOnly[2].split(/[.\n]/)[0].slice(0, 60), text: block });
      return;
    }
    // A title line or a preamble is context, not a clause worth quoting on its own.
    if (block.length < 60 && !/[.]$/.test(block)) return;
    clauses.push({ ref: `Paragraph ${i + 1}`, title: block.split(/[.\n]/)[0].slice(0, 60), text: block });
  });
  return clauses;
}

/** The clauses that share the most rare words with the question, best first. Rare words count for more than common ones. */
export function rankClauses(question: string, clauses: readonly Clause[], limit = 3): Clause[] {
  const q = new Set(keywords(question));
  if (q.size === 0) return [];
  const docs = clauses.map((c) => new Set(keywords(`${c.title} ${c.text}`)));
  const idf = (term: string) => Math.log(1 + clauses.length / (1 + docs.filter((d) => d.has(term)).length));
  const scored = clauses.map((clause, i) => {
    let score = 0;
    for (const term of q) if (docs[i].has(term)) score += idf(term) * (keywords(clause.title).includes(term) ? 2 : 1);
    return { clause, score };
  });
  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => s.clause);
}

const clip = (s: string, n: number) => {
  const flat = s.replace(/\s+/g, " ").trim();
  return flat.length <= n ? flat : `${flat.slice(0, n - 1).trimEnd()}…`;
};

const pct = (x: number) => `${Math.round(x * 100)}%`;

function findings(a: AnswerAnalysis): string | null {
  const lines: string[] = [];
  if (a.risk) lines.push(`Meridian scored this document at **${pct(a.risk.overall)} overall risk** (${a.risk.band}).`);
  const flagged = a.flags.filter((f) => f.flagged);
  if (flagged.length) lines.push(`It trips ${flagged.length} compliance flag${flagged.length === 1 ? "" : "s"}: ${flagged.map((f) => f.label).join("; ")}.`);
  return lines.length ? lines.join(" ") : null;
}

const NO_KEY_NOTE = "This is the document's own wording, not an interpretation. Save an OpenAI key in the gear-icon Settings and I'll answer in full.";

export function buildExtractiveAnswer(input: { message: string; document: { name: string; text: string } | null; analysis: AnswerAnalysis; mode: "question" | "summary" }): string {
  const { message, document, analysis, mode } = input;
  if (!document) {
    return "I don't have a document to read yet. Pick a sample contract on the left or upload one, and I can quote the clauses that answer your question. Save an OpenAI key in the gear-icon Settings for fuller answers.";
  }
  const clauses = splitClauses(document.text);
  const out: string[] = [];

  if (mode === "summary") {
    out.push(`**${document.name}**${analysis.contractType ? ` reads as a ${analysis.contractType}` : ""}. It has ${clauses.length} clause${clauses.length === 1 ? "" : "s"}:`);
    out.push(clauses.slice(0, 12).map((c) => `- ${c.ref}: ${clip(c.title, 60)}`).join("\n"));
    const f = findings(analysis);
    if (f) out.push(f);
    out.push(NO_KEY_NOTE);
    return out.join("\n\n");
  }

  const hits = rankClauses(message, clauses);
  if (hits.length === 0) {
    out.push(`I couldn't find language in ${document.name} that speaks to that. Either it isn't addressed, or it's worded differently from your question. Try naming the clause or term you mean.`);
  } else {
    out.push(`The most relevant language in ${document.name}:`);
    for (const c of hits) out.push(`> ${clip(c.text, 420)}\n${c.ref}: ${clip(c.title, 60)}`);
  }
  const f = findings(analysis);
  if (f) out.push(f);
  out.push(NO_KEY_NOTE);
  return out.join("\n\n");
}
