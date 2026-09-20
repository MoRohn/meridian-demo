# Meridian — AI Context Intake & Contract Risk Copilot

A full-stack demo built to be directly relevant to an **AI Engineer (Full Stack)** role
at a legal-tech company (this was built with LexisNexis's AI Engineer JD in hand — think
Protégé / Legal Intelligence Engine territory): a conversational assistant that ingests a
legal context, reviews a contract for risk, flags compliance issues, and verifies
citations against a source document — with a visible reasoning trace, a Semantic-Kernel-style
skills/plugin architecture, and a **live, measured** comparison against how the same system
would look built on a traditional chat-completions API instead.

It's built on **[TypeSafe](https://docs.typesafe.ai)**, whose Jev model
returns typed, calibrated judgments (`Choice` / `Score` / `Noul`) instead of generated
text — which turns out to be a very good fit for the parts of "production AI application"
that most chatbot demos wave their hands at: routing, confidence-gated automation, and
composable business logic that doesn't live inside a prompt.

## Running it

```bash
npm install
npm run meridian
```

`npm run meridian` is the one command to know: it starts the app on a fixed, predictable
port (`http://localhost:3000` — set `PORT=xxxx` to change it), fails loudly instead of
silently hopping to another port if it's already taken, prints a clean banner, and opens
the URL in your browser automatically once the server is actually ready. (`npm run dev`
still works too, if you'd rather run plain `next dev`.)

### Evaluations (optional)

The **Evaluate** buttons need the DeepEval service in [`eval-service/`](eval-service/). One time:

```bash
npm run eval-service:setup     # creates eval-service/.venv and installs its requirements
```

After that `npm run meridian` starts the service alongside the app (`MERIDIAN_EVAL=0` skips it), or run it on its
own with `npm run eval-service`. By default the judge uses the OpenAI key you save in Settings (or `OPENAI_API_KEY` for the
service); the **Judge model** section of the same dialog can switch it to Claude, Gemini or another OpenAI model, which is the
recommended setup because a judge from a third company scores the two backends most fairly (see
[`eval-service/README.md`](eval-service/README.md)). After pulling this change, run `npm run eval-service:setup` once and restart
the service to pick up the Claude and Gemini SDKs. Without the service the app works as before; the
evaluation panel says the service isn't running and offers **Check again**.

**No API key is required to use the app.** Without `TYPESAFE_API_KEY` set, every call
transparently falls back to a local heuristic mock evaluator (see
[`src/lib/typesafe/mock.ts`](src/lib/typesafe/mock.ts)) that reproduces the exact same
response shape, so the whole app is interactive out of the box. The header's `TypeSafe`
and `OpenAI` pills always show `Live` vs. `demo mode` / `not configured`, plus how long the
last call took, so it's never ambiguous which one actually answered.

To use the real TypeSafe model, and/or run a live comparison against OpenAI:

```bash
export TYPESAFE_API_KEY=sk-...   # from https://console.typesafe.ai/settings/keys
export OPENAI_API_KEY=sk-...     # optional — only affects the OpenAI side of every comparison
npm run meridian
```

Both keys are entirely optional and independent of each other. If you'd rather not set
environment variables, click the gear icon in the header instead — see "API keys and
model selection," below.

### API keys and model selection (no env vars needed)

The gear icon in the header opens a **Settings** modal with a password-masked key field
and a model dropdown for each backend:

- **TypeSafe** currently ships one Jev model (`jev-latest`).
- **OpenAI** offers the current chat-completions lineup, defaulting to the newest flagship
  (`gpt-6-astra`) down to the cheapest (`gpt-4o-mini`).

Keys are stored in `localStorage` only — never written to this app's server-side session
store — and sent as the body of each request the browser already makes, where they take
priority over the corresponding environment variable for that request (see
[`src/lib/typesafe/client.ts`](src/lib/typesafe/client.ts) /
[`src/lib/openai/client.ts`](src/lib/openai/client.ts)). Saving a key immediately fires a
cheap, real validation call (`GET /v1/models`-equivalent for each provider — see
[`/api/validate-keys`](src/app/api/validate-keys/route.ts)) so the header pill only claims
`Live` once the key has actually been confirmed to work, not just typed in.

Newer OpenAI models default to spending reasoning tokens even on simple tool calls, which
`/v1/chat/completions` rejects for function-calling requests; this app explicitly disables
that (`reasoning_effort: "none"`) for reasoning-family models. If a selected model still
isn't callable on a given key (a brand-new flagship's staged rollout, for example), the
OpenAI client transparently retries once against `gpt-4o-mini` and reports the fallback in
the UI rather than failing the whole comparison — see `OpenAINote` below.

## Display brightness

The sun/moon button in the header opens a five-level brightness slider (drag it, use the arrow keys, or pick a
name). From brightest to darkest: **Bright** (one step brighter than the original), **Original** (the palette
Meridian shipped with), **Default** (slightly darker than the original; what a new visitor sees), **Dark**, and
**Darkest**. The whole UI follows: surfaces, text, status colors, the document page, and the fills for active tabs
and buttons. The choice applies instantly, is remembered, and is applied before the first paint on your next visit,
so there is no flash of the wrong palette.

Each level's palette is defined in [`src/app/globals.css`](src/app/globals.css). [`src/lib/themePalette.test.ts`](src/lib/themePalette.test.ts)
reads that file and checks every level: WCAG AA contrast for every text and surface pair (including status text on
its tinted chips), that the levels get strictly darker in order, that "default" is only slightly darker than
"original", and that "original" is still exactly the shipped palette. `npm run test:e2e` scans every level across every
view with axe. When editing a palette, run those two first.

## What to click through

1. **Load a sample contract** (top of the left panel) — a one-sided SaaS MSA, a balanced
   mutual NDA, and an employment agreement missing a governing-law clause. They're written
   to produce visibly different risk profiles. The document renders as a paginated,
   zoomed-out preview right there in the left panel — click **Expand** for a full reading
   view, or zoom in directly.
2. **Or upload your own** — drag a `.pdf`, `.docx`, or `.txt` file anywhere onto the left
   panel, or use the "Upload a file" chip. Text is extracted server-side (`mammoth` for
   DOCX, `pdf-parse` for PDF) and dropped into the same session state a sample contract
   would occupy — every downstream skill treats it identically.
3. **Highlight any passage** in the document — a "Selected excerpt" section immediately
   appears at the top of both the **Risk** and **Compliance** tabs, scored against just
   that highlighted text (same judgments, same skills, scoped to a smaller state — see
   [`src/lib/orchestrator/excerpt.ts`](src/lib/orchestrator/excerpt.ts)). Clear the
   highlight and both tabs go back to showing the whole document's score.
4. In the chat panel, the **"Analyze this contract"** and **"Check compliance"** pills are
   context-sensitive: with a passage highlighted, they score *that excerpt* and jump to
   the matching tab; with nothing highlighted, they run the normal whole-document
   analysis. **"Summarize this context"** and **"Verify a citation"** always operate on
   the full session.
5. Watch the **Trace** tab: one API call, every applicable skill's questions answered
   together, with probability bars and confidence badges — and OpenAI's answer to the
   identical question shown right next to each one. Dimmed entries were fetched
   speculatively but weren't needed for this turn's reply — that's deliberate (see
   Architecture, below).
6. Check **Risk** — a composite score built from three independent Score judgments
   (liability, indemnification, termination), combined with weights that live in
   application code, not a prompt.
7. Check **Compliance** — four plain yes/no flags with their own probabilities.
8. Open **Citations** with a document loaded: nothing to type or click. The document, or the passage you highlight, is read
   automatically. Every reference the text makes (a cross-reference like "under Section 4", a legal citation, an attachment)
   and every key term (renewal, liability cap, termination, governing law and so on) is pulled out with the clause quoted and
   the figures extracted (`30 days`, `$50,000`, `no cap`, `termination fee`). References are checked against the section they
   cite (one to a section that does not exist is a *broken reference*), and terms against the playbook (an essential term the
   document lacks is *missing*). Both models judge every check in one batched request each, and the results sit in one table
   near the top, with the independent judge scoring the check that matters most.

Every one of the four tabs above shows TypeSafe's and OpenAI's answers to the same
question side by side — there's no separate "Compare" destination. Each side is driven by
its own independently-fired network request (see "Two backends, measured live," below), so
one can finish, error, or fall back while the other is still running.

## Architecture

```
User message
     │
     ▼
┌─────────────────────────────────────────────────────────────┐
│  Orchestrator (src/lib/orchestrator/run.ts)                  │
│                                                                │
│  1. Build `state` from session memory + latest message        │
│     (src/lib/orchestrator/state.ts)                            │
│  2. Ask every APPLICABLE skill for its questions               │
│     — one skill per file, src/lib/skills/*.ts                  │
│  3. ONE Jev call, every question in parallel             │
│     (speculative fan-out — docs.typesafe.ai/patterns/fan-out)  │
│  4. Confidence-gate: guardrails first, then intent routing,     │
│     then a plain switch statement reads the answers it needs   │
│     and ignores the rest                                       │
│  5. Code composes the findings (risk, flags, routing), then a   │
│     model writes the answer from the document and those        │
│     findings (src/lib/chat/), or, with no key, the document's  │
│     own clauses are quoted. TypeSafe never generates prose.    │
└─────────────────────────────────────────────────────────────┘
```

### How the chat answers

The typed judgments still decide everything structural: guardrails, intent, the risk score and the compliance flags. What
changed is who writes the words. The answer writer ([`src/lib/chat/`](src/lib/chat/)) sends the loaded document, the last few
turns and Meridian's own findings, as fixed facts to quote, to the OpenAI model chosen in the API Keys dialog. It is told to
quote the clauses it relies on, to say so when the document is silent, and to answer general legal questions directly instead
of refusing them. The document, the conversation and the message are fenced as untrusted data.

- **No key saved:** nothing is faked. The reply quotes the clauses most relevant to the question with their section, and
  says it is the document's own wording (`src/lib/chat/extractive.ts`).
- **Refusals stay Meridian's.** A guardrail block (injection, privileged content) is never rewritten and makes no model call.
- **Each backend gets its own answer**, written from its own judgments, so the comparison and the judge still see two
  replies that differ only where the judgments do. The write is timed and priced as its own activity ("Answer writer"), never
  as part of either backend's speed or cost.
- Under each reply the chat says where it came from: which model wrote it, or that it is quoted from the document.

### The skills/plugin architecture

Each file in [`src/lib/skills/`](src/lib/skills/) is a self-contained "AI skill": a name,
a description, an `isApplicable(state)` predicate, and a `buildQuestions(state)` function
that proposes TypeSafe questions. This is deliberately shaped like Microsoft **Semantic
Kernel's** plugin/function model — small, independently testable, composable units that
an orchestrator assembles at request time, rather than one growing monolithic prompt.
Adding a new capability means adding one file and one line in
[`src/lib/skills/index.ts`](src/lib/skills/index.ts) — no other skill is touched, and no
existing prompt is edited.

| Skill | File | What it asks |
|---|---|---|
| Guardrails | `guardrails.ts` | Privileged content / PII leakage, prompt-injection — always runs, first |
| Intake Router | `intakeRouter.ts` | Intent classification + urgency — the front door |
| Contract Type | `contractType.ts` | Classifies a newly-loaded document once, then remembers it |
| Clause Risk | `clauseRisk.ts` | Three independent Scores combined into a composite risk number |
| Compliance Guard | `complianceGuard.ts` | Four independent yes/no compliance checks |
| Citations | `src/lib/citations/` | Automatic extraction, then one batched relation check — see below |

[`src/lib/orchestrator/excerpt.ts`](src/lib/orchestrator/excerpt.ts) reuses the exact same
`RISK_DIMENSIONS` / `COMPLIANCE_CHECKS` question definitions from `clauseRisk.ts` /
`complianceGuard.ts` for excerpt-scoped scoring — those skills' `buildQuestions` don't
actually read session context, only those constants, so pointing them at a one-off
`{ active_document: { text: excerpt } }` state is enough for a highlighted passage to be
scored with zero duplicated logic.

### Speculative fan-out, and the one exception to it

Every applicable skill's questions go into **one** `system_one` call per turn
([patterns/fan-out](https://docs.typesafe.ai/patterns/fan-out)). Risk-scoring and
compliance questions are asked even before we know the user's intent is
"analyze this contract" — they're nearly free to ask (TypeSafe evaluates every question
in parallel against the same state) and the orchestrator simply ignores the answers it
doesn't end up needing. The Trace tab visualizes exactly this: unused answers are shown,
dimmed, rather than hidden, specifically to make this pattern legible.

Citation checking is the one deliberate exception to the single fan-out call
([`src/lib/citations/`](src/lib/citations/)): code has to find WHAT to check, and which text each claim is judged against,
*before* it can ask a model anything, so it is a real two-step, code-gated sequence. This mirrors
[the citation-check cookbook](https://docs.typesafe.ai/cookbooks/citation_check) and is called out in the docs as the
correct exception, not the default.

1. **Extract, by rule, no model** ([`extract.ts`](src/lib/citations/extract.ts), [`topics.ts`](src/lib/citations/topics.ts)).
   The text is split into clauses ([`sections.ts`](src/lib/citations/sections.ts), `Doc §N`, or `Doc ¶N` for text without
   numbering). Two kinds of check come out. A *reference* is a citation the text itself makes: an internal cross-reference
   is resolved to the section it cites (a reference to one that does not exist is a broken reference, decided by rule), and
   legal citations and attachments are named and marked not checkable here. A *term* is a key topic: the clause that covers it
   is chosen, quoted verbatim, and its figures pulled out, to be checked against the playbook's expectation. An essential
   term with no clause is reported missing, but only for text that reads as a contract. A highlighted passage is read on its
   own, with its references still resolved against the whole document.
2. **Judge, in one request per backend** ([`batch.ts`](src/lib/citations/batch.ts), `POST /api/citations`). Every check that a
   model should judge becomes one three-way `Choice` (supports, contradicts, says nothing) over its own claim and source, so
   a whole document costs one call to TypeSafe and one to OpenAI. Checks decided by rule never leave the app.

Results are kept for the session ([`store.ts`](src/lib/citations/store.ts)) so switching tabs costs nothing, and each read text
runs once. The playbook (`src/lib/data/authorities.ts`) is fictional and stands in for a real internal one.

### Conversational context / memory

[`src/lib/memory/session.ts`](src/lib/memory/session.ts) holds an in-memory,
session-scoped store (swap it for Redis/DynamoDB for multi-instance production — every
caller only depends on this file's three exported functions, so that's a one-file change).
[`src/lib/orchestrator/state.ts`](src/lib/orchestrator/state.ts) folds session memory into
every turn's `state`: the active document, a rolling window of recent turns, and facts
established once (like contract type) that are never re-asked for. The "Context memory" bar
above the workspace tabs makes this visible — turn count, active document, and classified
contract type persist and are shown in real time.

### Confidence-gated automation, not just classification

Every place a judgment feeds an action, code checks `confidence` first
([docs.typesafe.ai/confidence](https://docs.typesafe.ai/confidence)): intent routing below
0.35 confidence asks a clarifying question instead of guessing; a risk score below 0.5
confidence gets an explicit "have an attorney confirm this" hedge in the reply; a citation
verdict below 0.75 confidence is marked "routed to human review" instead of auto-accepted.
This is the actual point of using a model that returns calibrated probabilities instead of
free text — the system can say "I'm not sure" in a way code can branch on.

### Two backends, measured live, side by side on every tab

Every dual-backend comparison in this app — a chat turn, a citation check, or an
excerpt score — fires **two separate network requests at the same moment** (e.g.
`POST /api/chat` and `POST /api/compare-openai` for a chat turn) rather than bundling both
into one server-side call. That's a deliberate architectural choice, not an implementation
detail: each side updates the instant *its own* request resolves, independent of the
other's timing, success, or failure.

- **Measure.** Each side shows real token usage, real cost (against TypeSafe's published
  pricing and OpenAI's list pricing — [`src/lib/compare/pricing.ts`](src/lib/compare/pricing.ts)),
  and real latency, computed from the actual response.
- **Monitor.** A running session total (calls, tokens, cumulative cost per backend) sits at
  the foot of the Trace tab, so a multi-turn conversation shows accumulated cost drift, not
  just one data point. The header's `TypeSafe` / `OpenAI` pills track whichever request —
  from *any* tab — is currently or most recently running.
- **Validate.** Every judgment shows TypeSafe's calibrated choice/score/noul right next to
  OpenAI's function-call output for the identical question, with a ✓/✕ agreement column on
  the Trace tab.
- **Trace failures, not just successes.** If an OpenAI call errors or falls back to a
  different model, the raw error or fallback notice renders directly under that
  comparison's measurements (`src/components/OpenAINote.tsx`) — "no answer" never ships
  without a reason attached.

The OpenAI side is genuinely optional. With no key configured (env var or Settings modal),
every `/api/compare-openai*` route still returns instantly
(`{ ok: false, reason: "not_configured" }`, no external call made), and the UI renders that
state plainly rather than faking activity. Either way, the qualitative differences hold:

- **No native calibrated uncertainty.** A `Choice`/`Score` answer's `probabilities` come
  from a model trained specifically to be calibrated. OpenAI's function-calling has no
  equivalent — the workaround here is a self-reported `confidence` field
  (`src/lib/openai/client.ts`), which is not independently calibrated to anything, and the
  per-question table makes that gap visible rather than papering over it.
- **Output tokens are free on Jev** (`$0.042`/Mtok input, `$0` output — see
  [docs.typesafe.ai/models](https://docs.typesafe.ai/models)); a chat-completions response
  has to *generate* every field as text and is billed for it, so a bigger speculative
  fan-out directly costs more tokens and more decode-time latency there, where it's nearly
  free on Jev.
- **Answers are constrained by construction.** A `Choice` can't return a value outside your
  declared options. The OpenAI schema uses `strict: true` (Structured Outputs) to get the
  same guarantee there — worth calling out as the actual mitigation, not "just trust the
  model," since it wasn't always available and still doesn't provide the probability
  distribution.

### A third, independent judgment: DeepEval

Everything above measures TypeSafe's and OpenAI's own confidence in their own answers. That's not
the same question as "was the answer actually good?" For that, Meridian calls a small Python
microservice ([`eval-service/`](eval-service/)) wrapping [DeepEval](https://github.com/confident-ai/deepeval)'s
`GEval` metric: an LLM-as-judge that scores an answer against a versioned rubric and explains why.

Every tab that shows a judgment has the same **evaluation panel**: a title and one-line subtitle
saying what is being checked, then one card per backend with the metrics first (score, pass
threshold, judge model, rubric version, latency) and the messages below them: the judge's verdict,
any untrusted-content warning, the exact evidence the judge saw, and the fixed steps it followed.

What makes the score trustworthy, and what does not:

- **Like-for-like.** Both backends' answers are rendered by the same packet builder
  ([`src/lib/eval/packets.ts`](src/lib/eval/packets.ts)), with the scoring method and scale
  definitions included so the judge can verify the arithmetic. Confidence is excluded on purpose.
- **Reproducible.** The judge follows fixed, versioned steps, not steps it invents per call.
- **Hardened against the document itself.** Contract text is sanitized, fenced as untrusted data,
  and scanned for prompt-injection attempts; a suspicious document produces a visible warning.
- **Both backends, including the chat reply.** OpenAI gets a reply of its own: the same composer that builds
  TypeSafe's reply (`src/lib/orchestrator/compose.ts`) runs on OpenAI's answers to the same questions, so the two
  replies differ only where the models' judgments differ, and each is checked against its own judgments. (OpenAI's
  reply quotes no flag probability, because it has only a self-reported confidence, not a calibrated probability.)
- **Never the demo heuristic.** Without a live TypeSafe key, answers come from a local keyword
  heuristic. Those are not evaluated as if they were TypeSafe's; the panel says so.
- **Measured, not assumed.** [`eval-service/golden/run_golden.py`](eval-service/golden/run_golden.py)
  scores the judge itself against 27 known-answer cases, including injection attacks.

**It evaluates itself the first time you open each action** (the Trace, Risk, Compliance and Citations panels, and the
highlighted-excerpt scores), once per action per session, and only when it can work: the service is up, a judge key
is available, and both backends' answers have arrived. Results are kept for the session, so switching tabs never
re-runs (or re-bills) anything, and a changed answer waits for you to click **Re-evaluate**. Each run is real, paid
judge calls with your OpenAI key, so **Settings has a switch to turn auto-evaluation off**. It is otherwise genuinely
optional infrastructure: with the service not running, the panel says so and offers **Check again**. See
[`eval-service/README.md`](eval-service/README.md).

## Mapping to the job description

| JD responsibility | Where it shows up here |
|---|---|
| Design AI architectures that manage conversational context, memory, and multi-turn interactions | `src/lib/orchestrator/state.ts`, `src/lib/memory/session.ts` — context facts persist across turns, shown live in the Context memory bar |
| Develop AI skills, plugins, or instruction-based components | `src/lib/skills/*.ts` — a Semantic-Kernel-shaped plugin registry |
| Create, test, and optimize prompts, workflows, and AI orchestration logic | `src/lib/orchestrator/run.ts` — fan-out, confidence gating, reply composition all live in typed code, not a prompt string |
| Explain AI architecture decisions and how components interact | The Trace, Risk, Compliance, and Citations tabs make the architecture visible at runtime, not just in this README |
| Experience with Semantic Kernel / plugin-based AI frameworks | The skills registry is deliberately shaped like SK's plugin/function model — see "The skills/plugin architecture" above |
| Experience with RAG, vector databases, embeddings | Citation verification is a RAG-shaped retrieve-then-judge pipeline; `src/lib/data/authorities.ts` stands in for a vector-store-backed retrieval step (swap the substring `locate()` in `citationVerifier.ts` for embedding search against a real corpus — the judgment step downstream doesn't change) |
| AI evaluation, observability, model performance optimization | Per-answer DeepEval judgments with versioned rubrics and an injection-hardened judge, a golden-set harness for the judge itself, and `/stats` + structured logs on the eval service; see "A third, independent judgment," above |
| Deploy AI solutions in AWS or Azure | See "Taking this to production," below |

## Testing

```bash
npm test          # vitest run — one-shot
npm run test:watch
```

The test suite ([`vitest.config.mts`](vitest.config.mts)) covers the pure, dependency-free
logic that everything else is built on — the parts worth pinning down with real
assertions rather than eyeballing in the UI:

- **The mock evaluator** (`src/lib/typesafe/mock.ts`) — every answer shape stays valid
  (probabilities sum to ~1, scores stay in range), the negative-evidence tables actually
  move the needle, and the same input is always answered the same way.
- **Composite risk scoring** (`src/lib/skills/clauseRisk.ts`) — the 0.5/0.3/0.2 weighting
  is exercised at both the safest and riskiest ends, and a missing dimension correctly
  returns `null` rather than a partial score.
- **Citation extraction** (`src/lib/citations/`) — every key term is found in every sample contract with its clause and
  figures, a missing essential term is reported only for text that reads as a contract, a legal citation's numbers are never
  mistaken for sections, a reference to a section that does not exist is a broken reference, and a highlighted passage
  resolves its references against the whole document. The batch of checks is built, sent and read back the same way for both
  backends.
- **Excerpt scoring** (`src/lib/orchestrator/excerpt.ts`) — the same question set and
  0.55 compliance threshold as the whole-document path, just scoped to a smaller state.
- **Pricing, comparison-schema translation, and cross-backend agreement** (`src/lib/compare/*`)
  — including a regression test for a real prefix-collision bug class (`gpt-4o-mini`
  matching the `gpt-4o` reference price by accident depends on table ordering).
- **Settings** (`src/lib/settings.ts`) — a blank/whitespace-only key never produces a
  usable override, and the module never throws when `window` doesn't exist (SSR).

`npm run test:e2e` drives the running app in a real browser (Chrome via `playwright-core`) at eight screen sizes, phone through
1920px, checking layout, accessibility (axe), keyboard and dialog behavior, and touch-target sizes. It needs no API keys.

`npm run test:e2e:report` checks **Download report** end to end: it populates Risk, Compliance and Citations through the real UI with the
judge and OpenAI simulated at known scores, downloads the web page, PDF, Word and Markdown files, and checks their tables, explanations,
characters, page layout and the menu's accessibility. Files and screenshots are written to `reports/` (gitignored). It needs no API keys.
`npm run test:e2e:citations` checks the Citations tab end to end: a document is read and checked with no click and one batched
request per backend, results survive a tab switch, a highlighted passage is read on its own, references and attachments are
found and classified, a text with nothing to check makes no model call, and the tab works on a phone and passes the accessibility scan.
It needs no API keys.
`npm run check:report -- <file>` validates a report you downloaded from your own session (.html, .pdf, .docx or .md): it is complete, the
table agrees with the scoring sections, pass/fail agrees with the threshold and the band agrees with the score. It needs no keys and no
running app, so a report produced by the real judge, with the keys saved in the Settings modal, can be checked directly.

The eval service has its own suites: `pytest -q` in `eval-service/` covers validation, prompt construction, injection detection, and
monitoring with the judge stubbed, and `python golden/run_golden.py` scores the real judge against known-answer cases (see
[`eval-service/README.md`](eval-service/README.md)).

What is not unit-tested: how React components render (there is no DOM test environment). That layer is covered
instead by `npm run test:e2e` in a real browser, and the two API routes that carry real logic
(`/api/evaluate`, `/api/compare-openai`) have their own tests with the external calls mocked. What no test here can
cover is a live model: the local heuristic and stand-ins exercise the plumbing, and only a real key exercises the
judge and the comparison with real OpenAI.

## Taking this to production

This is a demo, and a few things are deliberately simplified — worth being upfront about
in an interview rather than pretending otherwise:

- **Session store.** In-memory, single-instance (`src/lib/memory/session.ts`). Behind a
  load balancer or multiple instances, this needs Redis or DynamoDB — the module's three
  exported functions are the only integration surface, so it's a contained change.
- **Citation retrieval.** `AUTHORITY_SECTIONS` is a hardcoded object standing in for a
  real playbook, and the clause for each key term is chosen by keyword rules
  (`src/lib/citations/topics.ts`). A production version would embed the playbook and the
  document's clauses into a vector store (pgvector, OpenSearch, Pinecone) and choose them by
  similarity, and would resolve outside citations (statutes, cases) against a real
  corpus instead of marking them not checkable. The "ask TypeSafe whether the retrieved
  context supports the claim" step is unchanged.
- **Cloud deployment.** This app is plain Next.js (App Router, API routes) with no
  platform-specific code, so it runs on Vercel as-is. For AWS/Azure: the same Next.js
  build runs on AWS App Runner, ECS Fargate, or Azure Container Apps behind a standard
  Dockerfile; the only environment-specific pieces are `TYPESAFE_API_KEY`/`OPENAI_API_KEY`
  (Secrets Manager / Azure Key Vault) and swapping the session store as above.
- **Observability.** The trace object this app already builds for the UI
  (`TraceEntry[]` in `src/lib/orchestrator/run.ts`) is the natural shape to ship to a real
  observability pipeline (structured logs, OpenTelemetry spans per skill) for drift
  monitoring and confidence-threshold tuning against real outcomes.
- **Uploaded file storage.** Uploaded documents are extracted to text and held only in the
  in-memory session (`src/app/api/extract/route.ts` never writes to disk) — a production
  version would persist the original file in object storage (S3/Blob) for audit purposes
  and virus-scan it before extraction.
- **User-supplied API keys stay in the browser only.** The Settings modal's keys live in
  `localStorage` and travel per-request in the body of this app's own API calls — they're
  never persisted server-side. A real multi-user product would move key management to a
  proper secrets/identity layer instead of trusting the client.
- **The mock evaluator is a mock.** `src/lib/typesafe/mock.ts` uses keyword-overlap
  heuristics, not a trained model — it exists purely so this app is runnable without
  credentials. It's intentionally imperfect at anything requiring real reading
  comprehension (see the comments in that file); the live Jev model does not share these
  limitations.

## Tech stack

Next.js 16 (App Router) · TypeScript · Tailwind CSS · [`@typesafe-ai/sdk`](https://docs.typesafe.ai/sdk/javascript) ·
`mammoth` (DOCX) · `pdf-parse` (PDF) · Vitest · Python + FastAPI + [DeepEval](https://github.com/confident-ai/deepeval) (`eval-service/`)
