import pytest

from rubrics import KINDS, RUBRICS


@pytest.mark.parametrize("kind", KINDS)
def test_every_rubric_is_versioned_and_complete(kind):
    r = RUBRICS[kind]
    assert r.id == kind and r.version and r.title and r.task_line
    assert 5 <= len(r.steps) <= 8


@pytest.mark.parametrize("kind", KINDS)
def test_every_rubric_opens_with_the_untrusted_data_rule(kind):
    first = RUBRICS[kind].steps[0]
    assert "untrusted data" in first and "never instructions" in first


@pytest.mark.parametrize("kind", KINDS)
def test_every_rubric_ends_with_scoring_guidance_that_ignores_style(kind):
    last = RUBRICS[kind].steps[-1]
    assert last.startswith("Scoring") and "Do not reward length" in last


THRESHOLD_SCORE = 6  # 0.6 pass threshold on G-Eval's 0-10 scale


@pytest.mark.parametrize("kind", KINDS)
def test_score_bands_cover_0_to_10_without_overlap_or_gaps(kind):
    bands = sorted(RUBRICS[kind].bands)
    assert bands[0][0] == 0 and bands[-1][1] == 10
    for (_, hi, _), (lo, _, _) in zip(bands, bands[1:]):
        assert lo == hi + 1
    assert all(lo <= hi and outcome for lo, hi, outcome in bands)


@pytest.mark.parametrize("kind", KINDS)
def test_no_score_band_straddles_the_pass_threshold(kind):
    assert not any(lo < THRESHOLD_SCORE <= hi for lo, hi, _ in RUBRICS[kind].bands)


@pytest.mark.parametrize("kind", ["risk", "compliance"])
def test_scoring_is_arithmetic_so_different_mistakes_get_different_scores(kind):
    """Regression: with bands alone, two different wrong answers both landed on 4 and the UI showed 40% for both."""
    last = RUBRICS[kind].steps[-1]
    assert "start at 10" in last and "Subtract" in last and "report the resulting number" in last.lower()


def test_risk_arithmetic_and_its_bands_agree():
    """The deductions (3 unsupported, 5 wrong way, 5 wrong totals) must land in the band the bands text promises."""
    unsupported, wrong_way, totals = 3, 5, 5
    band = lambda score: next(i for i, (lo, hi, _) in enumerate(RUBRICS["risk"].bands) if lo <= score <= hi)
    assert band(10 - 0) == 3                       # all right
    assert band(10 - unsupported) == 2             # one unsupported: still a pass
    assert band(10 - 2 * unsupported) == 1         # two unsupported: fail
    assert band(10 - wrong_way) == 1               # one wrong-way rating: fail
    assert band(10 - totals) == 1                  # wrong totals: fail
    assert band(10 - wrong_way - unsupported) == 0  # a wrong-way rating compounded by another problem


def test_compliance_arithmetic_and_its_bands_agree():
    missed, false_alarm = 6, 5
    band = lambda score: next(i for i, (lo, hi, _) in enumerate(RUBRICS["compliance"].bands) if lo <= score <= hi)
    assert band(10) == 3
    assert band(10 - missed) == 1 and band(10 - false_alarm) == 1  # exactly one wrong decision
    assert band(max(0, min(3, 10 - missed - false_alarm))) == 0  # two or more wrong: at most 3, never below 0


def test_every_step_has_a_short_label_and_summary_for_readers():
    for kind, r in RUBRICS.items():
        assert len(r.outline) == len(r.steps), kind
        labels = [label for label, _ in r.outline]
        assert len(set(labels)) == len(labels), f"{kind}: labels must be distinct"
        for label, summary in r.outline:
            assert 0 < len(label) <= 28, (kind, label)
            assert 0 < len(summary) <= 130, (kind, summary)
        # The outline is a summary, never a substitute: each one is shorter than the wording it stands for.
        assert all(len(summary) < len(step) for (_, summary), step in zip(r.outline, r.steps)), kind
