"""
The judge's REAL scoring path, exercised without a real model.

DeepEval's G-Eval does not read the judge's integer at face value: it asks OpenAI for token logprobs and computes a
probability-weighted average over the top candidate score tokens. This module runs the actual GEval + OpenAI client
against a local server that returns logprobs in the real response shape, with the distribution chosen per test, so the
weighting, DeepEval's rubric-band confinement, and our threshold alignment are all observed rather than assumed.

The server plays a judge whose confidence we control. It reads a marker from the ANSWER text:  LP=<raw>:<tok>=<p>,<tok>=<p>
"""

import json
import math
import re
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest

import judge
from rubrics import RUBRICS

RISK = RUBRICS["risk"]


def _completion(raw: int, dist: dict[int, float] | None) -> dict:
    content = json.dumps({"score": raw, "reason": "Marker-controlled test judge."})
    tokens = ['{"', "score", '":', " ", str(raw), ",", ' "', "reason", '":', ' "', "Marker-controlled test judge.", '"}']
    logprobs = []
    for tok in tokens:
        top = [{"token": tok, "logprob": 0.0, "bytes": None}]
        if tok == str(raw) and dist is not None:
            top = [{"token": str(k), "logprob": math.log(p), "bytes": None} for k, p in dist.items()]
        logprobs.append({"token": tok, "logprob": 0.0, "bytes": None, "top_logprobs": top})
    return {
        "id": "x", "object": "chat.completion", "created": 0, "model": "gpt-4o-mini",
        "choices": [{"index": 0, "finish_reason": "stop", "message": {"role": "assistant", "content": content, "refusal": None},
                     "logprobs": {"content": logprobs, "refusal": None} if dist is not None else None}],
        "usage": {"prompt_tokens": 1, "completion_tokens": 1, "total_tokens": 2},
    }


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers["content-length"])))
        m = re.search(r"LP=(\d+):([\d=.,]*)", json.dumps(body["messages"]))
        raw = int(m.group(1))
        dist = {int(k): float(v) for k, v in (kv.split("=") for kv in m.group(2).split(",") if kv)} if m.group(2) else None
        if dist is not None:  # like OpenAI: return only the top-N candidates that were asked for, most likely first
            top = sorted(dist.items(), key=lambda kv: -kv[1])[: body.get("top_logprobs") or 20]
            dist = dict(top)
        Handler.seen.append(body)
        data = json.dumps(_completion(raw, dist)).encode()
        self.send_response(200)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


@pytest.fixture()
def server(monkeypatch):
    Handler.seen = []
    srv = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    monkeypatch.setenv("OPENAI_API_KEY", "test")
    monkeypatch.setenv("OPENAI_BASE_URL", f"http://127.0.0.1:{srv.server_port}/v1")
    yield Handler
    srv.shutdown()


def score(marker: str, threshold=0.6):
    case, _ = judge.prepare_case(RISK, "Rate this.", marker, "1. Liability. Unlimited.")
    metric = judge.build_metric(RISK, "typesafe", "gpt-4o-mini", threshold)
    metric.measure(case)
    return metric


@pytest.fixture()
def averaging(monkeypatch):
    """The DeepEval default: average over the top 20 candidate tokens."""
    monkeypatch.setattr(judge, "TOP_LOGPROBS", 20)


def test_by_default_the_score_is_the_judges_chosen_integer_so_verdict_and_band_agree(server):
    m = score("LP=8:8=0.6,9=0.4")
    assert m.score == pytest.approx(0.8), "top_logprobs=1: no averaging across candidate tokens"
    assert server.seen[0]["top_logprobs"] == 1


def test_with_averaging_enabled_the_score_is_a_probability_weighted_average(server, averaging):
    m = score("LP=8:8=0.6,9=0.4")
    assert m.score == pytest.approx((8 * 0.6 + 9 * 0.4) / 10) and m.is_successful()


def test_one_call_is_made_because_the_evaluation_steps_are_fixed_not_generated(server):
    score("LP=8:8=1.0")
    assert len(server.seen) == 1, "with fixed evaluation_steps G-Eval must skip the step-generation call"
    assert server.seen[0]["temperature"] == 0.0 and server.seen[0].get("logprobs") is True


def test_the_prompt_carries_the_fixed_steps_and_the_score_bands(server):
    score("LP=8:8=1.0")
    prompt = json.dumps(server.seen[0]["messages"])
    assert "untrusted data" in prompt and "Every rating is supported and the arithmetic and band are exactly right" in prompt
    assert "<<<ANSWER " in prompt and "<<<SOURCE TEXT " in prompt


def test_tokens_under_one_percent_probability_are_ignored_when_averaging(server, averaging):
    assert score("LP=8:8=0.995,2=0.005").score == pytest.approx(0.8)


def test_without_logprobs_the_raw_integer_is_used(server):
    assert score("LP=7:").score == pytest.approx(0.7)


# The two ways averaging misleads a pass/fail gate, both realistic for a judge at temperature 0 (the chosen integer is the
# most probable token) that is uncertain. Rubric bands do NOT prevent them: DeepEval puts the bands in the prompt but does
# not confine the averaged score (verified against the library source and by the 'averaging' tests below).

WRONG_ANSWER_JUDGED_5 = "LP=5:5=0.4,7=0.35,8=0.25"  # judge's choice is band 4-5 ("several ratings unsupported": a FAIL)
RIGHT_ANSWER_JUDGED_6 = "LP=6:6=0.4,5=0.35,4=0.25"  # judge's choice is band 6-8 ("supported": a PASS)


def test_default_a_wrong_answer_the_judge_scored_5_fails_and_a_right_one_it_scored_6_passes(server):
    fail, ok = score(WRONG_ANSWER_JUDGED_5), score(RIGHT_ANSWER_JUDGED_6)
    assert fail.score == pytest.approx(0.5) and not fail.is_successful()
    assert ok.score == pytest.approx(0.6) and ok.is_successful()


def test_averaging_lets_an_uncertain_wrong_answer_pass_and_an_uncertain_right_answer_fail(server, averaging):
    """The defect the default avoids, demonstrated: with DeepEval's default averaging both verdicts flip against the judge's choice."""
    fail_case, ok_case = score(WRONG_ANSWER_JUDGED_5), score(RIGHT_ANSWER_JUDGED_6)
    assert fail_case.score == pytest.approx(0.645) and fail_case.is_successful(), "judge chose a failing band; averaging passed it"
    assert ok_case.score == pytest.approx(0.515) and not ok_case.is_successful(), "judge chose a passing band; averaging failed it"
