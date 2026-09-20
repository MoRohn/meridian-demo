# Testing

Nothing here needs an API key. CI runs the first two layers on every push ([`.github/workflows/`](../.github/workflows/)).

| Layer | Command | Covers |
|---|---|---|
| Static checks | `npm run typecheck`, `npm run lint` | Types and lint |
| Unit tests | `npm test` (`npm run test:watch` while developing) | Pure logic and the two API routes with real logic |
| Browser suites | `npm run test:e2e` and the variants below | The real UI, in Chrome via `playwright-core` |
| Eval service | `pytest -q` in `eval-service/` | Validation, prompts, injection guard, monitoring, with the judge stubbed |
| Judge quality | `python golden/run_golden.py` in `eval-service/` | The real judge against known-answer cases. Needs a key and makes billed calls |

## Unit tests

[`vitest.config.mts`](../vitest.config.mts) runs the suite, with tests beside the code under `src/`. It covers the pure, dependency-free logic
everything else builds on:

- **The mock evaluator** (`src/lib/typesafe/mock.ts`): every answer shape stays valid (probabilities sum to about 1, scores
  stay in range), the negative-evidence tables move the result, and the same input is always answered the same way.
- **Composite risk scoring** (`src/lib/skills/clauseRisk.ts`): the 0.5 / 0.3 / 0.2 weighting at both ends, and a missing
  dimension returns `null` rather than a partial score.
- **Citation extraction** (`src/lib/citations/`): every key term is found in every sample contract with its clause and
  figures; a missing essential term is reported only for text that reads as a contract; a legal citation's numbers are never
  mistaken for sections; a reference to a nonexistent section is a broken reference; a highlighted passage resolves its
  references against the whole document; and the batch is built, sent and read back the same way for both backends.
- **Excerpt scoring** (`src/lib/orchestrator/excerpt.ts`): the same question set and 0.55 compliance threshold as the
  whole-document path.
- **Orchestration** (`src/lib/orchestrator/`): reply composition, and a characterization test against a golden fixture.
- **Comparison** (`src/lib/compare/*`): pricing, schema translation and cross-backend agreement, including a regression test
  for a prefix-collision bug class (`gpt-4o-mini` matching the `gpt-4o` reference price depends on table ordering).
- **Evaluation client** (`src/lib/eval/`): packets, verdict settling, transport, health, integrity and the golden-case
  builders. The `/api/evaluate` and `/api/compare-openai` routes have their own tests with external calls mocked.
- **Reports** (`src/lib/report/`): document building and all four renderers.
- **Settings and theme** (`src/lib/settings.ts`, `src/lib/theme*.ts`): a blank key never produces a usable override, the module
  never throws without `window` (SSR), and every brightness level passes contrast checks.

React components have no DOM-level unit tests; the browser suites cover that layer.

## Browser suites

Each script drives a running app. Start it first (`npm run meridian` or `npm run dev`), then run the script in another
terminal. Set `E2E_URL` if the app is not on `http://localhost:3000`. CI runs `npm run test:e2e` against the production build.

| Command | Checks |
|---|---|
| `npm run test:e2e` | Smoke suite: layout, accessibility (axe, at every brightness level and view), keyboard and dialog behavior, and touch-target sizes at eight screen sizes, phone through 1920px |
| `npm run test:e2e:chat` | The chat's answers through the real UI |
| `npm run test:e2e:citations` | A document is read and checked with no click and one batched request per backend; results survive a tab switch; a highlighted passage is read on its own; references and attachments are found and classified; text with nothing to check makes no model call; the tab works on a phone and passes the accessibility scan |
| `npm run test:e2e:pages` | The Document panel with a long upload: equal sheets that each hold their text with nothing lost; Previous/Next and the page indicator agree with the reader's position, including after a manual scroll; zoom or resize re-flows pages and keeps the reader at the same passage; a new document starts on page 1; desktop and phone |
| `npm run test:e2e:settings` | The Settings dialog, in particular the Judge model section |
| `npm run test:e2e:report` | **Download report** end to end: populates Risk, Compliance and Citations through the UI with the judge and OpenAI simulated at known scores, downloads the web page, PDF, Word and Markdown files, and checks their tables, explanations, characters, page layout and the menu's accessibility |

Report files and screenshots from these runs are written to `reports/`, which is gitignored and safe to delete.

`npm run check:report -- <file>` validates a report you downloaded from your own session (`.html`, `.pdf`, `.docx` or `.md`): it
is complete, the table agrees with the scoring sections, pass/fail agrees with the threshold and the band agrees with the
score. It needs no running app, so a report produced by the real judge can be checked directly.

## Eval service

`pytest -q` in [`eval-service/`](../eval-service/) covers validation, error mapping, prompt construction, injection detection
and monitoring with the judge stubbed. `python golden/run_golden.py` and `deepeval test run tests/evals/test_judge_golden.py`
score the real judge against the golden set. Details, and the cost of each layer, are in
[`eval-service/README.md`](../eval-service/README.md#testing).

## What no test here can cover

A live model. The local heuristic and stand-ins exercise the plumbing; only a real key exercises the judge and the comparison
against real OpenAI. Run the golden suite with a key before trusting a rubric change.
