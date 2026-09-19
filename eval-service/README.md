# Meridian eval service

A small Python microservice wrapping [DeepEval](https://github.com/confident-ai/deepeval) —
specifically its `GEval` metric, an LLM-as-judge approach that scores a piece of text against a
natural-language rubric and writes out its own reasoning for the score. This is what powers the
**"Evaluate"** button on Meridian's Trace, Risk, Compliance, and Citations tabs: a third,
independent judgment layered on top of whatever TypeSafe and OpenAI already answered.

This has to be a separate service because DeepEval is Python-only; Meridian itself is a
TypeScript/Next.js app. `src/app/api/evaluate/route.ts` proxies to it server-to-server, the same
pattern used for every other backend call in this app.

## Running it

```bash
cd eval-service
python3 -m venv .venv
source .venv/bin/activate        # .venv\Scripts\activate on Windows
pip install -r requirements.txt

export OPENAI_API_KEY=sk-...     # the JUDGE model's key — separate concern from Meridian's own
                                  # OPENAI_API_KEY; G-Eval needs a model to call to do the judging
uvicorn main:app --port 8008 --reload
```

Then, in the Next.js app's own environment (`.env.local` or your shell), point it at this
service — it defaults to `http://localhost:8008` if unset:

```bash
export EVAL_SERVICE_URL=http://localhost:8008
```

The eval service is genuinely optional infrastructure. With it not running, every "Evaluate"
button in Meridian still works — it just reports "eval service unreachable" instead of a score,
the same honest "not configured" treatment the rest of the app gives a missing API key.

## What it evaluates, and why per-action rather than per-question

Each Meridian tab that shows a judgment (Trace's composed reply, Risk's composite score,
Compliance's flag set, a Citation verdict) can trigger one G-Eval call per backend — not one per
individual trace question. A G-Eval call is a real LLM call with real latency and cost; scoring
every one of the 8-12 individual questions in a turn's fan-out, times two backends, on every
render would be both slow and expensive for a demo app. Scoring at the same granularity as the
capability itself (one risk score, one compliance flag set, one citation verdict) keeps this
useful without turning "highlight a sentence" into a background LLM-call storm.

## Configuration

| Env var | Default | Purpose |
|---|---|---|
| `OPENAI_API_KEY` | — (required) | The judge model's key. G-Eval needs a real model to call to produce a score + reasoning. |
| `EVAL_JUDGE_MODEL` | `gpt-4o-mini` | Which model does the judging. Any DeepEval-supported chat model works. |

## Endpoints

- `GET /health` — liveness check, returns the configured judge model.
- `POST /evaluate` — `{ task, backend, criteria, input, actual_output, context }` → `{ score, reason, success, judge_model }`.
