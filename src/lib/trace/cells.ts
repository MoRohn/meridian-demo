import type { Answer } from "../typesafe/types";

/**
 * How one answer reads as a single table cell: a headline value, one line of supporting figures, an optional bar, and the
 * full distribution for a tooltip. The Trace table is one row per question, so each answer has to say what matters in a
 * line or two; the detail that used to fill a card (every option's probability) moves into `detail`.
 */
export interface AnswerCell {
  main: string;
  sub: string;
  /** 0..1 fill for the small bar under the value, and its tone. Null when there is nothing to draw. */
  bar: { value: number; tone: "rose" | "amber" | "emerald" | "accent" } | null;
  /** The whole distribution, for a title attribute. */
  detail: string;
}

const pct = (x: number) => `${Math.round(x * 100)}%`;
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/** How a probability of yes is toned: a likely yes is a problem (rose), a likely no is fine (emerald), in between is amber. */
export function yesTone(probabilityOfYes: number): "rose" | "amber" | "emerald" {
  return probabilityOfYes >= 0.6 ? "rose" : probabilityOfYes <= 0.4 ? "emerald" : "amber";
}

/**
 * The probability of "yes" that OpenAI's answer implies, so its bar sits on the same scale as TypeSafe's. OpenAI returns a
 * boolean and a self-reported confidence in that answer: "No, 99% sure" implies a 1% chance of yes. It is a reading of a
 * self-reported number, not a calibrated probability, and the cell's label says so. Null when no confidence was reported.
 */
export function impliedYesProbability(yes: boolean, selfReportedConfidence: number | null): number | null {
  if (selfReportedConfidence == null) return null;
  const confidence = clamp01(selfReportedConfidence);
  return yes ? confidence : 1 - confidence;
}

/** The highest level a score question can take, from its legend, falling back to the highest level it gave any probability. */
export function scoreCeiling(answer: Extract<Answer, { type: "score" }>): number {
  const levels = [...Object.keys(answer.legend), ...Object.keys(answer.probabilities)].map(Number).filter(Number.isFinite);
  return levels.length ? Math.max(...levels) : 1;
}

export function typesafeCell(answer: Answer): AnswerCell {
  if (answer.type === "noul") {
    const yes = answer.noul >= 0.5;
    return {
      main: yes ? "Yes" : "No",
      sub: `${pct(answer.noul)} probability of yes`,
      bar: { value: answer.noul, tone: yesTone(answer.noul) },
      detail: `Probability of yes: ${pct(answer.noul)}`,
    };
  }
  if (answer.type === "choice") {
    const ranked = Object.entries(answer.probabilities).sort((a, b) => b[1] - a[1]);
    const chosen = answer.probabilities[answer.choice] ?? answer.confidence;
    return {
      main: answer.choice,
      sub: `${pct(chosen)} · confidence ${pct(answer.confidence)}`,
      bar: { value: chosen, tone: "accent" },
      detail: ranked.map(([option, p]) => `${option} ${pct(p)}`).join(", "),
    };
  }
  const top = scoreCeiling(answer);
  const ranked = Object.entries(answer.probabilities).sort((a, b) => Number(a[0]) - Number(b[0]));
  return {
    main: answer.score.toFixed(2),
    sub: `of ${top} · confidence ${pct(answer.confidence)}`,
    bar: { value: Math.min(1, Math.max(0, answer.score / top)), tone: "amber" },
    detail: ranked.map(([level, p]) => `level ${level} ${pct(p)}`).join(", "),
  };
}

/**
 * OpenAI's answer to the same question, in the same voice: a yes/no reads Yes/No rather than true/false, and the bar is
 * drawn on the scale TypeSafe's is (probability of yes; confidence in the chosen option; level out of the top level), so
 * the two can be read side by side. Only the confidence figures are self-reported, and the label says so.
 */
export function openaiCell(answer: Answer, value: string | number | boolean, selfReportedConfidence: number | null): AnswerCell {
  const sub = selfReportedConfidence != null ? `self-reported ${pct(selfReportedConfidence)}` : "";
  if (answer.type === "noul") {
    const yes = Boolean(value);
    const probability = impliedYesProbability(yes, selfReportedConfidence);
    return {
      main: yes ? "Yes" : "No",
      sub,
      bar: probability == null ? null : { value: probability, tone: yesTone(probability) },
      detail: probability == null ? "OpenAI reported no confidence" : `Probability of yes implied by its self-reported confidence: ${pct(probability)}`,
    };
  }
  if (answer.type === "choice") {
    return {
      main: String(value),
      sub,
      bar: selfReportedConfidence == null ? null : { value: clamp01(selfReportedConfidence), tone: "accent" },
      detail: selfReportedConfidence == null ? "OpenAI reported no confidence" : `Self-reported confidence in its choice: ${pct(selfReportedConfidence)}`,
    };
  }
  const top = scoreCeiling(answer);
  const level = Number(value);
  return {
    main: String(value),
    sub,
    bar: Number.isFinite(level) ? { value: clamp01(level / top), tone: "amber" } : null,
    detail: `Level ${String(value)} of ${top}${selfReportedConfidence != null ? `, self-reported confidence ${pct(selfReportedConfidence)}` : ""}`,
  };
}
