import { AUTHORITY_SECTIONS } from "../data/authorities";

/**
 * The key terms a contract review looks for, each with the expectation it is checked against and the values worth pulling out
 * of the clause that covers it. The expectation is the internal playbook's own requirement where the playbook has one
 * (`src/lib/data/authorities.ts`), otherwise a standard term. Everything here is rule-based: no model is involved in finding
 * a clause or in extracting its figures, so that part is free, instant and identical every time.
 */
export interface Topic {
  id: string;
  label: string;
  /** A clause whose HEADING matches is very likely this topic. */
  heading: RegExp;
  /** A clause whose body matches may cover it too. */
  body: RegExp;
  /** Skips a clause that matches the words but is not about the topic (a contract that says it does NOT auto-renew). */
  applies?: (sectionText: string) => boolean;
  /** Wording that makes a clause the right one for THIS claim, when several clauses mention the topic ("survives" for confidentiality). */
  detail?: RegExp;
  /** What the clause is expected to say, written as a claim a reader can check. */
  claim: string;
  /** A key of AUTHORITY_SECTIONS, or null for a standard term with no playbook section. */
  playbook: string | null;
  /** Reported as Missing when the document has no clause on it at all. */
  core: boolean;
  /** Plain-language facts pulled from the clause: figures and the wording that matters. */
  facts: (clause: string) => string[];
}

const NUMBER_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12, fifteen: 15, thirty: 30, sixty: 60, ninety: 90 };
const UNIT = /(day|week|month|year)s?/;

const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? "" : "s"}`;

/** "thirty (30) days" and "18 months" and "one-year terms" all become "30 days", "18 months", "1 year". */
export function durations(text: string): string[] {
  const found: string[] = [];
  for (const m of text.matchAll(new RegExp(`(\\d+)\\)?[\\s-]+${UNIT.source}\\b`, "gi"))) found.push(plural(Number(m[1]), m[2].toLowerCase()));
  for (const m of text.matchAll(new RegExp(`\\b(${Object.keys(NUMBER_WORDS).join("|")})[\\s-]+${UNIT.source}\\b`, "gi"))) found.push(plural(NUMBER_WORDS[m[1].toLowerCase()], m[2].toLowerCase()));
  return [...new Set(found)];
}

export function money(text: string): string[] {
  return [...new Set([...text.matchAll(/\$\s?\d[\d,]*(?:\.\d+)?(?:\s?(?:million|thousand))?/gi)].map((m) => m[0].replace(/\s+/g, "")))];
}

export function jurisdiction(text: string): string[] {
  const m = text.match(/laws? of (?:the )?(?:State of |Commonwealth of |Province of )?([A-Z][A-Za-z]+(?: [A-Z][A-Za-z]+)?)(?=[,.;\s])/);
  return m ? [m[1]] : [];
}

/** The labels of the patterns that appear in the clause, in the order given. */
const flags = (text: string, rules: [RegExp, string][]) => rules.filter(([re]) => re.test(text)).map(([, label]) => label);

const NOT_RENEW = /(?:does|shall|will) not (?:automatically )?renew|no automatic renewal/i;

export const TOPICS: Topic[] = [
  {
    id: "auto_renewal",
    label: "Auto-renewal",
    heading: /renewal|renew\b/i,
    body: /auto(?:matically)?[\s-]+renew|renews?\b[^.]{0,60}\b(?:term|year|period)/i,
    applies: (t) => !NOT_RENEW.test(t),
    claim: "Auto-renewal gives the counterparty at least thirty (30) days' written notice to decline renewal, with no penalty.",
    playbook: "2.1",
    core: false,
    facts: (t) => [...flags(t, [[/automatically renews?|auto-?renews?/i, "auto-renews"]]), ...durations(t)],
  },
  {
    id: "indemnification",
    label: "Indemnification",
    heading: /indemn/i,
    body: /indemnif/i,
    claim: "Indemnification is mutual and limited to each party's own breaches, rather than the counterparty's ordinary liability or fault-free claims.",
    playbook: "3.4",
    core: false,
    facts: (t) =>
      flags(t, [
        [/each party|either party|mutual|the other only/i, "mutual"],
        [/\b(?:customer|provider|employee|company|client|vendor|supplier)\b[^.]{0,150}?\bshall indemnify/i, "one-way"],
        [/regardless of (?:the )?(?:theory of )?(?:liability|fault)|without regard to fault/i, "regardless of fault"],
      ]),
  },
  {
    id: "liability",
    label: "Liability cap",
    heading: /limitation of liability|liability/i,
    body: /limitation of liability|liabilit(?:y|ies)\b/i,
    claim: "Each party's liability is capped at a stated amount (by default, the fees paid in the preceding twelve months).",
    playbook: "4.2",
    core: true,
    facts: (t) => [
      ...flags(t, [
        [/shall not (?:be )?(?:limited|capped)|unlimited|uncapped|no (?:limit|cap)/i, "no cap"],
        [/shall not exceed|capped at|liability is capped|limited to/i, "capped"],
      ]),
      ...money(t),
    ],
  },
  {
    id: "data_protection",
    label: "Data protection",
    heading: /data (?:processing|protection|handling)|privacy/i,
    body: /personal (?:data|information)|customer data|end[\s-]users?/i,
    claim: "Personal data is covered by a data protection clause that addresses permitted use, security and breach notification.",
    playbook: "5.1",
    core: false,
    facts: (t) =>
      flags(t, [
        [/personal (?:data|information)/i, "personal data"],
        [/security|safeguard/i, "security"],
        [/breach notif|notify[^.]{0,40}breach/i, "breach notice"],
      ]),
  },
  {
    id: "termination",
    label: "Termination",
    heading: /terminat/i,
    body: /terminat/i,
    claim: "Either party may terminate for convenience on no more than ninety (90) days' notice and without a termination fee.",
    playbook: "6.3",
    core: true,
    facts: (t) => [
      ...flags(t, [
        [/for convenience/i, "for convenience"],
        [/at any time/i, "at any time"],
        [/termination fee|early termination|payment of an? [^.]*fee/i, "termination fee"],
      ]),
      ...durations(t),
    ],
  },
  {
    id: "governing_law",
    label: "Governing law",
    heading: /governing law|jurisdiction|choice of law/i,
    body: /governed by|governing law|jurisdiction/i,
    claim: "The agreement states which jurisdiction's law governs it.",
    playbook: null,
    core: true,
    facts: jurisdiction,
  },
  {
    id: "confidentiality",
    label: "Confidentiality",
    heading: /confidential/i,
    body: /confidential/i,
    detail: /surviv|remain in effect|after (?:termination|disclosure|the agreement ends)/i,
    claim: "Confidentiality obligations continue for a stated period after the agreement ends.",
    playbook: null,
    core: false,
    facts: (t) => [...flags(t, [[/surviv/i, "survives termination"]]), ...durations(t)],
  },
  {
    id: "restrictive_covenant",
    label: "Restriction on work",
    heading: /restrictive|non-?compet|covenant/i,
    body: /shall not (?:work|compete|solicit)|non-?compet|restrictive covenant/i,
    claim: "The restriction is limited in both duration and geography.",
    playbook: null,
    core: false,
    facts: (t) => [...flags(t, [[/anywhere in the world|worldwide|globally/i, "worldwide"]]), ...durations(t)],
  },
  {
    id: "payment",
    label: "Fees and payment",
    heading: /fees?|payment/i,
    body: /\bfees?\b|payment|invoice/i,
    claim: "The customer must pay within a stated number of days of invoice.",
    playbook: null,
    core: false,
    facts: (t) => [...durations(t), ...money(t)],
  },
];

/** Where an expectation comes from, for the reader: "Playbook §4.2", or "Standard term" when the playbook has no section on it. */
export function originOf(topic: Topic): string {
  return topic.playbook && AUTHORITY_SECTIONS[topic.playbook] ? `Playbook §${topic.playbook}` : "Standard term";
}
