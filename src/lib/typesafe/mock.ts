/**
 * A deterministic, dependency-free stand-in for the live Jev model.
 *
 * The real integration point is `client.ts` — when TYPESAFE_API_KEY is set,
 * every call in this app goes to the real `/v1/systemone` endpoint via
 * @typesafe-ai/sdk. This mock exists purely so the demo is fully interactive
 * for anyone without a TypeSafe account: it reproduces the exact response
 * shape (choice/score/noul + probabilities + confidence) using a keyword-
 * overlap heuristic instead of a trained model, so every downstream
 * component (routing, composite scoring, confidence gating, the UI) behaves
 * identically regardless of which evaluator answered the question.
 *
 * Every response is tagged `source: "mock"` so the UI never misrepresents
 * a heuristic guess as a real model judgment.
 */
import type {
  Answer,
  ChoiceAnswer,
  ChoiceQuestionSpec,
  JsonValue,
  NoulAnswer,
  NoulQuestionSpec,
  QuestionSpec,
  ScoreAnswer,
  ScoreQuestionSpec,
  State,
  SystemOneResponse,
} from "./types";

function flatten(value: JsonValue | undefined): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map(flatten).join(" ");
  return Object.entries(value)
    .map(([k, v]) => `${k} ${flatten(v)}`)
    .join(" ");
}

/** Naive stemming so "SSNs" matches "ssn" and "capped" matches "caps" — good enough for a keyword-overlap mock. */
function stem(word: string): string {
  if (word.length > 5 && word.endsWith("ing")) return word.slice(0, -3);
  if (word.length > 4 && word.endsWith("ed")) return word.slice(0, -2);
  if (word.length > 4 && word.endsWith("es")) return word.slice(0, -2);
  if (word.length >= 4 && word.endsWith("s")) return word.slice(0, -1);
  return word;
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2)
    .map(stem);
}

/** Small stopword list so overlap scoring isn't dominated by "the", "does", etc. */
const STOPWORDS = new Set(
  "the a an is does do this that these those and or but for with about into your you it its of on in to as at by from what how which does not no yes contains contain looks like being".split(
    " "
  )
);

/**
 * Questions reference specific parts of the state with `` `dot.paths` ``
 * (see docs.typesafe.ai/primitives#reference-specific-fields). The real
 * model reads the whole state but weighs the referenced part heavily; this
 * mock approximates that by resolving those paths and scoring against just
 * the referenced text, falling back to the full state when a question makes
 * no reference (as guardrails and intent-routing questions mostly don't,
 * beyond `latest_message`). Without this, JSON key names like "context" or
 * "contract_type" would coincidentally match instruction wording and
 * produce false positives that have nothing to do with the actual content.
 */
function resolvePath(root: JsonValue, path: string): JsonValue | undefined {
  const parts = path.split(/\.|\[|\]/).filter(Boolean);
  let cur: JsonValue | undefined = root;
  for (const part of parts) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = Array.isArray(cur) ? cur[Number(part)] : (cur as Record<string, JsonValue>)[part];
  }
  return cur;
}

function scopedStateText(instructions: JsonValue, fullState: JsonValue): string {
  const instructionText = flatten(instructions);
  const refs = [...instructionText.matchAll(/`([a-zA-Z0-9_.[\]]+)`/g)].map((m) => m[1]);
  if (refs.length === 0) return flatten(fullState);
  const parts = refs.map((ref) => flatten(resolvePath(fullState, ref)));
  return parts.join(" ") || flatten(fullState);
}

function hashSeed(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 0xffffffff;
}

function overlapScore(candidateText: string, stateText: string, seedKey: string): number {
  const candidateWords = new Set(tokenize(candidateText).filter((w) => !STOPWORDS.has(w)));
  const stateWords = tokenize(stateText).filter((w) => !STOPWORDS.has(w));
  let hits = 0;
  for (const w of stateWords) if (candidateWords.has(w)) hits += 1;
  const jitter = (hashSeed(seedKey + "::" + candidateText) - 0.5) * 0.35;
  return hits + jitter + 0.05;
}

function softmax(scores: number[]): number[] {
  const max = Math.max(...scores);
  const exps = scores.map((s) => Math.exp((s - max) * 1.8));
  const sum = exps.reduce((a, b) => a + b, 0);
  return exps.map((e) => e / sum);
}

function confidenceFromDistribution(probs: number[]): number {
  // 1 - normalized entropy: peaked distribution -> confidence near 1.
  const n = probs.length;
  if (n <= 1) return 1;
  const entropy = -probs.reduce((acc, p) => acc + (p > 0 ? p * Math.log(p) : 0), 0);
  const maxEntropy = Math.log(n);
  return Math.max(0, Math.min(1, 1 - entropy / maxEntropy));
}

/**
 * Deciding whether a section "supports", "contradicts", or "says nothing
 * about" a claim (see skills/citationVerifier.ts) needs real reading
 * comprehension — generic keyword overlap against three abstract category
 * labels can't approximate it (the words "supports"/"contradicts" never
 * appear in the actual claim or section text). This targeted heuristic
 * checks two much cheaper signals instead: how much of the claim's
 * vocabulary the section actually addresses (topical overlap), and whether
 * one text negates something the other doesn't (a crude but useful proxy
 * for "says the opposite"). It only applies to this one, by-construction
 * question shape — everything else still uses the generic overlap scorer.
 */
// Deliberately narrow: "without"/"no" show up constantly in ordinary legal
// prose ("without penalty", "no more than") and would swamp this signal
// with noise unrelated to whether a claim is actually being negated.
const NEGATION_RE = /\b(not|never|cannot)\b/i;

const DAYS: Record<string, number> = { day: 1, week: 7, month: 30, year: 365 };

/** Every duration in a text, in days: "thirty (30) days" is 30, "eighteen (18) months" is 540. */
function durationsInDays(text: string): { days: number; unit: string }[] {
  return [...text.matchAll(/(\d+)\)?[\s-]+(day|week|month|year)s?\b/gi)].map((m) => ({ days: Number(m[1]) * DAYS[m[2].toLowerCase()], unit: m[2].toLowerCase() }));
}

/**
 * A bag-of-words overlap cannot see that "capped at a stated amount" and "shall not be limited" are opposites, or that 18
 * months is more than "no more than 90 days". These few literal rules cover the claims the Citations tab makes about the
 * sample contracts' terms; like the compliance tables below, they are demo-specific patches to a fallback path. The live
 * model reads for meaning and needs none of them. Returns null when no rule applies and the generic scorer should decide.
 */
function ruleRelation(claim: string, section: string): "contradicts" | "says_nothing" | null {
  const c = claim.toLowerCase();
  const t = section.toLowerCase();
  if (/\bcapped\b|stated amount/.test(c) && /shall not be limited|not be limited|unlimited|no (?:limit|cap)\b/.test(t)) return "contradicts";
  if (/without a termination fee|no penalty|without penalty/.test(c) && /termination fee|early termination|penalty/.test(t)) return "contradicts";
  if (/\bmutual\b|own breaches/.test(c) && /\b(?:customer|provider|employee|company|vendor|supplier)\b[^.]{0,150}shall indemnify/.test(t) && !/each party|either party|mutual/.test(t)) return "contradicts";
  if (/limited in (?:both )?duration and geography/.test(c) && /anywhere in the world|worldwide/.test(t)) return "contradicts";
  const atMost = c.match(/(?:no more than|at most)[^.]{0,20}?\((\d+)\)\s*(day|week|month|year)/);
  if (atMost) {
    const limit = Number(atMost[1]) * DAYS[atMost[2]];
    const found = durationsInDays(t);
    if (found.length === 0) return "says_nothing";
    if (found.some((d) => d.days > limit)) return "contradicts";
  }
  const atLeast = c.match(/at least[^.]{0,20}?\((\d+)\)\s*(day|week|month|year)/);
  if (atLeast) {
    const floor = Number(atLeast[1]) * DAYS[atLeast[2]];
    const notice = durationsInDays(t).filter((d) => d.unit === "day" || d.unit === "week"); // a term of a year is not a notice period
    if (notice.length === 0) return "says_nothing";
    if (notice.some((d) => d.days < floor)) return "contradicts";
  }
  if (/security/.test(c) && /breach notification/.test(c) && !/security|safeguard|breach/.test(t)) return "says_nothing";
  return null;
}

function mockRelation(claim: string, section: string): ChoiceAnswer {
  const ruled = ruleRelation(claim, section);
  if (ruled) {
    const confidence = ruled === "contradicts" ? 0.82 : 0.7;
    const rest = (1 - confidence) / 2;
    const probabilities: Record<string, number> = { supports: rest, contradicts: rest, says_nothing: rest };
    probabilities[ruled] = confidence;
    return { type: "choice", choice: ruled, probabilities, confidence };
  }
  const claimWords = new Set(tokenize(claim).filter((w) => !STOPWORDS.has(w)));
  const sectionWords = new Set(tokenize(section).filter((w) => !STOPWORDS.has(w)));
  let overlap = 0;
  for (const w of claimWords) if (sectionWords.has(w)) overlap += 1;
  const overlapRatio = claimWords.size > 0 ? overlap / claimWords.size : 0;

  // Negation is compared where the claim and the section actually meet: in the section's best-matching sentence, not anywhere
  // in it. A clause that says "does not automatically renew" elsewhere says nothing against a claim about how long its
  // confidentiality lasts.
  const sentences = section.split(/(?<=[.;])\s+/).filter(Boolean);
  const meets = (s: string) => {
    const words = new Set(tokenize(s).filter((w) => !STOPWORDS.has(w)));
    let hits = 0;
    for (const w of claimWords) if (words.has(w)) hits += 1;
    return hits;
  };
  const best = sentences.reduce((a, b) => (meets(b) > meets(a) ? b : a), sentences[0] ?? section);
  const claimHasNegation = NEGATION_RE.test(claim);
  const sectionHasNegation = NEGATION_RE.test(best);

  let choice: "supports" | "contradicts" | "says_nothing";
  let confidence: number;
  if (overlapRatio < 0.25) {
    choice = "says_nothing";
    confidence = 0.55 + (0.25 - overlapRatio);
  } else if (claimHasNegation !== sectionHasNegation) {
    choice = "contradicts";
    confidence = 0.6 + overlapRatio * 0.3;
  } else {
    choice = "supports";
    confidence = 0.55 + overlapRatio * 0.35;
  }
  confidence = Math.max(0.3, Math.min(0.97, confidence));

  const rest = (1 - confidence) / 2;
  const probabilities: Record<string, number> = { supports: rest, contradicts: rest, says_nothing: rest };
  probabilities[choice] = confidence;

  return {
    type: "choice",
    choice,
    probabilities,
    confidence: Math.round(confidence * 1000) / 1000,
  };
}

/**
 * A keyword-overlap score cannot tell "Can I terminate early?" (a question about the contract) from "analyze this contract"
 * (a task): both talk about the contract. Reading the message's own shape can, cheaply and literally: a clear task word
 * routes to that task, a plain question routes to open Q&A, and a greeting to small talk. Anything else returns null and
 * the generic scorer decides, as before. Like the compliance tables below this is demo-specific patching of a fallback
 * path; the live model reads for meaning.
 */
const INTENT_RULES: [string, RegExp][] = [
  ["verify_citation", /\b(citation|cite|cited|quote|quoted|verif\w*|authority|precedent|case law)\b/i],
  ["summarize_context", /\b(summari[sz]e|summary|recap|overview|so far|tl;?dr|what have we)\b/i],
  ["check_compliance", /\b(complian\w*|flags?|gdpr|regulat\w*)\b/i],
  ["analyze_contract", /\b(analy[sz]e|analysis|review|risk\w*|scor(e|ing)|assess\w*|evaluate|red flags?|safe to sign)\b/i],
];
const QUESTION_SHAPE = /\?\s*$|^\s*(can|could|what|how|does|do|is|are|why|who|when|where|should|will|would|may|explain|tell me|describe|define)\b/i;
const GREETING = /^\s*(hi|hello|hey|thanks|thank you|thx|good (morning|afternoon|evening)|ok|okay|cheers)\b/i;

export function intentFromMessage(message: string): string | null {
  for (const [intent, pattern] of INTENT_RULES) if (pattern.test(message)) return intent;
  if (GREETING.test(message) && !QUESTION_SHAPE.test(message)) return "small_talk";
  if (QUESTION_SHAPE.test(message)) return "ask_legal_question";
  return null;
}

function mockIntent(q: ChoiceQuestionSpec, message: string): ChoiceAnswer | null {
  const options = Object.keys(q.criteria);
  const chosen = intentFromMessage(message);
  if (!chosen || !options.includes(chosen)) return null;
  const rest = 0.18 / (options.length - 1);
  const probabilities: Record<string, number> = {};
  for (const o of options) probabilities[o] = o === chosen ? 0.82 : Math.round(rest * 1000) / 1000;
  return { type: "choice", choice: chosen, probabilities, confidence: Math.round(confidenceFromDistribution(options.map((o) => probabilities[o])) * 1000) / 1000 };
}

function mockChoice(id: string, q: ChoiceQuestionSpec, stateText: string): ChoiceAnswer {
  const options = Object.entries(q.criteria);
  const scores = options.map(([key, desc]) =>
    overlapScore(`${key} ${flatten(desc ?? null)} ${flatten(q.instructions)}`, stateText, id)
  );
  const probs = softmax(scores);
  const probabilities: Record<string, number> = {};
  options.forEach(([key], i) => (probabilities[key] = Math.round(probs[i] * 1000) / 1000));
  const bestIdx = probs.indexOf(Math.max(...probs));
  return {
    type: "choice",
    choice: options[bestIdx][0],
    probabilities,
    confidence: Math.round(confidenceFromDistribution(probs) * 1000) / 1000,
  };
}

function mockScore(id: string, q: ScoreQuestionSpec, stateText: string): ScoreAnswer {
  const levels = q.criteria;
  const scores = levels.map((desc, i) =>
    overlapScore(`${flatten(desc)} ${flatten(q.instructions)}`, stateText, id + i)
  );
  const probs = softmax(scores);
  const legend: Record<string, JsonValue> = {};
  levels.forEach((desc, i) => (legend[String(i)] = desc));
  const probabilities: Record<string, number> = {};
  probs.forEach((p, i) => (probabilities[String(i)] = Math.round(p * 1000) / 1000));
  const weighted = probs.reduce((acc, p, i) => acc + p * i, 0);
  return {
    type: "score",
    score: Math.round(weighted * 100) / 100,
    legend,
    probabilities,
    confidence: Math.round(confidenceFromDistribution(probs) * 1000) / 1000,
  };
}

/**
 * A pure bag-of-words overlap score cannot tell "liability is capped at
 * $50,000" from "liability is uncapped" — both mention "liability". That's
 * a real limitation of this heuristic (not of the live Jev model, which
 * reads for meaning). These two small tables patch the specific compliance
 * checks this demo ships with with cheap, literal phrase evidence, so the
 * mock evaluator's demo behavior lines up with what the sample contracts
 * actually say. They're keyed to this app's question ids on purpose — this
 * is demo-specific patching of a fallback path, not a general NLU technique.
 */
const NOUL_REQUIRES_TRIGGER: Record<string, string[]> = {
  missing_data_protection_clause: ["personal data", "customer data", "end user", "end-user", "personally identifiable"],
};
const NOUL_NEGATIVE_EVIDENCE: Record<string, string[]> = {
  unlimited_liability: ["capped at", "shall not exceed", "liability is capped", "liability... capped", "cap on liability"],
  missing_governing_law: ["governing law", "governed by the laws of", "laws of the state of"],
  auto_renewal_trap: ["does not automatically renew", "shall not automatically renew", "no automatic renewal"],
  missing_data_protection_clause: ["data protection clause", "data protection addendum", "privacy policy", "gdpr"],
};

function mockNoul(id: string, q: NoulQuestionSpec, stateText: string): NoulAnswer {
  // A coin-flip on jitter alone is the wrong default for a yes/no question:
  // most Noul questions about most inputs should read as "no". Require
  // actual keyword evidence in the state before probability rises much
  // above a small baseline, rather than symmetric overlap-vs-overlap scoring.
  const trueWords = new Set(
    tokenize(`${flatten(q.instructions)} ${flatten(q.criteria?.true ?? null)}`).filter((w) => !STOPWORDS.has(w))
  );
  const stateWords = tokenize(stateText).filter((w) => !STOPWORDS.has(w));
  let hits = 0;
  for (const w of stateWords) if (trueWords.has(w)) hits += 1;
  // A step function on the raw hit count, not a ratio over instruction
  // length or a linear scale-up: a single incidental keyword collision (an
  // instruction that happens to name the app's own domain, like "contract",
  // shouldn't itself read as evidence) should stay unconvincing, while two
  // or more independent hits should read as real signal.
  const jitter = (hashSeed(id + "::" + stateText.slice(0, 64)) - 0.5) * 0.1;
  const steps = [0.08, 0.3, 0.55, 0.75, 0.88];
  const p0 = steps[Math.min(hits, steps.length - 1)];
  let p = p0 + jitter;

  const lower = stateText.toLowerCase();
  const trigger = NOUL_REQUIRES_TRIGGER[id];
  if (trigger && !trigger.some((phrase) => lower.includes(phrase))) {
    p = Math.min(p, 0.1);
  }
  const negative = NOUL_NEGATIVE_EVIDENCE[id];
  if (negative && negative.some((phrase) => lower.includes(phrase))) {
    p = Math.min(p, 0.12);
  }

  return { type: "noul", noul: Math.round(Math.max(0.02, Math.min(0.98, p)) * 1000) / 1000 };
}

export function mockSystemOne(
  state: State,
  questions: Record<string, QuestionSpec>,
  model: string
): Omit<SystemOneResponse, "elapsedMs"> {
  const fullStateText = flatten(state as JsonValue);
  const answers: Record<string, Answer> = {};
  for (const [id, q] of Object.entries(questions)) {
    if (q.type === "choice" && "supports" in q.criteria && "contradicts" in q.criteria) {
      // A citation check's relation question names its own claim and source by path, one pair per question, so a whole
      // document's checks can share one request: `checks.<id>.claim` and `checks.<id>.source_section`.
      const refs = [...flatten(q.instructions).matchAll(/`([a-zA-Z0-9_.[\]]+)`/g)].map((m) => m[1]);
      const claimRef = refs.find((r) => r.endsWith("claim")) ?? "claim";
      const sectionRef = refs.find((r) => r.endsWith("source_section")) ?? "source_section";
      answers[id] = mockRelation(flatten(resolvePath(state as JsonValue, claimRef)), flatten(resolvePath(state as JsonValue, sectionRef)));
      continue;
    }
    if (id === "intent" && q.type === "choice" && "analyze_contract" in q.criteria && "small_talk" in q.criteria) {
      const byShape = mockIntent(q, flatten(resolvePath(state as JsonValue, "latest_message")));
      if (byShape) {
        answers[id] = byShape;
        continue;
      }
    }
    const stateText = scopedStateText(q.instructions, state as JsonValue);
    if (q.type === "choice") answers[id] = mockChoice(id, q, stateText);
    else if (q.type === "score") answers[id] = mockScore(id, q, stateText);
    else answers[id] = mockNoul(id, q, stateText);
  }
  const inputChars = fullStateText.length + JSON.stringify(questions).length;
  return {
    model: `${model} (mock)`,
    answers,
    usage: {
      input_tokens: Math.round(inputChars / 4),
      output_tokens: Object.keys(questions).length * 12,
    },
    source: "mock",
  };
}
