# Meridian

**A conversational contract-risk copilot.** Meridian ingests a legal document, reviews it for risk, flags compliance issues
and checks its references and key terms, showing its reasoning at every step. It also runs the same work on a second model
provider and scores both with an independent judge, so you can see what a typed-judgment architecture buys you over a
traditional chat-completions one, with real measurements instead of claims.

It is built on **[TypeSafe](https://docs.typesafe.ai)**, whose Jev model returns typed, calibrated judgments (`Choice`,
`Score`, `Noul`) instead of generated text. That suits the parts of a production AI application that chatbot demos tend to skip:
routing, confidence-gated automation, and business logic that lives in code rather than in a prompt.

- **Skills architecture.** Small, independent skills propose typed questions; an orchestrator asks them all in one call and
  ordinary code decides what to do with the answers.
- **Live side-by-side comparison.** Every tab shows TypeSafe's answer next to OpenAI's for the same question, with measured
  tokens, cost and latency from two independent requests.
- **Independent evaluation.** A DeepEval service judges both answers against versioned rubrics, hardened against
  prompt injection in the document itself, and the judge is itself scored against a golden set.
- **Runs with no keys.** A local heuristic evaluator stands in when no key is set, and the UI always says which one answered.

## Quick start

Requires Node.js 20 or later.

```bash
npm install
npm run meridian
```

`npm run meridian` starts the app on `http://localhost:3000` (set `PORT` to change it), exits with a clear message instead of
silently moving to another port if that one is taken, and opens your browser once the server is ready. It also starts the
evaluation service if you have set it up. Plain `npm run dev` works too.

To use real models, add keys in the app's **Settings** dialog (the gear icon) or copy [`.env.example`](.env.example) to
`.env.local`. Both keys are optional and independent. See [Configuration](docs/configuration.md).

### Evaluations (optional)

The **Evaluate** buttons need the Python service in [`eval-service/`](eval-service/). Set it up once:

```bash
npm run eval-service:setup    # creates eval-service/.venv and installs requirements
```

After that, `npm run meridian` starts it alongside the app (`MERIDIAN_EVAL=0` skips it). Without it the app works as usual and
the evaluation panel says the service is not running. See [Evaluation](docs/evaluation.md).

## A tour

1. **Load a sample contract** at the top of the left panel: a one-sided SaaS MSA, a balanced mutual NDA, or an employment
   agreement missing a governing-law clause. They are written to produce visibly different risk profiles. The document renders
   as fitted, paginated sheets; **Expand** opens a full reading view.
2. **Or upload your own.** Drag a `.pdf`, `.docx` or `.txt` file onto the left panel, or use the "Upload a file" chip. Text is
   extracted server-side (`mammoth` for DOCX, `pdf-parse` for PDF) and every skill treats it like a sample.
3. **Highlight any passage.** A "Selected excerpt" section appears on the **Risk** and **Compliance** tabs, scored against just
   that text. Clear the highlight to return to the whole-document score.
4. **Chat.** The **Analyze this contract** and **Check compliance** pills act on the highlighted excerpt if there is one, and on
   the whole document otherwise. **Summarize this context** and **Verify a citation** always use the full session.
5. **Trace** shows one call answering every applicable skill's questions, with probability bars, confidence badges and
   OpenAI's answer to each. Dimmed entries were fetched speculatively and not needed for this turn.
6. **Risk** is a composite of three independent Score judgments (liability, indemnification, termination), weighted in code.
7. **Compliance** shows four yes/no flags with their own probabilities.
8. **Citations** needs no input: it reads the document (or your highlight), finds every cross-reference, legal citation,
   attachment and key term, checks references against the sections they cite and terms against a playbook, and judges the
   results in one batched request per model.
9. **Download report** exports the results as a web page, PDF, Word or Markdown file.

Each tab shows both backends' answers side by side; there is no separate Compare screen. The header pills and the
brightness control (sun/moon icon) are described in [Configuration](docs/configuration.md).

## Documentation

| Page | What it covers |
|---|---|
| [Architecture](docs/architecture.md) | Orchestrator, skills, speculative fan-out, the citation pipeline, chat answers, confidence gating, the live comparison |
| [Evaluation](docs/evaluation.md) | How the DeepEval judge is used and what makes its scores trustworthy |
| [`eval-service/README.md`](eval-service/README.md) | The evaluation service: endpoints, environment, rubrics, injection guard, golden set |
| [Configuration](docs/configuration.md) | Environment variables, the Settings dialog, display brightness |
| [Testing](docs/testing.md) | Unit, browser and eval-service test suites, and what none of them can cover |
| [Production notes](docs/production.md) | What the demo simplifies and what replaces each part |

## Project layout

```
src/app/            Next.js App Router: the page and the API routes (chat, citations, evaluate, compare, extract, ...)
src/components/     React UI: workspace tabs, document panel, evaluation panel, settings, report menu
src/lib/            Application logic, one folder per concern:
  orchestrator/       the per-turn pipeline: state, fan-out, gating, reply composition
  skills/             the plugin-style skills (guardrails, intake router, clause risk, compliance, ...)
  citations/          extraction by rule, then one batched judgment
  chat/               the answer writer and its no-key extractive fallback
  compare/            pricing, agreement and performance across the two backends
  eval/               the client, evidence packets and verdict handling for the eval service
  typesafe/, openai/  the two backend clients (typesafe/ includes the local heuristic evaluator)
  report/             report building and the four renderers
  data/               sample contracts and the fictional playbook
eval-service/       Python (FastAPI + DeepEval) judge service, its rubrics, and the golden set
e2e/                Browser suites (Playwright) and the downloaded-report checker
scripts/            `npm run meridian` and eval-service setup/start
docs/               The documentation linked above
```

Unit tests sit beside the code they cover (`*.test.ts`).

## Tech stack

Next.js 16 (App Router) · React 19 · TypeScript · Tailwind CSS 4 · [`@typesafe-ai/sdk`](https://docs.typesafe.ai/sdk/javascript) ·
`mammoth` and `pdf-parse` (uploads) · `docx`, `jspdf` (reports) · Vitest · Playwright · Python, FastAPI and
[DeepEval](https://github.com/confident-ai/deepeval) (`eval-service/`)

## Note for contributors and coding agents

This project uses a version of Next.js with breaking changes from older releases. [`AGENTS.md`](AGENTS.md) points to the
bundled docs in `node_modules/next/dist/docs/`; read the relevant guide before changing framework-level code.
