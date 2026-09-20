"""
Calibrates the golden-set harness against SIMULATED judges whose accuracy is known exactly.

The harness (golden/run_golden.py) is what will turn a real judge's answers into an accuracy figure. If it
mis-scored, that figure would be wrong in a way nobody could see. So here the judge is a stand-in with a planted
behavior, and the harness must recover it: a perfect judge must score 100%, a judge wrong on N planted cases must
score exactly (27-N)/27, a rubber stamp must be exposed, and a judge fooled ONLY by injection must trip the
injection gate even though its overall accuracy still looks fine.

None of this measures a real model. It proves the ruler is straight.
"""

import json
import random
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

import main
from golden import run_golden

CASES = json.loads((Path(__file__).parent / "golden" / "cases.json").read_text())
BY_REQUEST = {(c["request"]["input"], c["request"]["actualOutput"], c["request"]["context"]): c for c in CASES}
assert len(BY_REQUEST) == len(CASES), "the lookup key must identify every golden case uniquely"
GOOD, BAD = 0.9, 0.1
THRESHOLD = 0.6


def case_of(req):
    return BY_REQUEST[(req.input, req.actual_output, req.context)]


def install(monkeypatch, judge):
    monkeypatch.setattr(main, "evaluate", lambda req: SimpleNamespace(score=judge(req, case_of(req))))


def oracle(_req, case):
    return GOOD if case["expected"] == "pass" else BAD


def run(repeat=1):
    results = run_golden.run(CASES, repeat)
    return results, run_golden.summarize(results, THRESHOLD)


@pytest.fixture(autouse=True)
def _quiet(capsys):
    yield


def test_a_perfect_judge_scores_100_percent_everywhere_and_passes_the_gate(monkeypatch):
    install(monkeypatch, oracle)
    _, s = run()
    assert s["scored"] == len(CASES) == s["cases"] and s["errors"] == []
    assert s["accuracy"] == 1.0 and s["injection_robustness"] == 1.0
    assert s["false_passes"] == [] and s["false_fails"] == []
    assert s["separation"] == pytest.approx(GOOD - BAD)
    assert all(v == 1.0 for v in s["accuracy_by_kind"].values()) and set(s["accuracy_by_kind"]) == {"risk", "compliance", "citation", "reply"}
    assert run_golden.verdict_ok(s, 0.85)


@pytest.mark.parametrize("flip_rate,seed", [(0.1, 1), (0.2, 2), (0.35, 3)])
def test_a_judge_wrong_on_planted_cases_scores_exactly_the_planted_accuracy(monkeypatch, flip_rate, seed):
    rng = random.Random(seed)
    wrong = {c["id"] for c in CASES if rng.random() < flip_rate}
    install(monkeypatch, lambda _r, c: (BAD if c["expected"] == "pass" else GOOD) if c["id"] in wrong else oracle(_r, c))
    _, s = run()
    assert s["accuracy"] == pytest.approx((len(CASES) - len(wrong)) / len(CASES))
    planted_false_passes = sorted(c["id"] for c in CASES if c["id"] in wrong and c["expected"] == "fail")
    planted_false_fails = sorted(c["id"] for c in CASES if c["id"] in wrong and c["expected"] == "pass")
    assert sorted(s["false_passes"]) == planted_false_passes and sorted(s["false_fails"]) == planted_false_fails
    assert run_golden.verdict_ok(s, 0.85) == (s["accuracy"] >= 0.85 and s["injection_fooled"] == [])


def test_a_rubber_stamp_judge_is_exposed_with_every_wrong_answer_listed(monkeypatch):
    install(monkeypatch, lambda *_: 0.8)
    _, s = run()
    fails = sorted(c["id"] for c in CASES if c["expected"] == "fail")
    assert s["accuracy"] == pytest.approx(1 - len(fails) / len(CASES))
    assert sorted(s["false_passes"]) == fails and s["separation"] == pytest.approx(0)
    assert not run_golden.verdict_ok(s, 0.85)


def test_a_judge_fooled_only_by_injection_fails_the_gate_despite_high_accuracy(monkeypatch):
    install(monkeypatch, lambda r, c: 0.95 if c.get("injection") else oracle(r, c))
    _, s = run()
    injected = sorted(c["id"] for c in CASES if c.get("injection"))
    assert len(injected) >= 3 and s["accuracy"] == pytest.approx(1 - len(injected) / len(CASES))
    assert s["accuracy"] >= 0.85, "the point: accuracy alone would have shipped this judge"
    assert s["injection_robustness"] == 0.0 and sorted(s["injection_fooled"]) == injected
    assert not run_golden.verdict_ok(s, 0.85)


def test_judge_errors_are_reported_per_case_and_fail_the_gate(monkeypatch):
    def flaky(req):
        if case_of(req)["id"] == "risk-nda-correct":
            raise HTTPException(status_code=502, detail="G-Eval judge call failed: RateLimitError: 429")
        return SimpleNamespace(score=oracle(None, case_of(req)))
    monkeypatch.setattr(main, "evaluate", flaky)
    _, s = run()
    assert s["errors"] == [{"id": "risk-nda-correct", "error": "G-Eval judge call failed: RateLimitError: 429"}]
    assert s["scored"] == len(CASES) - 1 and not run_golden.verdict_ok(s, 0.0)


def test_run_to_run_variance_is_measured_from_repeats(monkeypatch):
    rng = random.Random(7)
    install(monkeypatch, lambda r, c: min(1, max(0, oracle(r, c) + rng.gauss(0, 0.12))))
    results, s = run(repeat=4)
    assert all(len(r["scores"]) == 4 for r in results)
    assert 0.03 < s["max_run_to_run_stdev"] < 0.3
    install(monkeypatch, oracle)
    assert run(repeat=4)[1]["max_run_to_run_stdev"] == 0.0


def test_the_score_at_exactly_the_threshold_counts_as_a_pass(monkeypatch):
    install(monkeypatch, lambda *_: THRESHOLD)
    _, s = run()
    assert sorted(s["false_passes"]) == sorted(c["id"] for c in CASES if c["expected"] == "fail")


def test_cli_end_to_end_exit_codes_and_report_file(monkeypatch, tmp_path, capsys):
    monkeypatch.setenv("OPENAI_API_KEY", "x")
    monkeypatch.setattr(run_golden, "REPORT_PATH", tmp_path / "report.json")
    install(monkeypatch, oracle)
    monkeypatch.setattr("sys.argv", ["run_golden.py"])
    assert run_golden.main_cli() == 0
    report = json.loads((tmp_path / "report.json").read_text())
    assert report["accuracy"] == 1.0 and "RESULT: PASS" in capsys.readouterr().out
    install(monkeypatch, lambda *_: 0.8)
    assert run_golden.main_cli() == 1 and "RESULT: FAIL" in capsys.readouterr().out


def test_cli_only_filter_and_missing_key(monkeypatch, tmp_path, capsys):
    monkeypatch.setattr(run_golden, "REPORT_PATH", tmp_path / "r.json")
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.setattr("sys.argv", ["run_golden.py"])
    assert run_golden.main_cli() == 2
    monkeypatch.setenv("OPENAI_API_KEY", "x")
    install(monkeypatch, oracle)
    monkeypatch.setattr("sys.argv", ["run_golden.py", "--only", "citation"])
    assert run_golden.main_cli() == 0
    assert json.loads((tmp_path / "r.json").read_text())["cases"] == sum(c["request"]["kind"] == "citation" for c in CASES)


def test_cli_reads_the_key_from_dot_env_before_checking_for_it(monkeypatch, tmp_path):
    """Regression: the key check ran before .env was loaded, so a key kept only in eval-service/.env was reported missing."""
    env = tmp_path / ".env"
    env.write_text("OPENAI_API_KEY=sk-from-file\n")
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.setattr(run_golden.envfile, "DEFAULT_PATH", env)
    real_load = run_golden.envfile.load_env
    monkeypatch.setattr(run_golden.envfile, "load_env", lambda *a, **k: real_load(env))
    monkeypatch.setattr(run_golden, "REPORT_PATH", tmp_path / "r.json")
    install(monkeypatch, oracle)
    monkeypatch.setattr("sys.argv", ["run_golden.py", "--only", "reply"])
    assert run_golden.main_cli() == 0
