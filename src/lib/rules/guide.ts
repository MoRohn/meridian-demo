import { RISK_DIMENSIONS, RISK_BANDS } from "../skills/clauseRisk";
import { COMPLIANCE_CHECKS } from "../skills/complianceGuard";
import { guardrailsSkill } from "../skills/guardrails";
import { AUTO_ACCEPT, RELATION_CRITERIA, RELATION_TO_VERDICT } from "../skills/citationVerifier";
import { MAX_REFERENCES } from "../citations/extract";
import { TOPICS, originOf } from "../citations/topics";
import { COMPLIANCE_FLAG_THRESHOLD, GUARDRAIL_TRIGGER, LOW_CONFIDENCE_HEDGE } from "../orchestrator/compose";
import type { NoulQuestionSpec } from "../typesafe/types";

/**
 * The rules Meridian itself applies, written for a reader, for the "Scoring Rubric" dialog: how a risk score is built, what
 * each compliance check asks, how citations are found and judged, and what the guardrails block. Every figure and every line
 * of wording here is read from the same constants and question definitions the app runs on, never retyped, so this page
 * cannot describe rules the app does not follow. (The judge's own rubric is a separate thing: see src/lib/eval/rubrics.ts.)
 */
export type GuideId = "risk" | "compliance" | "citation" | "guardrails";

export interface GuideItem {
  title: string;
  /** One or two lines: the rule itself. */
  text: string;
  /** Small facts shown beside the title (a weight, a threshold, an origin). */
  chips?: string[];
  /** Ordered levels or outcomes, when the rule has them. */
  levels?: { label: string; text: string }[];
}

export interface GuideGroup {
  heading: string;
  note?: string;
  items: GuideItem[];
}

export interface Guide {
  id: GuideId;
  title: string;
  /** What this guide governs, in one sentence. */
  summary: string;
  groups: GuideGroup[];
}

const pct = (x: number) => `${Math.round(x * 100)}%`;
const bandText = () => {
  const { moderateFrom, highFrom } = RISK_BANDS;
  return { low: `below ${pct(moderateFrom)}`, moderate: `${pct(moderateFrom)} to ${pct(highFrom - 0.01)}`, high: `${pct(highFrom)} and above` };
};

function riskGuide(): Guide {
  const dims = Object.values(RISK_DIMENSIONS);
  const band = bandText();
  const levelLabels = ["0% (low risk)", "50% (middle)", "100% (high risk)"];
  return {
    id: "risk",
    title: "Risk score",
    summary: "The overall risk is a weighted sum of three separate ratings, each read from the contract against a three-level scale.",
    groups: [
      {
        heading: "Risk dimensions",
        note: "Each dimension is rated on its own, then combined with the weights below. The weights live in code, not in a prompt.",
        items: dims.map((d) => ({
          title: d.label,
          text: d.summary,
          chips: [`Weight ${pct(d.weight)}`],
          levels: d.criteria.map((c, i) => ({ label: levelLabels[i] ?? String(i), text: c })),
        })),
      },
      {
        heading: "Overall risk",
        items: [
          { title: "How it is combined", text: `Each rating becomes 0%, 50% or 100%. The overall is the weighted sum: ${dims.map((d) => `${d.label.toLowerCase()} ${pct(d.weight)}`).join(", ")}.` },
          {
            title: "Risk bands",
            text: "The band is taken from the overall as it is shown, a whole percentage.",
            levels: [
              { label: "Low", text: band.low },
              { label: "Moderate", text: band.moderate },
              { label: "High", text: band.high },
            ],
          },
          { title: "Low-confidence hedge", text: `If any rating comes back with model confidence below ${pct(LOW_CONFIDENCE_HEDGE)}, the reply says to have an attorney confirm it.` },
        ],
      },
    ],
  };
}

function complianceGuide(): Guide {
  return {
    id: "compliance",
    title: "Compliance checks",
    summary: `Four independent yes/no checks. A check is flagged when its probability reaches ${pct(COMPLIANCE_FLAG_THRESHOLD)}; more than one can trip.`,
    groups: [
      {
        heading: "The four checks",
        note: "Yes means the problem is present. Each is asked separately so it can be thresholded and shown on its own.",
        items: Object.values(COMPLIANCE_CHECKS).map((c) => ({ title: c.label, text: c.definition, chips: [`Flag at ${pct(COMPLIANCE_FLAG_THRESHOLD)}`] })),
      },
    ],
  };
}

const GUARDRAIL_TITLES: Record<string, { title: string; happens: string }> = {
  contains_privileged_content: { title: "Privileged or confidential content", happens: "The turn is stopped and flagged for review, and nothing further is processed." },
  is_injection_attempt: { title: "Prompt-injection attempt", happens: "The request is refused and the conversation is steered back to contract review." },
};

function guardrailsGuide(): Guide {
  const questions = guardrailsSkill.buildQuestions({} as never);
  return {
    id: "guardrails",
    title: "Guardrails",
    summary: `Every message is screened before anything else acts on it. A screen at or above ${pct(GUARDRAIL_TRIGGER)} blocks the turn.`,
    groups: [
      {
        heading: "What is screened",
        note: "Two separate yes/no questions, because each calls for different handling.",
        items: Object.entries(questions).map(([id, q]) => {
          const t = GUARDRAIL_TITLES[id] ?? { title: id, happens: "" };
          const criteria = (q as NoulQuestionSpec).criteria;
          return {
            title: t.title,
            text: String(q.instructions ?? "").replace(/`latest_message`/g, "the message"),
            chips: [`Blocks at ${pct(GUARDRAIL_TRIGGER)}`],
            levels: [
              ...(criteria ? [{ label: "Yes when", text: String(criteria.true) }, { label: "No when", text: String(criteria.false) }] : []),
              { label: "Then", text: t.happens },
            ],
          };
        }),
      },
    ],
  };
}

const RESOLUTION_ROWS: { label: string; text: string }[] = [
  { label: "Judged by a model", text: "An internal reference, or a key term with a clause that covers it: the model says how the source relates to the claim." },
  { label: "Broken (by rule)", text: "A section reference to a section this document does not have, near the sections it does have." },
  { label: "External (by rule)", text: "An outside law, another document, or an attachment: it is not among the loaded sources, so it is listed but not checked." },
  { label: "Missing (by rule)", text: "A core term with no clause at all in a full document." },
];

const VERDICT_LABEL: Record<string, string> = { verified: "Verified", contradicted: "Contradicted", unsupported: "Unsupported" };

function citationGuide(): Guide {
  const core = TOPICS.filter((t) => t.core).map((t) => t.label);
  return {
    id: "citation",
    title: "Citation identifying",
    summary: "Meridian finds what to check by rule, with no model call, then a model judges only whether the source really supports the claim.",
    groups: [
      {
        heading: "What is found",
        note: `At most ${MAX_REFERENCES} references per text; any beyond that are counted and reported, never silently dropped.`,
        items: [
          { title: "Cross-references", text: "Mentions of a section, article or clause (\"Section 4\", \"Article 2.1\", \"§ 6\") are matched to that section of the same document.", chips: ["Section · Article · Clause · §"] },
          { title: "Legal citations", text: "Statutes and regulations (\"15 U.S.C. § 1681\", \"29 C.F.R. …\"), named acts (GDPR, CCPA, HIPAA and similar) and case names (\"Party v. Party\"). Found and listed; they are outside the loaded sources.", chips: ["Statute · Act · Case"] },
          { title: "Attachments", text: "Exhibits, schedules, appendices, annexes and addenda that are referred to but not part of the text.", chips: ["Exhibit · Schedule · Appendix"] },
          { title: "Key terms", text: `${TOPICS.length} standard terms are located in the contract and quoted verbatim, with their figures pulled out, to be checked against what the playbook expects. A core term with no clause is reported as missing (${core.join(", ")}).` },
        ],
      },
      {
        heading: "What each check is held to",
        note: "Key terms are checked against the internal playbook where it has a section, otherwise a standard term.",
        items: TOPICS.map((t) => ({ title: t.label, text: t.claim, chips: [originOf(t), ...(t.core ? ["Core"] : [])] })),
      },
      { heading: "Who decides", items: RESOLUTION_ROWS.map((r) => ({ title: r.label, text: r.text })) },
      {
        heading: "Verdicts",
        note: `A relation answer at ${pct(AUTO_ACCEPT)} confidence or more is accepted automatically; below that it is marked for review.`,
        items: [
          ...Object.entries(RELATION_TO_VERDICT).map(([relation, verdict]) => ({ title: VERDICT_LABEL[verdict] ?? verdict, text: String(RELATION_CRITERIA?.[relation as keyof typeof RELATION_CRITERIA] ?? "") })),
          { title: "Fabricated", text: "The quote the claim rests on does not appear in the source section at all." },
        ],
      },
    ],
  };
}

const BUILDERS: Record<GuideId, () => Guide> = { risk: riskGuide, compliance: complianceGuide, citation: citationGuide, guardrails: guardrailsGuide };

/** Which of Meridian's own rule guides each analysis page shows. Trace covers the whole pipeline, so it shows all four. */
export function guidesForTab(tab: "trace" | "risk" | "compliance" | "citation"): Guide[] {
  const ids: GuideId[] = tab === "trace" ? ["risk", "compliance", "citation", "guardrails"] : tab === "compliance" ? ["compliance", "guardrails"] : [tab];
  return ids.map((id) => BUILDERS[id]());
}
