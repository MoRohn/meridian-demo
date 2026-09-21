# Evaluation

The [architecture](architecture.md) measures TypeSafe's and OpenAI's own confidence in their own answers. That is not the same
question as "was the answer actually good?" For that, Meridian calls a small Python service
([`eval-service/`](../eval-service/)) wrapping [DeepEval](https://github.com/confident-ai/deepeval)'s `GEval` metric: an
LLM-as-judge that scores an answer against a versioned rubric and explains why.

This page covers how the app uses the service. The service itself (endpoints, environment, rubrics, the golden set and its
tests) is documented in [`eval-service/README.md`](../eval-service/README.md).

## The evaluation panel

Every tab that shows a judgment has the same panel: a title and one-line subtitle saying what is checked, then one card per
backend with the metrics first (score, pass threshold, judge model, rubric version, latency) and the messages below: the
judge's verdict, any untrusted-content warning, the exact evidence the judge saw, and the fixed steps it followed.

## Seeing the scoring rules

Every analysis page (Trace, Risk, Compliance, Citations) has the same **Scoring Rubric** button at the top right. It opens a
scrollable dialog in two parts:

- **How answers are scored** is the independent judge's rubric for that page: what it judges, its steps (each a short label and
  a one-line summary, with the exact wording one click away), the 0 to 10 score bands coloured by whether they pass, the pass
  mark, and the rubric's version. Risk, Compliance and Citations show their own rubric; Trace scores the chat reply and
  compares everything, so it shows all four, with chips to jump between them.
- **How Meridian decides** is the rules the application itself applies to produce those answers: the risk dimensions with
  their weights and three-level scales and the risk bands; the four compliance checks and their flag threshold; how citations
  are found (cross-references, legal citations, attachments, key terms), who decides each kind and what the verdicts mean; and
  the guardrails on every message. Risk, Compliance (with the guardrails) and Citations each show theirs; Trace shows all of it.

Neither part is retyped in the app. The judge's rubric is read from the evaluation service (`GET /rubrics`, proxied by
`/api/rubrics`), so it changes only where the rubric does ([`eval-service/rubrics.py`](../eval-service/rubrics.py), where each
step's label and summary sit beside its exact wording, as display copy that never changes a score). Meridian's rules are built
from the same constants and question definitions the app runs on ([`src/lib/rules/guide.ts`](../src/lib/rules/guide.ts)), so
the page cannot describe a weight, threshold or check the code does not use. If the evaluation service is not running, the
judge's part says so and how to start it, and Meridian's rules still show.

## What makes the score trustworthy

- **Like-for-like.** Both backends' answers are rendered by the same packet builder
  ([`src/lib/eval/packets.ts`](../src/lib/eval/packets.ts)), with the scoring method and scale definitions included so the
  judge can verify the arithmetic. Confidence is excluded on purpose.
- **Reproducible.** The judge follows fixed, versioned steps, not steps it invents per call.
- **Hardened against the document itself.** Contract text is sanitized, fenced as untrusted data and scanned for
  prompt-injection attempts; a suspicious document produces a visible warning. The scan is a partial signal, never a
  guarantee, and the UI never claims a document is clean.
- **Both backends, including the chat reply.** OpenAI gets a reply of its own: the composer that builds TypeSafe's reply
  ([`src/lib/orchestrator/compose.ts`](../src/lib/orchestrator/compose.ts)) runs on OpenAI's answers to the same questions, so
  the replies differ only where the models' judgments differ, and each is checked against its own judgments. OpenAI's reply
  quotes no flag probability, because it has only a self-reported confidence.
- **Never the demo heuristic.** Without a live TypeSafe key, answers come from a local keyword heuristic. Those are not
  evaluated as if they were TypeSafe's; the panel says so.
- **Measured, not assumed.** [`eval-service/golden/run_golden.py`](../eval-service/golden/run_golden.py) scores the judge
  itself against 27 known-answer cases, including injection attacks.

## When it runs

The app evaluates the first time you open each action (the Trace, Risk, Compliance and Citations panels, and the
highlighted-excerpt scores), once per action per session, and only when it can work: the service is up, a judge key is
available, and both backends' answers have arrived. Results are kept for the session, so switching tabs never re-runs (or
re-bills) anything, and a changed answer waits for you to click **Re-evaluate**.

Each run is real, paid judge calls, so **Settings has a switch to turn auto-evaluation off**. The service is otherwise
optional: when it is not running, the panel says so and offers **Check again**.

## Choosing the judge

By default the judge uses the OpenAI key saved in Settings (or `OPENAI_API_KEY` on the service). The **Judge model** section
of the same dialog can switch it to Claude, Gemini, or another OpenAI model. A judge from a third company (Claude or Gemini)
is the recommended setup, because a judge tends to favor its own company's answers and OpenAI both writes the chat replies
and is one of the two backends being compared. The judge key travels per request in headers and is never stored or logged by
the service; see [`eval-service/README.md`](../eval-service/README.md#using-the-openai-key-saved-in-meridians-settings).

## Setup

```bash
npm run eval-service:setup   # once: creates eval-service/.venv and installs requirements
npm run meridian             # starts the service alongside the app (MERIDIAN_EVAL=0 skips it)
npm run eval-service         # or run the service on its own
```

After updating from a version without Claude and Gemini judges, run `npm run eval-service:setup` again and restart the service
to install their SDKs.
