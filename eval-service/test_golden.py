import json
from pathlib import Path

import pytest

from golden.run_golden import summarize, verdict_ok

CASES = json.loads((Path(__file__).parent / "golden" / "cases.json").read_text())


def row(id, expected, score, kind="risk", injection=False, error=None):
    return {"id": id, "kind": kind, "expected": expected, "injection": injection,
            "scores": [] if error else score if isinstance(score, list) else [score], "error": error}


def test_perfect_judge_scores_100_percent_and_passes_the_gate():
    s = summarize([row("a", "pass", 0.9), row("b", "fail", 0.1), row("c", "fail", 0.2, injection=True)], 0.6)
    assert s["accuracy"] == 1.0 and s["injection_robustness"] == 1.0 and s["false_passes"] == []
    assert s["separation"] == pytest.approx(0.75)
    assert verdict_ok(s, 0.85)


def test_a_judge_that_approves_everything_is_caught():
    s = summarize([row("a", "pass", 0.9), row("b", "fail", 0.9), row("c", "fail", 0.9, injection=True)], 0.6)
    assert s["accuracy"] == pytest.approx(1 / 3)
    assert s["false_passes"] == ["b", "c"] and s["injection_fooled"] == ["c"]
    assert not verdict_ok(s, 0.85)


def test_one_fooled_injection_case_fails_the_gate_even_with_high_accuracy():
    rows = [row(f"g{i}", "pass", 0.9) for i in range(9)] + [row("inj", "fail", 0.8, injection=True)]
    s = summarize(rows, 0.6)
    assert s["accuracy"] == 0.9 and s["injection_robustness"] == 0.0
    assert not verdict_ok(s, 0.85)


def test_run_to_run_variance_is_reported():
    s = summarize([row("a", "pass", [0.5, 0.9, 0.7])], 0.6)
    assert s["max_run_to_run_stdev"] > 0.1


def test_judge_errors_are_reported_and_fail_the_gate():
    s = summarize([row("a", "pass", 0.9), row("b", "fail", 0, error="502")], 0.6)
    assert s["errors"] == [{"id": "b", "error": "502"}] and not verdict_ok(s, 0.5)


def test_per_kind_accuracy():
    s = summarize([row("a", "pass", 0.9, kind="risk"), row("b", "pass", 0.1, kind="citation")], 0.6)
    assert s["accuracy_by_kind"] == {"citation": 0.0, "risk": 1.0}


def test_fixture_cases_are_well_formed():
    assert len(CASES) >= 20
    for c in CASES:
        r = c["request"]
        assert c["expected"] in ("pass", "fail") and r["kind"] in ("risk", "compliance", "citation", "reply")
        assert r["actualOutput"].strip() and r["backend"] == "typesafe"
