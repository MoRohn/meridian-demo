"""
Pass or fail is decided on the score the reader sees, the same way for every judge, provider and backend.

Regression: a judge that chose exactly 6 on the 0-10 scale (a passing band) was shown as "60%" and FAILED against a 60% pass
mark, because DeepEval's raw score was 0.5999999999999999. The two backends judged in the same run could then disagree at the
same displayed score.
"""

import math
import random

import pytest
from fastapi.testclient import TestClient

import judge
import main
from test_main import VALID, StubGEval

THRESHOLD = 0.6


def deepeval_score(choice: int, probability: float) -> float:
    """What DeepEval hands back for a judge that chose `choice` with one candidate token of `probability` (see judge.py)."""
    return ((choice * probability) / probability) / 10


def test_the_bug_is_real_deepeval_turns_a_chosen_6_into_a_failing_score_for_some_probabilities():
    random.seed(1)
    noisy = [p for p in (math.exp(-random.random() * 0.6) for _ in range(20000)) if not deepeval_score(6, p) >= THRESHOLD]
    assert noisy, "this arithmetic no longer produces float noise; the regression tests below have lost their point"


@pytest.mark.parametrize("choice", range(0, 11))
def test_a_judge_that_chose_a_whole_number_always_gets_that_score_whatever_the_float_noise(choice):
    random.seed(choice)
    for _ in range(3000):
        p = math.exp(-random.random() * 0.6)
        settled = judge.settle_score(deepeval_score(choice, p), THRESHOLD)
        assert settled == (choice / 10, choice >= 6), (choice, p, settled)


def test_the_exact_case_from_the_screenshot():
    """5.999999999999999 / 10 is what failed; it must settle to 60% and pass."""
    assert judge.settle_score(0.5999999999999999, THRESHOLD) == (0.6, True)
    assert judge.settle_score(0.6, THRESHOLD) == (0.6, True)
    assert judge.settle_score(0.6000000000000001, THRESHOLD) == (0.6, True)


def test_float_noise_at_the_top_of_the_scale_is_rounding_not_an_invalid_score():
    """A judge that chose 10 can compute 1.0000000000000002. That is a 100%, not a judge error."""
    assert judge.settle_score(1.0000000000000002, THRESHOLD) == (1.0, True)
    assert judge.settle_score(-1e-16, THRESHOLD) == (0.0, False)


@pytest.mark.parametrize("raw, expected", [(0.594, (0.59, False)), (0.595, (0.6, True)), (0.599, (0.6, True)), (0.604, (0.6, True)), (0.605, (0.61, True)), (0.0, (0.0, False)), (1.0, (1.0, True))])
def test_the_score_is_the_whole_percent_the_reader_sees_rounded_half_up_and_pass_follows_it(raw, expected):
    """A score shown as 60% passes a 60% mark; one shown as 59% does not. Nothing hidden behind the display decides."""
    assert judge.settle_score(raw, THRESHOLD) == expected


@pytest.mark.parametrize("threshold, raw, passes", [(0.65, 0.65, True), (0.65, 0.64, False), (0.7, 0.6999999999999999, True), (0.5, 0.49, False), (0.0, 0.0, True), (1.0, 1.0, True), (1.0, 0.99, False)])
def test_it_holds_for_any_threshold_not_just_the_default(threshold, raw, passes):
    assert judge.settle_score(raw, threshold)[1] is passes


@pytest.mark.parametrize("bad", [float("nan"), float("inf"), float("-inf"), 9.9, 99.0, -0.1, 1.01, -0.01, "0.6", None, True, [0.6]])
def test_anything_that_is_not_a_usable_score_is_refused_rather_than_settled(bad):
    assert judge.settle_score(bad, THRESHOLD) is None


def test_the_same_choice_gives_the_same_verdict_for_every_provider_and_backend():
    """Claude and Gemini return the exact integer, OpenAI a noisy float: all of them must settle identically."""
    exact = judge.settle_score(0.6, THRESHOLD)
    noisy = [judge.settle_score(deepeval_score(6, p), THRESHOLD) for p in (0.55, 0.61, 0.7, 0.83, 0.9, 0.97, 0.999)]
    assert all(v == exact for v in noisy)


# ---- through the service ----------------------------------------------------------------------------------------------------


@pytest.fixture()
def client(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "k")
    monkeypatch.setattr(judge, "GEval", StubGEval)
    StubGEval.raises, StubGEval.score, StubGEval.reason = None, 0.8, "r"
    return TestClient(main.app)


@pytest.mark.parametrize("backend", ["typesafe", "openai"])
def test_both_backends_at_the_same_displayed_score_get_the_same_verdict(client, backend):
    """The stub decides success on the raw float, as DeepEval does; the service must ignore that and decide on the settled score."""
    StubGEval.score = 0.5999999999999999
    body = client.post("/evaluate", json={**VALID, "backend": backend}).json()
    assert body["score"] == 0.6 and body["success"] is True


def test_the_service_reports_the_settled_score_not_the_raw_float(client):
    StubGEval.score = 0.5999999999999999
    assert client.post("/evaluate", json=VALID).json()["score"] == 0.6
    StubGEval.score = 1.0000000000000002
    body = client.post("/evaluate", json=VALID).json()
    assert body["score"] == 1.0 and body["success"] is True


def test_a_score_shown_as_59_percent_fails_and_says_59(client):
    StubGEval.score = 0.594
    body = client.post("/evaluate", json=VALID).json()
    assert body["score"] == 0.59 and body["success"] is False


def test_the_pass_mark_reported_is_the_one_the_verdict_used(client):
    body = client.post("/evaluate", json=VALID).json()
    assert body["threshold"] == main.PASS_THRESHOLD == judge.PASS_THRESHOLD
