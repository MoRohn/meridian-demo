"""
How a judgment is built: the ONE place that turns a rubric plus untrusted request
data into a DeepEval test case and a configured G-Eval metric.

The HTTP service (main.py) and the DeepEval test suite (tests/evals/) both import
this, so the suite always exercises exactly the judge configuration production
uses; the two cannot drift apart.
"""

import math
import os

from deepeval.metrics import GEval
from deepeval.metrics.g_eval import Rubric as ScoreBand
from deepeval.models import OpenAIModel
from deepeval.test_case import LLMTestCase, SingleTurnParams

import guard
from rubrics import Rubric

JUDGE_MODEL = os.environ.get("EVAL_JUDGE_MODEL", "gpt-4o-mini")

# Who can judge. The default is OpenAI (the key already saved for the app); Claude and Gemini are there because a judge is
# fairest when it is made by a different company than the model whose answer it is scoring. Each provider's own key comes
# from the request (the Settings modal) or, failing that, from the service's environment.
PROVIDERS = ("openai", "anthropic", "gemini")
PROVIDER_LABELS = {"openai": "OpenAI", "anthropic": "Claude", "gemini": "Gemini"}
DEFAULT_MODELS = {
    "openai": JUDGE_MODEL,
    "anthropic": os.environ.get("EVAL_ANTHROPIC_JUDGE_MODEL", "claude-sonnet-5"),
    "gemini": os.environ.get("EVAL_GEMINI_JUDGE_MODEL", "gemini-2.5-flash"),
}
ENV_KEYS = {"openai": ("OPENAI_API_KEY",), "anthropic": ("ANTHROPIC_API_KEY",), "gemini": ("GEMINI_API_KEY", "GOOGLE_API_KEY")}


def env_key(provider: str) -> str | None:
    """The service's own key for a provider, if its environment has one."""
    for name in ENV_KEYS[provider]:
        value = os.environ.get(name, "").strip()
        if value:
            return value
    return None


def resolve_model(provider: str, requested: str | None) -> str:
    """The model that will judge: the one asked for, else the provider's default."""
    return (requested or "").strip() or DEFAULT_MODELS[provider]


def make_judge_model(provider: str, model: str, api_key: str):
    """
    A DeepEval model object for a non-default judge, holding this one request's key (never written to the environment).
    Claude and Gemini return no token probabilities, so G-Eval takes the integer the judge chose as the score, which is
    exactly what TOP_LOGPROBS=1 gives with OpenAI: the score always matches the band the judge picked.
    """
    if provider == "anthropic":
        from deepeval.models import AnthropicModel

        return AnthropicModel(model=model, api_key=api_key, temperature=0)
    if provider == "gemini":
        from deepeval.models import GeminiModel

        return GeminiModel(model=model, api_key=api_key, temperature=0)
    return OpenAIModel(model=model, api_key=api_key, temperature=0)
PASS_THRESHOLD = float(os.environ.get("EVAL_PASS_THRESHOLD", "0.6"))
# How many candidate score tokens G-Eval averages over. DeepEval defaults to 20 and returns a probability-weighted
# average, which can carry a verdict across a band boundary: a judge whose top choice is 6 (a pass) but who is unsure
# can average to 5.2 and fail, and one whose top choice is 5 (a fail) with mass on 7-8 can average to 6.4 and pass,
# leaving the shown score at odds with the judge's own written reason. With 1 the score IS the judge's chosen integer,
# so the verdict always matches the band it chose. Set EVAL_TOP_LOGPROBS=20 to restore averaging and compare on the golden set.
TOP_LOGPROBS = int(os.environ.get("EVAL_TOP_LOGPROBS", "1"))


# ---- the verdict: one rule for every judge, provider and backend --------------------------------------------------------
#
# The judge chooses a whole number from 0 to 10, and every screen shows the result as a whole percent. DeepEval turns that
# choice into a float that is close to, but not always exactly, that number: with one candidate token it computes
# (6 * p) / p, which is 5.999999999999999 for about 1 probability in 12. Comparing that raw float to the pass mark made a
# judge that chose 6 (a passing band) FAIL at "60%" against a 60% threshold. So the score is settled to the precision it is
# shown at, the same way for every judge (OpenAI, Claude and Gemini) and for both backends' answers, and pass or fail is
# decided on that settled number: the one the reader sees.
SCORE_STEPS = 100  # whole percent
# How far outside 0..1 a raw score may be before it is a judge error rather than rounding noise: half of one displayed step.
_NOISE = 0.5 / SCORE_STEPS


def settle_score(raw: object, threshold: float) -> tuple[float, bool] | None:
    """
    (displayed score in 0..1, whether it passes), or None when `raw` is not a usable score at all (not a number, NaN,
    infinite, or clearly outside 0..1 such as 9.9 from a judge that answered 99). Rounding is half-up, like the UI's
    Math.round, and the comparison is between whole percents, so no float noise can flip it.
    """
    if isinstance(raw, bool) or not isinstance(raw, (int, float)) or not math.isfinite(raw):
        return None
    if not -_NOISE <= raw <= 1 + _NOISE:
        return None
    steps = min(SCORE_STEPS, max(0, math.floor(raw * SCORE_STEPS + 0.5)))
    return steps / SCORE_STEPS, steps >= math.floor(threshold * SCORE_STEPS + 0.5)


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


def build_metric(rubric: Rubric, backend: str, model: str, threshold: float, api_key: str | None = None, provider: str = "openai") -> GEval:
    """
    Fixed evaluation_steps (reproducible) plus a rubric of non-overlapping score bands, both of
    which DeepEval documents as the way to make G-Eval more consistent across runs. The bands shape the judge's
    choice (they are in its prompt); they do not confine the averaged score, which is why TOP_LOGPROBS defaults to 1. Only INPUT and
    ACTUAL_OUTPUT are evaluation params because the steps only refer to those two fields.

    `api_key` is a key that arrived with one request. It goes into a model object owned by this one metric and is never
    written to the environment, so concurrent requests with different keys cannot see each other's. Temperature is pinned
    to 0 to match the default model path. `provider` selects whose model judges; for Claude and Gemini a key is required.
    """
    if provider != "openai":
        if not api_key:
            raise ValueError(f"A {PROVIDER_LABELS[provider]} judge needs an API key.")
        judge_model = make_judge_model(provider, model, api_key)
    else:
        judge_model = OpenAIModel(model=model, api_key=api_key, temperature=0) if api_key else model
    return GEval(
        name=f"{rubric.title} ({backend})",
        evaluation_steps=list(rubric.steps),
        rubric=[ScoreBand(score_range=(lo, hi), expected_outcome=outcome) for lo, hi, outcome in rubric.bands],
        evaluation_params=[SingleTurnParams.INPUT, SingleTurnParams.ACTUAL_OUTPUT],
        model=judge_model,
        threshold=threshold,
        top_logprobs=TOP_LOGPROBS,
        async_mode=False,
    )
