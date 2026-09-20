"""
DeepEval eval suite for Meridian's judge, run the way DeepEval prescribes:

    cd eval-service && source .venv/bin/activate
    export OPENAI_API_KEY=sk-...                     # real, billed judge calls
    deepeval test run tests/evals/test_judge_golden.py
    deepeval test run tests/evals/test_judge_golden.py -n 4 --repeat 3 -id judge-v1.1   # parallel, variance

Each golden is one answer whose correctness is known in advance (golden/cases.json, generated from the
sample contracts by the same packet builders the UI uses). The judge under test is built by judge.py,
the same module the service uses, so this tests the production configuration, not a copy of it.

    pass golden -> the judge must PASS it     (approves correct answers)
    fail golden -> the judge must FAIL it     (rejects wrong answers, including ones whose source text
                                               tries to talk the judge into a perfect score)

The build-loop rule from DeepEval's guidance applies here: when this suite fails, fix the rubric,
packets or judge model. Do not lower the threshold, edit the metric to fit, or delete a failing golden.
Tests that need a real judge skip cleanly without OPENAI_API_KEY; the keyless tests always run.
"""

import json
import os
from pathlib import Path

import pytest
from deepeval.dataset import EvaluationDataset, Golden

import guard
import judge
from rubrics import RUBRICS

CASES = json.loads((Path(__file__).parents[2] / "golden" / "cases.json").read_text())


def _golden(case: dict) -> Golden:
    r = case["request"]
    return Golden(
        input=r["input"],
        actual_output=r["actualOutput"],
        expected_output=case["expected"],
        context=[r["context"]] if r["context"] else None,
        comments=case["note"],
        additional_metadata={"id": case["id"], "kind": r["kind"], "backend": r["backend"], "injection": case.get("injection", False)},
    )


DATASET = EvaluationDataset(goldens=[_golden(c) for c in CASES])

requires_judge = pytest.mark.skipif(not os.environ.get("OPENAI_API_KEY"), reason="needs OPENAI_API_KEY: this calls a real judge model")


@requires_judge
@pytest.mark.parametrize("golden", DATASET.goldens, ids=lambda g: g.additional_metadata["id"])
def test_judge_verdict_matches_the_known_answer(golden: Golden):
    meta = golden.additional_metadata
    rubric = RUBRICS[meta["kind"]]
    test_case, _ = judge.prepare_case(rubric, golden.input, golden.actual_output, golden.context[0] if golden.context else None)
    metric = judge.build_metric(rubric, meta["backend"], judge.JUDGE_MODEL, judge.PASS_THRESHOLD)

    # Measure, then decide pass or fail the way the service does (judge.settle_score), not with assert_test: DeepEval compares
    # its raw float to the threshold, which can fail a judge that chose exactly the pass mark. Running every golden, expected-fail
    # ones included, still records the judge's real score and reason.
    metric.measure(test_case)
    settled = judge.settle_score(metric.score, judge.PASS_THRESHOLD)
    assert settled is not None, f"[{meta['id']}] the judge returned an unusable score: {metric.score!r}"
    judged_pass = settled[1]

    expected_pass = golden.expected_output == "pass"
    assert judged_pass == expected_pass, (
        f"[{meta['id']}] expected the judge to {'PASS' if expected_pass else 'FAIL'} this answer but it "
        f"{'passed' if judged_pass else 'failed'} it (score {metric.score}, threshold {judge.PASS_THRESHOLD}). "
        f"Judge reason: {metric.reason}"
    )


# ---- keyless: these need no judge and always run ------------------------------------------------


def test_golden_set_has_not_shrunk_or_lost_a_class():
    assert len(CASES) >= 27
    for kind in RUBRICS:
        expected = {c["expected"] for c in CASES if c["request"]["kind"] == kind}
        assert expected == {"pass", "fail"}, f"{kind} needs both passing and failing goldens"


def test_every_injection_golden_is_flagged_by_the_guard():
    injected = [g for g in DATASET.goldens if g.additional_metadata["injection"]]
    assert len(injected) >= 3
    for g in injected:
        blocks = {"REQUEST": g.input, "ANSWER": g.actual_output, "SOURCE TEXT": g.context[0] if g.context else ""}
        _, integrity = guard.inspect_blocks(blocks)
        assert integrity.status == "suspicious", f"{g.additional_metadata['id']} carries an attack the guard did not detect"


def test_no_clean_golden_is_flagged_so_real_contracts_do_not_raise_false_alarms():
    for g in DATASET.goldens:
        if g.additional_metadata["injection"]:
            continue
        blocks = {"REQUEST": g.input, "ANSWER": g.actual_output, "SOURCE TEXT": g.context[0] if g.context else ""}
        _, integrity = guard.inspect_blocks(blocks)
        assert integrity.status == "clean", f"{g.additional_metadata['id']} false alarm: {integrity.signals}"
