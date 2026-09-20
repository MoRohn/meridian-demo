"""
Meridian's evaluation service — a small FastAPI wrapper around DeepEval
(https://github.com/confident-ai/deepeval) that scores a single model
answer (TypeSafe's or OpenAI's) using DeepEval's G-Eval metric, an
LLM-as-judge approach that returns both a 0-1 score AND a written
explanation of why it landed there.

This is a genuinely separate evaluation layer, not a re-implementation of
what Meridian already measures: TypeSafe's own `confidence` and OpenAI's
self-reported confidence describe how sure the ANSWERING model was.
G-Eval here is a THIRD, independent model judging whether that answer was
actually good. Run it once per task/action, not per individual trace
question since it makes a real LLM call and costs real tokens.

How a judgment is built (see rubrics.py and guard.py):
  * The rubric for the task `kind` supplies FIXED evaluation steps, so the
    judge's method is identical on every call and shown to the reader.
  * REQUEST / SOURCE TEXT / ANSWER are sanitized, fenced as untrusted data,
    and scanned for prompt-injection attempts; the report rides along in
    the response as `integrity`.
  * The ANSWER arrives in one standardized format for every backend, so two
    backends are graded on identical footing.

Run locally:
    cd eval-service
    python3 -m venv .venv && source .venv/bin/activate
    pip install -r requirements.txt
    export OPENAI_API_KEY=sk-...      # the judge model's key — see README
    uvicorn main:app --port 8008 --reload
"""

import logging
import math
import os
import re
import threading
import time
from typing import Literal

# Contracts are confidential. DeepEval reports anonymous usage telemetry by
# default; switch it off before the library is imported.
os.environ.setdefault("DEEPEVAL_TELEMETRY_OPT_OUT", "1")  # the value DeepEval documents

from fastapi import FastAPI, Header, HTTPException  # noqa: E402
from fastapi.middleware.cors import CORSMiddleware  # noqa: E402
from pydantic import BaseModel, Field  # noqa: E402

import envfile  # noqa: E402

envfile.load_env()  # picks up eval-service/.env before anything reads the environment

import judge  # noqa: E402
import judge_errors  # noqa: E402
from rubrics import RUBRICS  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
log = logging.getLogger("meridian.eval")
judge_errors.install_log_redaction()

app = FastAPI(title="Meridian Eval Service", version="0.2.0")

# Local dev only the real trust boundary is that this service is only
# ever called server-to-server from Meridian's own /api/evaluate route
# (see src/app/api/evaluate/route.ts), never directly from the browser.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://meridian.local:3000"],
    allow_methods=["POST"],
    allow_headers=["*"],
)

# A Confident AI key makes `deepeval test run` upload test cases (which here contain contract
# text) to a third-party platform. That is opt-in; never let it happen silently.
if os.environ.get("CONFIDENT_API_KEY"):
    log.warning("CONFIDENT_API_KEY is set: deepeval test runs will upload test cases, including contract text, to Confident AI.")

JUDGE_MODEL = judge.JUDGE_MODEL
PASS_THRESHOLD = judge.PASS_THRESHOLD

# Meridian caps uploaded documents at 100k characters (src/app/api/extract/route.ts);
# anything much larger than that here is a bug upstream, not a real contract, and
# would be sent verbatim to a paid judge model.
MAX_CONTEXT_CHARS = 120_000
MAX_OUTPUT_CHARS = 20_000
MAX_INPUT_CHARS = 20_000


class EvaluateRequest(BaseModel):
    kind: Literal["risk", "compliance", "citation", "reply"]
    backend: Literal["typesafe", "openai"]
    input: str = Field(max_length=MAX_INPUT_CHARS)
    actual_output: str = Field(min_length=1, max_length=MAX_OUTPUT_CHARS)
    context: str | None = Field(default=None, max_length=MAX_CONTEXT_CHARS)


class RubricInfo(BaseModel):
    id: str
    version: str
    title: str


class ScoreBand(BaseModel):
    """One band of the rubric's 0-10 scale and what a score inside it means."""

    low: int
    high: int
    outcome: str


class Integrity(BaseModel):
    status: Literal["clean", "suspicious"]
    signals: list[dict[str, str]] = []
    hidden_chars_removed: int = 0


class EvaluateResponse(BaseModel):
    score: float
    reason: str
    success: bool
    threshold: float
    judge_model: str
    rubric: RubricInfo
    # The fixed evaluation steps the judge scored against its method, verbatim.
    steps: list[str] = []
    # The rubric's score bands, so a score can be read as "what this means", not just a number.
    bands: list[ScoreBand] = []
    integrity: Integrity
    latency_ms: int
    # What the judge call itself cost in USD, when DeepEval could price it (None for a model it has no price for).
    judge_cost_usd: float | None = None


# ---- monitoring -----------------------------------------------------------

_stats_lock = threading.Lock()
_stats = {
    "evaluations_ok": 0,
    "evaluations_failed": 0,
    "latency_ms_total": 0,
    "suspicious_inputs": 0,
    "last_error": None,
    "by_kind": {},
}


def _record(kind: str, ok: bool, latency_ms: int, suspicious: bool = False, error: str | None = None) -> None:
    with _stats_lock:
        _stats["evaluations_ok" if ok else "evaluations_failed"] += 1
        _stats["latency_ms_total"] += latency_ms
        _stats["suspicious_inputs"] += int(suspicious)
        if error:
            _stats["last_error"] = error
        bucket = _stats["by_kind"].setdefault(kind, {"ok": 0, "failed": 0})
        bucket["ok" if ok else "failed"] += 1


@app.get("/health")
def health():
    return {
        "status": "ok",
        "judge_model": JUDGE_MODEL,
        "judge_configured": bool(os.environ.get("OPENAI_API_KEY")),
        # Who can judge, each with its default model and whether the service has its own key for it.
        "providers": {p: {"default_model": judge.DEFAULT_MODELS[p], "env_key": judge.env_key(p) is not None} for p in judge.PROVIDERS},
        "pass_threshold": PASS_THRESHOLD,
        "top_logprobs": judge.TOP_LOGPROBS,
        "telemetry_opt_out": os.environ.get("DEEPEVAL_TELEMETRY_OPT_OUT", "").upper() in ("YES", "1", "TRUE"),
        "confident_ai_configured": bool(os.environ.get("CONFIDENT_API_KEY")),
        "rubrics": {k: r.version for k, r in RUBRICS.items()},
    }


@app.get("/stats")
def stats():
    with _stats_lock:
        total = _stats["evaluations_ok"] + _stats["evaluations_failed"]
        return {
            **_stats,
            "by_kind": {k: dict(v) for k, v in _stats["by_kind"].items()},
            "avg_latency_ms": round(_stats["latency_ms_total"] / total) if total else None,
        }


@app.get("/rubrics")
def rubrics():
    return {k: {"version": r.version, "title": r.title, "steps": list(r.steps)} for k, r in RUBRICS.items()}


# ---- evaluation -----------------------------------------------------------


def _judge_cost(metric) -> float | None:
    """The judge call's USD cost as DeepEval measured it, or None when it has no price for the model."""
    cost = getattr(metric, "evaluation_cost", None)
    return float(cost) if isinstance(cost, (int, float)) and not isinstance(cost, bool) and math.isfinite(cost) and cost >= 0 else None


# A key that arrives with a request is used for that one call only: never stored, logged, or returned.
_KEY_FORMAT = re.compile(r"^[\x21-\x7e]{16,300}$")  # printable ASCII, no whitespace
# A model id is a short name, never free text: it goes to a provider's URL or body, so keep it to the characters ids use.
_MODEL_FORMAT = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:/-]{0,99}$")


@app.post("/evaluate", response_model=EvaluateResponse)
def evaluate(
    req: EvaluateRequest,
    x_judge_api_key: str | None = Header(default=None),
    x_judge_provider: str | None = Header(default=None),
    x_judge_model: str | None = Header(default=None),
):
    request_key = (x_judge_api_key or "").strip() or None
    if request_key and not _KEY_FORMAT.match(request_key):
        raise HTTPException(status_code=400, detail="The judge API key sent with this request is not in a valid format.")
    provider = (x_judge_provider or "openai").strip().lower()
    if provider not in judge.PROVIDERS:
        raise HTTPException(status_code=400, detail=f"Unknown judge provider. Use one of: {', '.join(judge.PROVIDERS)}.")
    requested_model = (x_judge_model or "").strip() or None
    if requested_model and not _MODEL_FORMAT.match(requested_model):
        raise HTTPException(status_code=400, detail="The judge model sent with this request is not a valid model id.")
    if not request_key and judge.env_key(provider) is None:
        label = judge.PROVIDER_LABELS[provider]
        raise HTTPException(
            status_code=503,
            detail=f"No judge API key for {label}: set {judge.ENV_KEYS[provider][0]} for the eval service, or save a {label} key in Meridian's Settings.",
        )

    judge_model = judge.resolve_model(provider, requested_model)
    # An OpenAI judge with no key of its own uses the service's environment (DeepEval reads it); the others always get an explicit key.
    metric_key = request_key or (judge.env_key(provider) if provider != "openai" else None)
    rubric = RUBRICS[req.kind]
    test_case, integrity = judge.prepare_case(rubric, req.input, req.actual_output, req.context)
    try:
        metric = judge.build_metric(rubric, req.backend, judge_model, PASS_THRESHOLD, api_key=metric_key, provider=provider)
    except ImportError as exc:
        raise HTTPException(
            status_code=503,
            detail=f"This eval service was installed without the {judge.PROVIDER_LABELS[provider]} SDK. Run `npm run eval-service:setup` to add it.",
        ) from exc

    started = time.perf_counter()
    try:
        with judge_errors.holding(request_key):
            metric.measure(test_case)
    except Exception as exc:  # noqa: BLE001 - every judge failure is reported, with a stable code
        latency = int((time.perf_counter() - started) * 1000)
        code, message = judge_errors.explain(exc, secrets=(request_key,) if request_key else ())
        _record(req.kind, False, latency, error=code)
        log.warning(
            "eval_failed kind=%s backend=%s judge=%s latency_ms=%d error=%s exc=%s",
            req.kind, req.backend, judge_model, latency, code, type(judge_errors.unwrap(exc)).__name__,
        )
        raise HTTPException(status_code=502, detail=f"G-Eval judge call failed ({code}): {message}") from exc

    latency = int((time.perf_counter() - started) * 1000)
    # A judge that answers outside 0-1 (say "99" on a 0-10 scale) must never be reported, and above all never passed.
    # The verdict is decided on the score as the reader sees it (see judge.settle_score), never on DeepEval's raw float.
    settled = judge.settle_score(metric.score, PASS_THRESHOLD)
    if settled is None:
        _record(req.kind, False, latency, error="judge_bad_score")
        log.warning("eval_failed kind=%s backend=%s judge=%s latency_ms=%d error=judge_bad_score score=%r", req.kind, req.backend, judge_model, latency, metric.score)
        raise HTTPException(status_code=502, detail="G-Eval judge call failed (judge_bad_score): The judge returned a score outside the valid range.")
    score, success = settled
    response = EvaluateResponse(
        score=score,
        reason=metric.reason or "The judge returned a score but no written reason.",
        success=success,
        threshold=PASS_THRESHOLD,
        judge_model=judge_model,
        rubric=RubricInfo(id=rubric.id, version=rubric.version, title=rubric.title),
        steps=list(rubric.steps),
        bands=[ScoreBand(low=lo, high=hi, outcome=outcome) for lo, hi, outcome in rubric.bands],
        integrity=Integrity(**integrity.to_dict()),
        latency_ms=latency,
        judge_cost_usd=_judge_cost(metric),
    )
    _record(req.kind, True, latency, suspicious=integrity.status == "suspicious")
    log.info(
        "eval_ok kind=%s backend=%s judge=%s rubric=%s@%s score=%.2f success=%s integrity=%s signals=%d "
        "latency_ms=%d source_chars=%d answer_chars=%d",
        req.kind, req.backend, judge_model, rubric.id, rubric.version, response.score, response.success,
        integrity.status, len(integrity.signals), latency, len(req.context or ""), len(req.actual_output),
    )
    return response
