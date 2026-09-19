"""
Meridian's evaluation service — a small FastAPI wrapper around DeepEval
(https://github.com/confident-ai/deepeval) that scores a single model
answer (TypeSafe's or OpenAI's) against a natural-language rubric using
DeepEval's G-Eval metric, an LLM-as-judge approach that returns both a
0-1 score AND a written chain-of-thought explanation of why it landed
there.

This is a genuinely separate evaluation layer, not a re-implementation of
what Meridian already measures: TypeSafe's own `confidence` and OpenAI's
self-reported confidence describe how sure the ANSWERING model was.
G-Eval here is a THIRD, independent model judging whether that answer was
actually good, given the task's own rubric. Run it once per task/action —
not per individual trace question — since it makes a real LLM call and
costs real tokens.

Run locally:
    cd eval-service
    python3 -m venv .venv && source .venv/bin/activate
    pip install -r requirements.txt
    export OPENAI_API_KEY=sk-...      # the judge model's key — see README
    uvicorn main:app --port 8008 --reload
"""

import os

from deepeval.metrics import GEval
from deepeval.test_case import LLMTestCase, LLMTestCaseParams
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

app = FastAPI(title="Meridian Eval Service", version="0.1.0")

# Local dev only — the real trust boundary is that this service is only
# ever called server-to-server from Meridian's own /api/evaluate route
# (see src/app/api/evaluate/route.ts), never directly from the browser.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://meridian.local:3000"],
    allow_methods=["POST"],
    allow_headers=["*"],
)

JUDGE_MODEL = os.environ.get("EVAL_JUDGE_MODEL", "gpt-4o-mini")


class EvaluateRequest(BaseModel):
    task: str
    backend: str
    criteria: str
    input: str
    actual_output: str
    context: str | None = None


class EvaluateResponse(BaseModel):
    score: float
    reason: str
    success: bool
    judge_model: str


@app.get("/health")
def health():
    return {"status": "ok", "judge_model": JUDGE_MODEL}


@app.post("/evaluate", response_model=EvaluateResponse)
def evaluate(req: EvaluateRequest):
    if not os.environ.get("OPENAI_API_KEY"):
        raise HTTPException(
            status_code=503,
            detail="OPENAI_API_KEY is not set for the eval service — G-Eval needs a judge model to call.",
        )

    params = [LLMTestCaseParams.INPUT, LLMTestCaseParams.ACTUAL_OUTPUT]
    context = [req.context] if req.context else None
    if context:
        params.append(LLMTestCaseParams.CONTEXT)

    test_case = LLMTestCase(
        input=req.input,
        actual_output=req.actual_output,
        context=context,
    )

    metric = GEval(
        name=f"{req.task} ({req.backend})",
        criteria=req.criteria,
        evaluation_params=params,
        model=JUDGE_MODEL,
        threshold=0.6,
    )

    try:
        metric.measure(test_case)
    except Exception as exc:  # noqa: BLE001 — surface the judge call's own failure verbatim
        raise HTTPException(status_code=502, detail=f"G-Eval judge call failed: {exc}") from exc

    return EvaluateResponse(
        score=metric.score,
        reason=metric.reason,
        success=metric.is_successful(),
        judge_model=JUDGE_MODEL,
    )
