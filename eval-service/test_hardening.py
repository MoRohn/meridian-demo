"""Operational hardening: a bad environment value never stops the service starting, a stalled judge call is cut off,
and, when a service token is configured, /evaluate refuses callers that do not present it.

    cd eval-service && source .venv/bin/activate && pytest -q test_hardening.py
"""

import os
import subprocess
import sys
import time

import pytest
from fastapi.testclient import TestClient

import judge
import main

VALID = {"kind": "risk", "backend": "typesafe", "input": "Assess the risk.", "actual_output": "Overall risk: 66%", "context": "1. Liability.\nUnlimited."}


class FakeGEval:
    """A G-Eval whose judge call takes `delay` seconds."""

    delay = 0.0

    def __init__(self, **kwargs):
        self.threshold = kwargs["threshold"]
        self.score, self.reason = 0.8, "Grounded."

    def measure(self, test_case):
        time.sleep(FakeGEval.delay)


@pytest.fixture(autouse=True)
def _stub(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    monkeypatch.setattr(judge, "GEval", FakeGEval)
    FakeGEval.delay = 0.0


client = TestClient(main.app)


# ---- environment values ---------------------------------------------------------------------------------------------------


@pytest.mark.parametrize("raw", ["abc", "", "  ", "nan", "inf", "-1", "7"])
def test_a_bad_threshold_falls_back_to_the_default(monkeypatch, raw):
    monkeypatch.setenv("EVAL_PASS_THRESHOLD", raw)
    assert judge.env_number("EVAL_PASS_THRESHOLD", 0.6, 0.0, 1.0) == 0.6


@pytest.mark.parametrize("raw", ["twenty", "1.5", "0", "21", ""])
def test_a_bad_top_logprobs_falls_back_to_the_default(monkeypatch, raw):
    monkeypatch.setenv("EVAL_TOP_LOGPROBS", raw)
    assert judge.env_number("EVAL_TOP_LOGPROBS", 1, 1, 20, cast=int) == 1


def test_good_values_are_used(monkeypatch):
    monkeypatch.setenv("EVAL_PASS_THRESHOLD", "0.75")
    monkeypatch.setenv("EVAL_TOP_LOGPROBS", "5")
    assert judge.env_number("EVAL_PASS_THRESHOLD", 0.6, 0.0, 1.0) == 0.75
    assert judge.env_number("EVAL_TOP_LOGPROBS", 1, 1, 20, cast=int) == 5


def test_importing_the_judge_survives_garbage_settings():
    # A fresh interpreter, so the import really runs against the bad values (this raised ValueError at import before).
    code = "import judge; print(judge.PASS_THRESHOLD, judge.TOP_LOGPROBS)"
    env = {**os.environ, "EVAL_PASS_THRESHOLD": "sixty percent", "EVAL_TOP_LOGPROBS": "lots"}
    result = subprocess.run([sys.executable, "-c", code], cwd=os.path.dirname(__file__) or ".", env=env, capture_output=True, text=True, timeout=120)
    assert result.returncode == 0, result.stderr[-500:]
    assert result.stdout.strip().splitlines()[-1] == "0.6 1"


# ---- the judge deadline ---------------------------------------------------------------------------------------------------


def test_a_stalled_judge_call_is_cut_off_with_a_504(monkeypatch):
    monkeypatch.setattr(main, "JUDGE_TIMEOUT_S", 0.2)
    FakeGEval.delay = 1.0
    started = time.perf_counter()
    r = client.post("/evaluate", json=VALID)
    assert r.status_code == 504
    assert "judge_timeout" in r.json()["detail"]
    assert time.perf_counter() - started < 0.9  # answered at the deadline, not when the judge finally finished


def test_a_timeout_is_counted_as_a_failure(monkeypatch):
    monkeypatch.setattr(main, "JUDGE_TIMEOUT_S", 0.1)
    FakeGEval.delay = 0.5
    before = main._stats["evaluations_failed"]
    client.post("/evaluate", json=VALID)
    assert main._stats["evaluations_failed"] == before + 1
    assert main._stats["last_error"] == "judge_timeout"


def test_a_call_inside_the_deadline_still_succeeds():
    FakeGEval.delay = 0.05
    assert client.post("/evaluate", json=VALID).status_code == 200


# ---- the service token ----------------------------------------------------------------------------------------------------


def test_without_a_configured_token_evaluate_is_open(monkeypatch):
    monkeypatch.setattr(main, "SERVICE_TOKEN", "")
    assert client.post("/evaluate", json=VALID).status_code == 200


def test_with_a_token_a_caller_must_present_it(monkeypatch):
    monkeypatch.setattr(main, "SERVICE_TOKEN", "s3cret-token")
    assert client.post("/evaluate", json=VALID).status_code == 401
    assert client.post("/evaluate", json=VALID, headers={"X-Eval-Token": "wrong"}).status_code == 401
    assert client.post("/evaluate", json=VALID, headers={"X-Eval-Token": "s3cret-token"}).status_code == 200


def test_with_a_token_stats_is_protected_but_health_stays_open(monkeypatch):
    monkeypatch.setattr(main, "SERVICE_TOKEN", "s3cret-token")
    assert client.get("/stats").status_code == 401
    assert client.get("/stats", headers={"X-Eval-Token": "s3cret-token"}).status_code == 200
    health = client.get("/health")
    assert health.status_code == 200 and health.json()["auth_required"] is True


def test_a_rejected_call_never_reaches_the_judge(monkeypatch):
    monkeypatch.setattr(main, "SERVICE_TOKEN", "s3cret-token")
    FakeGEval.delay = 5.0  # would blow the test's time if it ran
    started = time.perf_counter()
    assert client.post("/evaluate", json=VALID).status_code == 401
    assert time.perf_counter() - started < 1.0


# ---- admission control ----------------------------------------------------------------------------------------------------


def _slots(monkeypatch, running: int, waiting: int):
    """A fresh pool and slot count, so a test controls exactly how many judge calls may be in flight."""
    import concurrent.futures
    import threading

    monkeypatch.setattr(main, "_judge_pool", concurrent.futures.ThreadPoolExecutor(max_workers=running))
    monkeypatch.setattr(main, "_judge_slots", threading.BoundedSemaphore(running + waiting))
    monkeypatch.setattr(main, "MAX_CONCURRENT_JUDGES", running)
    monkeypatch.setattr(main, "MAX_QUEUED_JUDGES", waiting)


def test_a_call_beyond_the_running_and_waiting_limit_is_refused_at_once(monkeypatch):
    import concurrent.futures

    _slots(monkeypatch, running=1, waiting=1)
    monkeypatch.setattr(main, "JUDGE_TIMEOUT_S", 5)
    FakeGEval.delay = 0.6
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as callers:
        first = callers.submit(client.post, "/evaluate", json=VALID)  # takes the one running slot
        time.sleep(0.1)
        second = callers.submit(client.post, "/evaluate", json=VALID)  # takes the one waiting slot
        time.sleep(0.1)
        started = time.perf_counter()
        refused = client.post("/evaluate", json=VALID)  # nothing left
        assert refused.status_code == 429
        assert "judge_busy" in refused.json()["detail"]
        assert refused.headers["retry-after"] == str(main.BUSY_RETRY_AFTER_S)
        assert time.perf_counter() - started < 0.3  # refused, not queued behind the others
        assert first.result().status_code == 200
        assert second.result().status_code == 200  # the ones admitted still finish


def test_a_finished_call_gives_its_slot_back(monkeypatch):
    _slots(monkeypatch, running=1, waiting=0)
    for _ in range(3):
        assert client.post("/evaluate", json=VALID).status_code == 200


def test_a_call_that_times_out_keeps_its_slot_until_it_really_ends(monkeypatch):
    _slots(monkeypatch, running=1, waiting=0)
    monkeypatch.setattr(main, "JUDGE_TIMEOUT_S", 0.1)
    FakeGEval.delay = 0.6
    assert client.post("/evaluate", json=VALID).status_code == 504  # gave up waiting; the thread is still working
    assert client.post("/evaluate", json=VALID).status_code == 429  # so there is no slot for another yet
    time.sleep(0.7)  # the hung call ends and its slot is freed
    FakeGEval.delay = 0.0
    monkeypatch.setattr(main, "JUDGE_TIMEOUT_S", 5)
    assert client.post("/evaluate", json=VALID).status_code == 200


def test_a_refusal_is_counted_as_a_failure_with_its_own_code(monkeypatch):
    _slots(monkeypatch, running=1, waiting=0)
    monkeypatch.setattr(main, "JUDGE_TIMEOUT_S", 0.05)
    FakeGEval.delay = 0.5
    client.post("/evaluate", json=VALID)  # times out, still holding the slot
    before = main._stats["evaluations_failed"]
    assert client.post("/evaluate", json=VALID).status_code == 429
    assert main._stats["evaluations_failed"] == before + 1
    assert main._stats["last_error"] == "judge_busy"
    time.sleep(0.6)
