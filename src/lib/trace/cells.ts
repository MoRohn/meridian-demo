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
      bar: { value: answer.noul, tone: answer.noul >= 0.6 ? "rose" : answer.noul <= 0.4 ? "emerald" : "amber" },
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

/** OpenAI's answer to the same question, in the same voice: a yes/no reads Yes/No rather than true/false. */
export function openaiCell(answer: Answer, value: string | number | boolean, selfReportedConfidence: number | null): { main: string; sub: string } {
  const main = answer.type === "noul" ? (Boolean(value) ? "Yes" : "No") : String(value);
  return { main, sub: selfReportedConfidence != null ? `self-reported ${pct(selfReportedConfidence)}` : "" };
}
