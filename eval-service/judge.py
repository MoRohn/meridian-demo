"""
How a judgment is built: the ONE place that turns a rubric plus untrusted request
data into a DeepEval test case and a configured G-Eval metric.

The HTTP service (main.py) and the DeepEval test suite (tests/evals/) both import
this, so the suite always exercises exactly the judge configuration production
uses; the two cannot drift apart.
"""

import os

from deepeval.metrics import GEval
from deepeval.metrics.g_eval import Rubric as ScoreBand
from deepeval.test_case import LLMTestCase, SingleTurnParams

import guard
from rubrics import Rubric

JUDGE_MODEL = os.environ.get("EVAL_JUDGE_MODEL", "gpt-4o-mini")
PASS_THRESHOLD = float(os.environ.get("EVAL_PASS_THRESHOLD", "0.6"))
# How many candidate score tokens G-Eval averages over. DeepEval defaults to 20 and returns a probability-weighted
# average, which can carry a verdict across a band boundary: a judge whose top choice is 6 (a pass) but who is unsure
# can average to 5.2 and fail, and one whose top choice is 5 (a fail) with mass on 7-8 can average to 6.4 and pass,
# leaving the shown score at odds with the judge's own written reason. With 1 the score IS the judge's chosen integer,
# so the verdict always matches the band it chose. Set EVAL_TOP_LOGPROBS=20 to restore averaging and compare on the golden set.
TOP_LOGPROBS = int(os.environ.get("EVAL_TOP_LOGPROBS", "1"))


def prepare_case(rubric: Rubric, request: str, answer: str, source: str | None) -> tuple[LLMTestCase, guard.Integrity]:
    """Sanitizes, scans and fences the untrusted blocks, and lays them out for G-Eval."""
    blocks = {"REQUEST": request, "ANSWER": answer}
    if source:
        blocks["SOURCE TEXT"] = source
    cleaned, integrity = guard.inspect_blocks(blocks)

    nonce = guard.new_nonce()
    judge_input = "\n\n".join(
        [f"TASK: {rubric.task_line}"]
        + [guard.fence(label, cleaned[label], nonce) for label in ("REQUEST", "SOURCE TEXT") if label in cleaned]
    )
    # The source text rides inside `input` (real newlines, one fenced block) rather than
    # G-Eval's `context` parameter, which is rendered as a Python list repr and would turn
    # every line break in a contract into a literal backslash-n.
    return LLMTestCase(input=judge_input, actual_output=guard.fence("ANSWER", cleaned["ANSWER"], nonce)), integrity


def build_metric(rubric: Rubric, backend: str, model: str, threshold: float) -> GEval:
    """
    Fixed evaluation_steps (reproducible) plus a rubric of non-overlapping score bands, both of
    which DeepEval documents as the way to make G-Eval more consistent across runs. The bands shape the judge's
    choice (they are in its prompt); they do not confine the averaged score, which is why TOP_LOGPROBS defaults to 1. Only INPUT and
    ACTUAL_OUTPUT are evaluation params because the steps only refer to those two fields.
    """
    return GEval(
        name=f"{rubric.title} ({backend})",
        evaluation_steps=list(rubric.steps),
        rubric=[ScoreBand(score_range=(lo, hi), expected_outcome=outcome) for lo, hi, outcome in rubric.bands],
        evaluation_params=[SingleTurnParams.INPUT, SingleTurnParams.ACTUAL_OUTPUT],
        model=model,
        threshold=threshold,
        top_logprobs=TOP_LOGPROBS,
        async_mode=False,
    )
