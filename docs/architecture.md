# Architecture

Meridian is a Next.js (App Router) application. Every user turn runs through one orchestrator that asks a set of
independent *skills* for typed questions, sends them to the model in a single call, and lets ordinary code decide what to
do with the answers.

```
User message
     │
     ▼
┌─────────────────────────────────────────────────────────────┐
│  Orchestrator (src/lib/orchestrator/run.ts)                  │
│                                                              │
│  1. Build `state` from session memory + latest message       │
│     (src/lib/orchestrator/state.ts)                          │
│  2. Ask every APPLICABLE skill for its questions             │
│     — one skill per file, src/lib/skills/*.ts                │
│  3. ONE Jev call, every question in parallel                 │
│     (speculative fan-out — docs.typesafe.ai/patterns/fan-out)│
│  4. Confidence-gate: guardrails first, then intent routing,  │
│     then a plain switch statement reads the answers it needs │
│     and ignores the rest                                     │
│  5. Code composes the findings (risk, flags, routing), then  │
│     a model writes the answer from the document and those    │
│     findings (src/lib/chat/), or, with no key, the document's│
│     own clauses are quoted. TypeSafe never generates prose.  │
└─────────────────────────────────────────────────────────────┘
```

## Contents

- [Skills](#skills)
- [Speculative fan-out, and its one exception](#speculative-fan-out-and-its-one-exception)
- [How the chat answers](#how-the-chat-answers)
- [Conversational context](#conversational-context)
- [Confidence-gated automation](#confidence-gated-automation)
- [Two backends, measured live](#two-backends-measured-live)
- [Capabilities and where they live](#capabilities-and-where-they-live)

## Skills

Each file in [`src/lib/skills/`](../src/lib/skills/) is a self-contained unit: a name, a description, an
`isApplicable(state)` predicate, and a `buildQuestions(state)` function that proposes TypeSafe questions. The shape follows
Microsoft Semantic Kernel's plugin/function model: small, independently testable units that an orchestrator assembles at
request time, rather than one growing prompt. Adding a capability means adding one file and one line in
[`src/lib/skills/index.ts`](../src/lib/skills/index.ts); no other skill and no existing prompt is edited.

| Skill | File | What it asks |
|---|---|---|
| Guardrails | `guardrails.ts` | Privileged content, PII leakage and prompt injection. Always runs, first |
| Intake Router | `intakeRouter.ts` | Intent classification and urgency: the front door |
| Contract Type | `contractType.ts` | Classifies a newly loaded document once, then remembers it |
| Clause Risk | `clauseRisk.ts` | Three independent Scores (liability, indemnification, termination) combined into a composite risk number |
| Compliance Guard | `complianceGuard.ts` | Four independent yes/no compliance checks |
| Citations | `src/lib/citations/` | Automatic extraction, then one batched relation check (see below) |

The composite risk score is weighted 0.5 / 0.3 / 0.2 across the three dimensions, and the weights live in application code,
not in a prompt.

[`src/lib/orchestrator/excerpt.ts`](../src/lib/orchestrator/excerpt.ts) reuses the `RISK_DIMENSIONS` and
`COMPLIANCE_CHECKS` definitions from `clauseRisk.ts` and `complianceGuard.ts` to score a highlighted passage. Those skills'
`buildQuestions` read only the constants, not session context, so pointing them at a one-off
`{ active_document: { text: excerpt } }` state scores the excerpt with no duplicated logic.

## Speculative fan-out, and its one exception

Every applicable skill's questions go into **one** `system_one` call per turn
([patterns/fan-out](https://docs.typesafe.ai/patterns/fan-out)). Risk and compliance questions are asked before the user's
intent is known, because TypeSafe evaluates every question in parallel against the same state and the extra questions are
nearly free; the orchestrator ignores the answers it does not need. The **Trace** tab shows this directly: unused answers
appear dimmed rather than hidden.

Citation checking is the one deliberate exception ([`src/lib/citations/`](../src/lib/citations/)). Code has to decide *what*
to check, and which text each claim is judged against, before it can ask a model anything, so it is a code-gated two-step
sequence. This is the pattern in [the citation-check cookbook](https://docs.typesafe.ai/cookbooks/citation_check).

1. **Extract, by rule, with no model** ([`extract.ts`](../src/lib/citations/extract.ts),
   [`topics.ts`](../src/lib/citations/topics.ts)). The text is split into clauses
   ([`sections.ts`](../src/lib/citations/sections.ts); `Doc §N`, or `Doc ¶N` for text without numbering). Two kinds of check
   come out:
   - A *reference* is a citation the text itself makes. An internal cross-reference is resolved to the section it cites (a
     reference to a section that does not exist is a **broken reference**, decided by rule); legal citations and attachments
     are named and marked not checkable here.
   - A *term* is a key topic (renewal, liability cap, termination, governing law, and so on). The clause covering it is
     chosen, quoted verbatim, and its figures (`30 days`, `$50,000`, `no cap`) pulled out, to be checked against the
     playbook's expectation. An essential term with no clause is reported **missing**, but only for text that reads as a
     contract.

   A highlighted passage is read on its own, with its references still resolved against the whole document.
2. **Judge, in one request per backend** ([`batch.ts`](../src/lib/citations/batch.ts), `POST /api/citations`). Every check a
   model should judge becomes one three-way `Choice` (supports, contradicts, says nothing) over its own claim and source, so a
   whole document costs one call to TypeSafe and one to OpenAI. Checks decided by rule never leave the app.

Results are kept for the session ([`store.ts`](../src/lib/citations/store.ts)), so switching tabs costs nothing and each read
text runs once. The playbook ([`src/lib/data/authorities.ts`](../src/lib/data/authorities.ts)) is fictional and stands in for
a real internal one.

## How the chat answers

The typed judgments decide everything structural: guardrails, intent, the risk score and the compliance flags. The answer
writer ([`src/lib/chat/`](../src/lib/chat/)) only writes the words. It sends the loaded document, the last few turns and
Meridian's own findings (as fixed facts to quote) to the OpenAI model chosen in Settings. It is told to quote the clauses it
relies on, to say so when the document is silent, and to answer general legal questions directly instead of refusing them.
The document, the conversation and the message are fenced as untrusted data.

- **No key saved:** nothing is faked. The reply quotes the clauses most relevant to the question with their section and says
  it is the document's own wording ([`extractive.ts`](../src/lib/chat/extractive.ts)).
- **Refusals stay Meridian's.** A guardrail block (injection, privileged content) is never rewritten and makes no model call.
- **Each backend gets its own answer**, written from its own judgments, so the comparison and the judge see two replies that
  differ only where the judgments do. The write is timed and priced as its own activity ("Answer writer"), and each backend's
  turn also records it as that backend's *LLM response*, so a backend's total cost is its reasoning calls plus the LLM response
  that wrote its replies, shown with the reasoning cost and the LLM response cost beneath it.
- Under each reply the chat says where it came from: which model wrote it, or that it is quoted from the document.
- **Both replies are shown in the chat, in the order they finish.** Each backend's reply is its own card (TypeSafe or OpenAI)
  with its finish place and time, appended the moment its request resolves; a card that is still waiting shows as
  "answering…", and a failed backend gets a failure card instead of an answer. The input stays busy until both have settled.

## Conversational context

[`src/lib/memory/session.ts`](../src/lib/memory/session.ts) is an in-memory, session-scoped store; every caller depends only
on that file's three exported functions. [`src/lib/orchestrator/state.ts`](../src/lib/orchestrator/state.ts) folds session
memory into each turn's `state`: the active document, a rolling window of recent turns, and facts established once (such as
contract type) that are never re-asked. The "Context memory" bar above the workspace tabs shows the turn count, active
document and classified contract type live.

## Confidence-gated automation

Wherever a judgment feeds an action, code checks `confidence` first
([docs.typesafe.ai/confidence](https://docs.typesafe.ai/confidence)):

- Intent routing below 0.35 confidence asks a clarifying question instead of guessing.
- A risk score below 0.5 confidence gets an explicit "have an attorney confirm this" hedge in the reply.
- A citation verdict below 0.75 confidence is marked "routed to human review" instead of auto-accepted.

This is the point of using a model that returns calibrated probabilities: the system can say "I'm not sure" in a way code can
branch on.

## Two backends, measured live

Every dual-backend comparison (a chat turn, a citation check, an excerpt score) fires **two separate network requests at the
same moment**, for example `POST /api/chat` and `POST /api/compare-openai` for a chat turn, rather than bundling both into one
server-side call. Each side updates the instant its own request resolves, regardless of the other's timing, success or
failure.

- **Three time metrics per chat turn, and only these.** *Model total time* is what the turn took from send to that backend's
  reply landing (the whole time to answer). *Model reasoning* is the backend's own judgment call (Jev's judgments, OpenAI's
  function call). *LLM response* is the model that writes the reply from those judgments, the same OpenAI model for both
  backends (n/a when nothing wrote the reply, as with a refusal or a quoted answer). Total is reasoning plus response plus the
  network. The chat card spells it out ("8.3s: 631ms model reasoning · 7.7s LLM response"); the header timer, activity trace,
  evaluation table and Speed verdict all use model total time, from one shared clock; the Trace tab lists the median of each.
  Header timers exist for TypeSafe and OpenAI only; judge calls are timed in the activity trace and the evaluation panel.
- **Measure.** Each side shows real token usage, cost (TypeSafe's published pricing and OpenAI's list pricing, in
  [`src/lib/compare/pricing.ts`](../src/lib/compare/pricing.ts)) and latency, computed from the actual response.
- **Monitor.** A running session total (calls, tokens, cumulative cost per backend) sits at the foot of the Trace tab. The
  header's `TypeSafe` and `OpenAI` pills track whichever request, from any tab, is running or ran last.
- **Validate.** Every judgment shows TypeSafe's calibrated choice/score/noul beside OpenAI's function-call output for the same
  question, with an agreement column on the Trace tab.
- **Trace failures, not just successes.** If an OpenAI call errors or falls back to a different model, the raw error or
  fallback notice renders under that comparison ([`OpenAINote.tsx`](../src/components/OpenAINote.tsx)).

The OpenAI side is optional. With no key configured, every `/api/compare-openai*` route returns immediately with
`{ ok: false, reason: "not_configured" }` and makes no external call; the UI says so plainly. The qualitative differences hold
either way:

- **No native calibrated uncertainty.** A `Choice` or `Score` answer's `probabilities` come from a model trained to be
  calibrated. Function calling has no equivalent; the workaround here is a self-reported `confidence` field
  ([`src/lib/openai/client.ts`](../src/lib/openai/client.ts)), which is not independently calibrated to anything, and the
  per-question table makes that gap visible.
- **Output tokens are free on Jev** (`$0.042`/Mtok input, `$0` output; see [docs.typesafe.ai/models](https://docs.typesafe.ai/models)).
  A chat-completions response has to generate every field as text and is billed for it, so a larger speculative fan-out costs
  more tokens and decode time there, and is nearly free on Jev.
- **Answers are constrained by construction.** A `Choice` cannot return a value outside its declared options. The OpenAI
  schema uses `strict: true` (Structured Outputs) for the same guarantee, though not the probability distribution.

## Capabilities and where they live

| Capability | Where |
|---|---|
| Conversational context and multi-turn memory | `src/lib/orchestrator/state.ts`, `src/lib/memory/session.ts`; facts persist across turns and show in the Context memory bar |
| Plugin-style AI skills | `src/lib/skills/*.ts`: a registry shaped like Semantic Kernel's plugin/function model |
| Prompts, workflows and orchestration as code | `src/lib/orchestrator/run.ts`: fan-out, confidence gating and reply composition live in typed code, not a prompt string |
| Making the architecture visible | The Trace, Risk, Compliance and Citations tabs show it at runtime |
| Retrieve-then-judge (RAG-shaped) verification | Citation verification; `src/lib/data/authorities.ts` stands in for a vector-store-backed retrieval step (see [Production notes](production.md)) |
| Evaluation, observability, model performance | Per-answer DeepEval judgments with versioned rubrics and an injection-hardened judge, a golden-set harness for the judge itself, and `/stats` plus structured logs on the eval service; see [Evaluation](evaluation.md) |
| Cloud deployment | See [Production notes](production.md) |
